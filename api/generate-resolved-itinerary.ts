import { generateRawItinerary } from './_lib/generateRawItinerary.js';
import {
  verifyPlace,
  geocodeDestination,
  haversineMeters,
  MAX_BROAD_DISTANCE_METERS,
  findNearbyCandidates
} from './_lib/verifyPlace.js';
import { computeTravelTimes, travelBetween } from './_lib/travelTime.js';
import { refreshDescriptions } from './_lib/refreshDescriptions.js';
import { sanitizeDescriptions } from './_lib/sanitizeDescriptions.js';
import { checkRateLimit, rateLimitResponse, isCapacityError } from './_lib/rateLimit.js';
import {
  parseTravelMinutes,
  addMinutesToTime,
  timeToMinutes,
  fillMissingTravelTimes,
  realignScheduleTimes,
  roundStayDurations,
  snapArrivalsToGrid,
  stretchPreDinnerGap
} from './_lib/scheduleRealign.js';

// Fixed meal windows and the "day can't start before 9am" rule, per Akber's
// call (9 Jul 2026). Enforced here rather than trusted to the prompt alone
// (see generateRawItinerary.js for the prompt-side instruction) - Claude's
// own startTime/durationMinutes are a plausible first guess, but this is the
// one place they're actually guaranteed to hold.
const MEAL_WINDOWS = {
  breakfast: { start: '09:00', end: '10:30' },
  lunch: { start: '12:00', end: '14:00' },
  dinner: { start: '19:00', end: '21:00' },
};
const FIXED_MEAL_DURATION_MINUTES = 60;
// Slow & Immersive is meant to feel unhurried, and a 60-minute meal reads as
// rushed against its long, lingering activity stops (Akber's call). So on that
// variant every meal - breakfast, lunch and dinner, including the ones this
// pipeline injects as backstops and the accommodation-breakfast bookend - runs
// for this long instead. resolveItinerary picks which value applies per variant
// from the itinerary's pacingLabel ('Relaxed' = Slow & Immersive), and the
// existing realign/stretch/snap passes recascade every surrounding stop around
// the longer meal automatically, so nothing else needs to know about it.
const SLOW_MEAL_DURATION_MINUTES = 120;

function clampToWindow(time, window) {
  const minutes = timeToMinutes(time);
  const startMinutes = timeToMinutes(window.start);
  const endMinutes = timeToMinutes(window.end);
  if (minutes == null) {
    return window.start;
  }
  if (minutes < startMinutes) {
    return window.start;
  }
  if (minutes > endMinutes) {
    return window.end;
  }
  return time;
}

// Runs on Claude's raw items before anything else touches them (verification,
// travel times, bookending) - every downstream step can then already assume
// every meal is exactly 60 minutes and inside its window, rather than
// treating that as a "maybe" from the AI.
function enforceMealConstraints(day, mealDuration) {
  for (const item of day.items) {
    if (!item.mealType) {
      continue;
    }
    const window = MEAL_WINDOWS[item.mealType];
    if (window) {
      item.startTime = clampToWindow(item.startTime, window);
    }
    item.durationMinutes = mealDuration;
  }
}

// Builds one accommodation-anchored bookend stop. Deliberately not run
// through verifyPlace like every other item - it doesn't need to be, the
// accommodation was already a real, Places-verified hotel the moment the
// traveller picked it on the Accommodation screen (see hotelSearch.js /
// Accommodation.jsx's accommodationDetails). durationMinutes stays null
// unless explicitly overridden - a pure departure/arrival point has no stay
// time of its own (see realignScheduleTimes' handling of that).
function buildAccommodationItem(accommodationDetails, overrides) {
  return {
    type: 'accommodation',
    name: accommodationDetails.name,
    categoryTag: accommodationDetails.categoryTag || null,
    address: accommodationDetails.address || null,
    rating: accommodationDetails.rating ?? null,
    ratingCount: accommodationDetails.ratingCount ?? null,
    photoUrl: accommodationDetails.photoUrl || null,
    location: accommodationDetails.location,
    hasHours: false,
    weekdayDescriptions: null,
    mealType: null,
    durationMinutes: null,
    travelToNext: null,
    ...overrides,
  };
}

// Guarantees every day has a dinner item. If Claude forgot to generate one
// (rare but seen in the wild - a day ending at 17:04 with no dinner), this
// injects a placeholder at 19:30. It has no specific restaurant name yet;
// the description signals it's a suggestion rather than a booking so the
// traveller knows to look something up. Runs after enforceMealConstraints
// (so any real dinner is already window-clamped) and before
// applyAccommodationBookends (so the return-to-hotel bookend follows dinner).
function ensureDinner(day, destination, mealDuration) {
  const hasDinner = day.items.some((item) => item.mealType === 'dinner');
  if (hasDinner) return;

  // Place it before the last accommodation item if one's already there;
  // otherwise append. In practice applyAccommodationBookends hasn't run
  // yet so there's nothing to insert before - just push.
  day.items.push({
    type: 'meal',
    name: 'Dinner',
    categoryTag: 'Restaurant',
    description: `Find a local restaurant for dinner in ${destination}.`,
    startTime: '19:30',
    durationMinutes: mealDuration,
    mealType: 'dinner',
    travelToNext: null,
    photoUrl: null,
    location: null,
    address: null,
    rating: null,
    ratingCount: null,
    hasHours: false,
    weekdayDescriptions: null,
  });
}

// Guarantees breakfast on the days that don't eat at the hotel. When
// day.breakfastAtAccommodation is set, applyAccommodationBookends adds a real
// "Breakfast at <hotel>" stop, so nothing is needed here. Otherwise Claude is
// expected to supply a breakfast spot, and when it omits one this adds a
// placeholder that resolveMealPlaceholders turns into a real cafe near the
// first stop of the day.
function ensureBreakfast(day, destination, mealDuration) {
  if (day.breakfastAtAccommodation) return;
  const hasBreakfast = day.items.some((item) => item.mealType === 'breakfast');
  if (hasBreakfast) return;

  day.items.push({
    type: 'meal',
    name: 'Breakfast',
    categoryTag: 'Cafe',
    description: `Find a local spot for breakfast in ${destination}.`,
    startTime: '09:00',
    durationMinutes: mealDuration,
    mealType: 'breakfast',
    travelToNext: null,
    photoUrl: null,
    location: null,
    address: null,
    rating: null,
    ratingCount: null,
    hasHours: false,
    weekdayDescriptions: null,
  });
}

// Guarantees every day has a lunch item, mirroring ensureDinner. Claude
// sometimes omits lunch entirely (seen on a Packed Day 2, 1 Aug 2026 - the day
// jumped from a morning stop straight to the afternoon with no lunch at all),
// and unlike dinner there was no backstop for it. Adds a midday placeholder;
// resolveItinerary re-sorts the day immediately after so it lands in its proper
// slot, then resolveMealPlaceholders turns it into a real restaurant.
function ensureLunch(day, destination, mealDuration) {
  const hasLunch = day.items.some((item) => item.mealType === 'lunch');
  if (hasLunch) return;

  day.items.push({
    type: 'meal',
    name: 'Lunch',
    categoryTag: 'Restaurant',
    description: `Find a local restaurant for lunch in ${destination}.`,
    startTime: '13:00',
    durationMinutes: mealDuration,
    mealType: 'lunch',
    travelToNext: null,
    photoUrl: null,
    location: null,
    address: null,
    rating: null,
    ratingCount: null,
    hasHours: false,
    weekdayDescriptions: null,
  });
}

// Search term used when adopting a real place for a location-less meal, by meal
// type - breakfast wants a cafe, lunch and dinner a restaurant.
const MEAL_SEARCH_QUERY = {
  breakfast: 'breakfast cafe',
  lunch: 'restaurant',
  dinner: 'restaurant',
};

// A meal that reaches this point with no real location is either an
// ensureBreakfast/ensureLunch/ensureDinner backstop (Claude omitted the meal) or a meal Claude
// named that never resolved against Google. Either way the card would read
// "find a local restaurant" with no real place, which is exactly what Akber
// flagged (1 Aug 2026): a meal must always be a real place. So for each
// location-less meal, search for a genuine restaurant near where the traveller
// already is - the nearest neighbouring stop that did resolve, falling back to
// the destination centre - and adopt it. photoUrl stays null (findNearbyCandidates
// deliberately skips the billable Place Photo fetch), so the card shows a real
// name, address and map pin without a photo, which is a real place, not a
// placeholder. If nothing suitable turns up (genuinely no nearby restaurant, or
// the search fails), the honest "find a restaurant" text is left in place rather
// than adopting a wrong or far-flung place.
// A one-line description for a meal stop adopted from a nearby search, composed
// from Google's own place types rather than written by the model.
//
// The previous line was `${label} at ${pick.name}.` - the stop's own name read
// back at you, marketing suffix and all ("Breakfast at The Morning Folks
// Oshiage | Coffee & American Breakfast."). Beside cards with real descriptions
// it looked like something had failed.
//
// It says what kind of place it is, not what is good there. Google's types are
// specific enough to be worth reading (ramen_restaurant, bakery, coffee_shop,
// meze_restaurant), and every word of it is verified. Describing the food
// itself would mean asking the model to infer from a name, which is exactly the
// class of unverified claim sanitizeDescriptions exists to strip.
//
// Falls back to the meal label when Google offers nothing but the generic types
// every business carries.
const FOOD_TYPE_LABELS = {
  coffee_shop: 'Coffee shop',
  cafe: 'Café',
  bakery: 'Bakery',
  breakfast_restaurant: 'Breakfast spot',
  brunch_restaurant: 'Brunch spot',
  fast_food_restaurant: 'Fast food counter',
  meal_takeaway: 'Takeaway counter',
  ice_cream_shop: 'Ice cream shop',
  dessert_shop: 'Dessert shop',
  bar: 'Bar',
  pub: 'Pub',
  wine_bar: 'Wine bar',
  steak_house: 'Steakhouse',
  sushi_restaurant: 'Sushi restaurant',
  ramen_restaurant: 'Ramen restaurant',
  pizza_restaurant: 'Pizzeria',
  seafood_restaurant: 'Seafood restaurant',
  vegetarian_restaurant: 'Vegetarian restaurant',
  vegan_restaurant: 'Vegan restaurant',
  barbecue_restaurant: 'Barbecue restaurant',
  sandwich_shop: 'Sandwich shop',
  restaurant: 'Restaurant',
};

// Cuisine types follow a "<x>_restaurant" pattern that needs no lookup table -
// turkish_restaurant reads as "Turkish restaurant" on its own.
function foodLabelFor(type) {
  if (FOOD_TYPE_LABELS[type]) return FOOD_TYPE_LABELS[type];
  if (!type.endsWith('_restaurant')) return null;
  const cuisine = type.slice(0, -'_restaurant'.length).split('_').join(' ');
  if (!cuisine) return null;
  return cuisine.charAt(0).toUpperCase() + cuisine.slice(1) + ' restaurant';
}

// Two labels at most, and never the bare "Restaurant" alongside something more
// specific - "Ramen restaurant and restaurant" helps nobody.
function describeAdoptedMeal(pick, mealType) {
  const labels: string[] = [];
  for (const type of pick.types || []) {
    const label = foodLabelFor(type);
    if (label && !labels.includes(label)) labels.push(label);
    if (labels.length === 2) break;
  }
  const specific = labels.filter((l) => l !== 'Restaurant');
  const chosen = (specific.length > 0 ? specific : labels).slice(0, 2);

  const meal = mealType ? mealType.charAt(0).toUpperCase() + mealType.slice(1) : 'Meal';
  if (chosen.length === 0) {
    return pick.neighbourhood ? `${meal} in ${pick.neighbourhood}.` : `${meal} stop.`;
  }

  const what = chosen.length === 2 ? `${chosen[0]} and ${chosen[1].toLowerCase()}` : chosen[0];
  return pick.neighbourhood ? `${what} in ${pick.neighbourhood}.` : `${what}.`;
}

async function resolveMealPlaceholders(day, anchor, usedPlaceIds) {
  for (let i = 0; i < day.items.length; i++) {
    const item = day.items[i];
    if (!item.mealType || item.location) {
      continue;
    }

    let near = null;
    for (let j = i - 1; j >= 0 && !near; j--) {
      if (day.items[j].location) near = day.items[j].location;
    }
    for (let j = i + 1; j < day.items.length && !near; j++) {
      if (day.items[j].location) near = day.items[j].location;
    }
    const query = MEAL_SEARCH_QUERY[item.mealType] || 'restaurant';
    const pickNear = async (loc) => {
      if (!loc) return null;
      const candidates = await findNearbyCandidates(query, null, loc).catch(() => []);
      const usable = candidates.filter(
        (c) =>
          c.location &&
          !usedPlaceIds.has(c.placeId) &&
          (!anchor || haversineMeters(anchor, c.location) <= MAX_BROAD_DISTANCE_METERS)
      );
      return preferWithPhoto(usable);
    };

    // Prefer a place near the adjacent stop; fall back to the destination centre
    // so a meal in a sparse area (or with no resolved neighbour) still lands a
    // real place rather than staying a placeholder.
    let pick = await pickNear(near);
    if (!pick && anchor && anchor !== near) {
      pick = await pickNear(anchor);
    }
    if (!pick) {
      continue;
    }

    item.name = pick.name;
    item.address = pick.address;
    item.location = pick.location;
    item.rating = null;
    item.ratingCount = null;
    item.photoUrl = pick.availablePhotoUrl || null;
    item.hasHours = pick.hasHours || false;
    item.weekdayDescriptions = pick.weekdayDescriptions || null;
    item.categoryTag = composeCategoryTag(item, pick);
    item.description = describeAdoptedMeal(pick, item.mealType);
    usedPlaceIds.add(pick.placeId);
  }
}

// Bookends a single day with the real accommodation: a departure/breakfast
// stop first, a return stop last. Per Akber's call (9 Jul 2026). Skipped
// entirely if the accommodation has no real coordinates (accommodationDetails
// missing, or an older saved trip from before location was captured) - a
// bookend stop that can't be routed to/from would just be a dead entry with
// no travel time, worse than not adding it.
function applyAccommodationBookends(day, accommodationDetails, mealDuration) {
  if (!accommodationDetails?.location) {
    return;
  }

  const items = day.items;

  if (day.breakfastAtAccommodation) {
    // Defensive: the prompt tells Claude not to include a breakfast item on
    // these days, but if it slips through anyway, drop it rather than show
    // two breakfasts.
    day.items = items.filter((item) => item.mealType !== 'breakfast');

    const breakfastTime = clampToWindow(day.breakfastTime || MEAL_WINDOWS.breakfast.start, MEAL_WINDOWS.breakfast);
    day.items.unshift(
      buildAccommodationItem(accommodationDetails, {
        startTime: breakfastTime,
        durationMinutes: mealDuration,
        mealType: 'breakfast',
        description: `Breakfast at ${accommodationDetails.name}.`,
      })
    );
  } else {
    // The depart stop's time is set to the real breakfast item's own
    // (already window-clamped) startTime - since the depart stop has zero
    // duration, the forward cascade in realignScheduleTimes then pushes
    // breakfast's own startTime out to depart-time + real travel time, so
    // the two stay consistent with each other rather than the depart time
    // being an independent guess.
    const breakfast = items.find((item) => item.mealType === 'breakfast');
    const departTime = breakfast?.startTime || MEAL_WINDOWS.breakfast.start;
    items.unshift(
      buildAccommodationItem(accommodationDetails, {
        startTime: departTime,
        // Imperative tense ("Leave", not "Leaving") - Akber's preferred
        // wording for card copy generally, not just this line.
        description: `Leave ${accommodationDetails.name} for breakfast.`,
      })
    );
  }

  const finalItems = day.items;
  const lastReal = finalItems[finalItems.length - 1];
  // Placeholder only - realignScheduleTimes overwrites this with the real
  // cascaded value once travel times are known, same as every other stop.
  // Only stands if that cascade can't run at all (no travelToNext could be
  // found even via the Claude-estimate fallback), so it's still a reasonable
  // guess rather than a wrong-looking null.
  const placeholderStart =
    lastReal?.startTime && lastReal?.durationMinutes != null
      ? addMinutesToTime(lastReal.startTime, lastReal.durationMinutes)
      : lastReal?.startTime || null;

  finalItems.push(
    buildAccommodationItem(accommodationDetails, {
      startTime: placeholderStart,
      description: `Back at ${accommodationDetails.name}.`,
    })
  );
}

// Nothing on any day may start before 9am (Akber's call, 9 Jul 2026). The
// meal-window clamp in enforceMealConstraints already guarantees this for
// the normal case (the day always opens on a breakfast-derived stop, whether
// that's the real breakfast item or an accommodation bookend), so in
// practice this is a backstop - the one case it actually matters is an older
// saved trip / a hotel with no captured location, where
// applyAccommodationBookends is skipped entirely and the day could still
// open on a non-meal item with an out-of-range startTime.
function enforceEarliestStart(day) {
  const first = day.items[0];
  if (first?.startTime && timeToMinutes(first.startTime) < timeToMinutes('09:00')) {
    first.startTime = '09:00';
  }
}

// Same-day consecutive stops shouldn't require an unreasonable drive - if
// they do, it's almost always a sign the "next" stop resolved to the wrong
// real-world place (right name, wrong region) rather than a genuine long
// day-trip. 120 minutes (2 hours) per Akber's call - generous enough for a
// real excursion, tight enough to catch cases like a same-named place
// resolving hundreds of km away. See BUILD-LOG.md.
const MAX_SAME_DAY_TRAVEL_MINUTES = 60;

async function verifyWithRetry(item, destination, anchor) {
  let result = await verifyPlace({ name: item.name, destination: destination, type: item.type, anchor });
  if (result.status === 'check_failed') {
    result = await verifyPlace({ name: item.name, destination: destination, type: item.type, anchor });
  }
  return result;
}

function hasUsableRating(candidate) {
  return typeof candidate.rating === 'number';
}

// anchor is the destination's own geocoded center - a candidate real, well-
// rated place that's actually hundreds of km away (right name, wrong
// region) is worse than no substitute at all. Mirrors the same check
// verifyPlace.js already applies to its broad-search "found" path; this
// closes the gap where a substitute picked from suggestions skipped that
// check entirely, which is how a real "Pearl Farm" match on the other side
// of the country slipped through undetected.
// Among candidates that already passed every correctness check, prefer one that
// has a photo.
//
// findNearbyCandidates and runSearch both return their results already sorted
// by qualityScore, so this only reorders within a set that is entirely
// acceptable - it never lets a photo outrank the distance, rating or
// duplicate checks, which run first. The effect is that a stop adopted as a
// substitute arrives looking like every other stop instead of falling through
// to the grey placeholder, which is the whole reason a real place was
// substituted in the first place.
//
// Deliberately a preference, not a requirement: a genuinely better place with
// no photo still gets used when nothing else qualifies.
function preferWithPhoto(candidates) {
  return candidates.find((candidate) => candidate.availablePhotoUrl) || candidates[0] || null;
}

function pickSubstitute(suggestions, usedPlaceIds, anchor) {
  if (!suggestions) {
    return null;
  }

  const acceptable = suggestions.filter((candidate) => {
    if (!hasUsableRating(candidate)) return false;
    if (usedPlaceIds.has(candidate.placeId)) return false;
    if (anchor && candidate.location) {
      if (haversineMeters(anchor, candidate.location) > MAX_BROAD_DISTANCE_METERS) return false;
    }
    return true;
  });

  return preferWithPhoto(acceptable);
}

// categoryTag is the small grey line under a stop's name ("Museum · Indoor").
// generateRawItinerary.js asks Claude for it in "Type · Descriptor" format, but
// nothing ever checked what came back, and on a Valencia run it returned the
// street number on three hotels out of three - "Hotel · 32" against an address
// of "Pg. de l'Albereda, 32". Once a real place is attached, Google already
// knows both halves better than the model does, so compose it here and treat
// Claude's version as the fallback rather than the source.
//
// The type half maps Google's place types to something a person would say. The
// list is deliberately short: it covers what actually shows up in itineraries,
// and anything unmapped falls through to a title-cased version of the first
// non-generic type, which reads fine for the long tail ("art_gallery" ->
// "Art gallery").
const PLACE_TYPE_LABELS = {
  lodging: 'Hotel',
  hotel: 'Hotel',
  restaurant: 'Restaurant',
  cafe: 'Café',
  coffee_shop: 'Café',
  bakery: 'Bakery',
  bar: 'Bar',
  night_club: 'Nightlife',
  museum: 'Museum',
  art_gallery: 'Gallery',
  tourist_attraction: 'Landmark',
  historical_landmark: 'Landmark',
  historical_place: 'Landmark',
  church: 'Landmark',
  place_of_worship: 'Landmark',
  park: 'Park',
  national_park: 'Park',
  garden: 'Garden',
  botanical_garden: 'Garden',
  beach: 'Beach',
  zoo: 'Zoo',
  aquarium: 'Aquarium',
  market: 'Market',
  shopping_mall: 'Shopping',
  store: 'Shop',
  stadium: 'Stadium',
  amusement_park: 'Attraction',
  spa: 'Spa',
  movie_theater: 'Cinema',
  performing_arts_theater: 'Theatre',
};

// Types Google attaches to almost everything - useless as a label on their own.
const GENERIC_PLACE_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'food',
  'tourist_destination',
  'premise',
  'geocode',
]);

function titleCaseType(type) {
  const words = type.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function labelForTypes(types) {
  if (!Array.isArray(types)) return null;
  for (const type of types) {
    if (PLACE_TYPE_LABELS[type]) return PLACE_TYPE_LABELS[type];
  }
  const firstUseful = types.find((type) => !GENERIC_PLACE_TYPES.has(type));
  return firstUseful ? titleCaseType(firstUseful) : null;
}

// Falls back in stages rather than all-or-nothing: a real type with no
// neighbourhood still beats Claude's guess, and Claude's guess still beats an
// empty line. An accommodation always reads "Hotel" regardless of what Google
// calls it, since that is what it is to this traveller.
function composeCategoryTag(item, place) {
  const typeLabel =
    item.type === 'accommodation' ? 'Hotel' : labelForTypes(place?.types);
  const area = place?.neighbourhood;

  if (typeLabel && area) return `${typeLabel} · ${area}`;
  if (typeLabel) return typeLabel;
  return item.categoryTag || null;
}

function applyResolution(item, result, usedPlaceIds, anchor) {
  if (result.status === 'found') {
    // Same real place already used earlier in the trip? This happens when
    // Claude proposes two distinct-sounding stops that Google resolves to the
    // same listing - e.g. "Lahore Fort" and the "Sheesh Mahal" palace inside
    // it both resolving to the Lahore Fort place ID - so the itinerary would
    // otherwise show the same place twice, back to back. The dedup below only
    // guarded the substitute (not_found) path; a successful match had none.
    // Flag it for removal rather than mutating it; resolveItinerary drops
    // flagged items before anything else runs. First occurrence wins.
    if (usedPlaceIds.has(result.placeId)) {
      item._duplicatePlace = true;
      return;
    }
    item.name = result.name;
    item.address = result.address;
    item.rating = result.rating;
    item.ratingCount = result.ratingCount;
    item.photoUrl = result.photoUrl;
    item.hasHours = result.hasHours;
    item.weekdayDescriptions = result.weekdayDescriptions;
    item.location = result.location;
    item.categoryTag = composeCategoryTag(item, result);
    usedPlaceIds.add(result.placeId);
    return;
  }

  const suggestions = result.status === 'not_found' ? result.suggestions : null;
  const substitute = pickSubstitute(suggestions, usedPlaceIds, anchor);

  if (substitute) {
    item.name = substitute.name;
    item.address = substitute.address;
    item.rating = substitute.rating;
    item.ratingCount = substitute.ratingCount;
    // substitute.photoUrl is null by design (see toSuggestion); a candidate that
    // is actually adopted gets the real URL, same as any other resolved stop.
    item.photoUrl = substitute.availablePhotoUrl || substitute.photoUrl || null;
    item.hasHours = substitute.hasHours;
    item.weekdayDescriptions = substitute.weekdayDescriptions;
    item.location = substitute.location;
    item.categoryTag = composeCategoryTag(item, substitute);
    usedPlaceIds.add(substitute.placeId);
    return;
  }

  item.address = item.address || null;
  item.rating = item.rating || null;
  item.ratingCount = item.ratingCount || null;
  item.photoUrl = item.photoUrl || null;
  item.hasHours = item.hasHours || false;
  item.weekdayDescriptions = item.weekdayDescriptions || null;
  item.location = item.location || null;
}

// The non-meal counterpart to resolveMealPlaceholders above.
//
// Meals get substituted rather than dropped because one restaurant near where
// you already are genuinely serves the same purpose as another. An activity
// does not: swapping a museum for whatever attraction happens to be nearby
// changes what the day is about, and findNearbyCandidates returns no editorial
// text (see its Pro-tier field mask), so an adopted place would inherit the
// description Claude wrote about the place it replaced. That is precisely the
// failure this is meant to remove, so an activity that never resolved is
// dropped instead.
//
// Why this exists: MapView only pins items with a real location ("never guess
// a location"), so an unresolved stop was already invisible on the map - but it
// still rendered as a full itinerary card with a time, a duration and a travel
// leg, indistinguishable from a verified one. A Valencia day 2 shipped four of
// these (a promenade, a marina, a museum that does not exist under that name,
// and a beach club that is in Malaga), all reading as real plans.
//
// Dropping runs before travel times are computed, so the remaining stops route
// against each other directly rather than through a hole. The day is left
// shorter, which the existing stretchPreDinnerGap / realignScheduleTimes /
// snapArrivalsToGrid passes already absorb - a shorter day of real places is
// the honest outcome, and better than a full day that includes invented ones.
//
// Accommodation bookends are exempt: their location comes from the hotel the
// traveller picked on the Accommodation screen, not from verification, and
// applyAccommodationBookends already handles a missing one.
// Last line of defence on categoryTag, in the same spirit as
// sanitizeDescriptions: composeCategoryTag now runs on every path that attaches
// a real place, but the field is a plain string that several passes can touch,
// and one stale value slipping through renders as "Landmark · 3" - a street
// number where a neighbourhood should be, which is exactly the tell that makes
// the rest of a card look untrustworthy.
//
// Rather than track down every writer, this checks the finished value: if the
// descriptor half is missing or reads like a number ("3", "12", "1-chōme"), the
// type half is kept on its own. "Landmark" alone is honest and unremarkable;
// "Landmark · 3" is neither.
function sanitizeCategoryTags(days) {
  let fixed = 0;

  for (const day of days) {
    for (const item of day.items) {
      const tag = item.categoryTag;
      if (typeof tag !== 'string' || !tag.includes('·')) continue;

      const [type, ...rest] = tag.split('·');
      const descriptor = rest.join('·').trim();
      if (descriptor && !/^\d/.test(descriptor)) continue;

      item.categoryTag = type.trim() || null;
      fixed += 1;
    }
  }

  return fixed;
}

function dropUnresolvedActivities(day) {
  const dropped: string[] = [];

  day.items = day.items.filter((item) => {
    if (item.type === 'accommodation') return true;
    if (item.mealType) return true;
    if (item.location) return true;
    dropped.push(item.name);
    return false;
  });

  return dropped;
}

// stretchPreDinnerGap (afternoon gap-fill that keeps dinner parked in its
// window while leaving no dead time) now lives in _lib/scheduleRealign.js so
// the swap/reorder recompute path fills the pre-dinner gap identically.
// Imported at the top of this file.

// roundStayDurations and snapArrivalsToGrid (the 15-minute grid + missing-leg
// gap fill) now live in _lib/scheduleRealign.js so the swap/reorder recompute
// path applies exactly the same treatment - see the import at the top of this
// file and their definitions there.

// Backstop for whatever slips past the anchor-distance checks above (road
// routing occasionally goes the long way round even between two genuinely
// nearby points, and this also catches anything the primary/broad search
// paths missed). Runs after real travel times are computed, so it's acting
// on grounded data, not a guess. Only one retry per offending pair - if a
// closer alternative can't be found, the original stands rather than
// risking a worse substitute or an infinite loop.
async function enforceDriveCap(day, transport, usedPlaceIds) {
  for (let i = 0; i < day.items.length - 1; i++) {
    const current = day.items[i];
    const next = day.items[i + 1];
    const parsed = parseTravelMinutes(current.travelToNext);

    if (!parsed || parsed.minutes <= MAX_SAME_DAY_TRAVEL_MINUTES) {
      continue;
    }
    if (!current.location) {
      continue;
    }
    // Never substitute the accommodation itself - unlike every other stop,
    // it's not a suggestion this pipeline picked, it's the real, specific
    // hotel the traveller chose and booked on the Accommodation screen. A
    // long drive back to it on a far-flung day is a real, honest number to
    // show, not a sign something resolved to the wrong place.
    if (next.type === 'accommodation') {
      continue;
    }

    // First try: find something close with the same name/type.
    let nearby = await findNearbyCandidates(next.name, next.type, current.location).catch(() => []);
    let replacement = preferWithPhoto(
      nearby.filter(
        (candidate) => hasUsableRating(candidate) && !usedPlaceIds.has(candidate.placeId)
      )
    );

    // Fallback: if the specific search found nothing, search by category alone
    // (e.g. just "activity" or "restaurant") near the current location. This
    // fires when the named place is in a different city entirely and no
    // same-named alternative exists nearby.
    if (!replacement && next.type) {
      const fallbackNearby = await findNearbyCandidates(next.type, next.type, current.location).catch(() => []);
      replacement = preferWithPhoto(
        fallbackNearby.filter(
          (candidate) => hasUsableRating(candidate) && !usedPlaceIds.has(candidate.placeId)
        )
      );
    }

    if (!replacement) {
      continue;
    }

    next.name = replacement.name;
    next.address = replacement.address;
    next.rating = replacement.rating;
    next.ratingCount = replacement.ratingCount;
    next.photoUrl = replacement.availablePhotoUrl || replacement.photoUrl || null;
    next.hasHours = replacement.hasHours;
    next.weekdayDescriptions = replacement.weekdayDescriptions;
    next.location = replacement.location;
    // The stop is now a different place, so its tag has to be rebuilt from the
    // new one. Without this it kept the tag belonging to the place it replaced.
    next.categoryTag = composeCategoryTag(next, replacement);
    usedPlaceIds.add(replacement.placeId);

    current.travelToNext = await travelBetween(current.location, next.location, transport).catch(() => null);

    // next's own travelToNext (to whatever comes after it) was computed
    // against its old location and is now stale too.
    const after = day.items[i + 2];
    if (after && after.location && next.location) {
      next.travelToNext = await travelBetween(next.location, after.location, transport).catch(() => null);
    }
  }
}

async function resolveItinerary(itinerary, destination, anchor, transport, accommodationDetails) {
  const usedPlaceIds = new Set();

  // Slow & Immersive (pacingLabel 'Relaxed', set by computePacing in
  // generateRawItinerary.js) gives every meal a longer, unhurried sitting;
  // every other variant keeps the standard 60. Chosen once per variant here
  // and handed to each meal-building step below so the whole day is built
  // around the right length from the start.
  const mealDuration =
    itinerary.pacingLabel === 'Relaxed'
      ? SLOW_MEAL_DURATION_MINUTES
      : FIXED_MEAL_DURATION_MINUTES;

  // Claude sometimes returns a day's items in non-chronological order (e.g. a
  // breakfast item with startTime 09:00 landing at array index 3, after items
  // whose startTimes are 11:00 and 13:00). Every downstream step - allItems
  // indexing, realignScheduleTimes' i-1→i chain, stretchPreDinnerGap's
  // "last activity before dinner" scan - assumes items are in time order, so
  // an out-of-order array produces a jumbled schedule where time appears to go
  // backwards and duplicate meal labels appear mid-day. Sorting here, before
  // anything else touches the array, fixes that at the root.
  itinerary.days.forEach((day) => {
    day.items.sort((a, b) => {
      const aMin = timeToMinutes(a.startTime);
      const bMin = timeToMinutes(b.startTime);
      if (aMin == null && bMin == null) return 0;
      if (aMin == null) return 1;
      if (bMin == null) return -1;
      return aMin - bMin;
    });
  });

  const allItems: any[] = [];

  itinerary.days.forEach((day) => {
    day.items.forEach((item) => {
      allItems.push(item);
    });
  });

  const results = await Promise.all(
    allItems.map((item) =>
      verifyWithRetry(item, destination, anchor).catch((err) => ({
        status: 'check_failed',
        reason: 'unexpected_error',
        error: err.message
      }))
    )
  );

  allItems.forEach((item, index) => {
    applyResolution(item, results[index], usedPlaceIds, anchor);
  });

  // Remove any stop applyResolution flagged as a duplicate real place (two
  // proposed stops resolving to the same Google listing). Done here, before
  // description refresh, meal constraints, bookends and travel times, so every
  // downstream step sees the deduped day. resolvedItems mirrors allItems minus
  // the dropped stops so the description pass doesn't re-audit a removed item.
  itinerary.days.forEach((day) => {
    day.items = day.items.filter((item) => !item._duplicatePlace);
  });
  const resolvedItems = allItems.filter((item) => !item._duplicatePlace);

  // Every item gets audited here, not just the ones verification changed -
  // a "found, exact name match" item can still carry a description that
  // contradicts its own real name (e.g. Claude both named and described a
  // place called "Smack Burger" as "a chic brunch café" in the same
  // generation pass, with nothing ever having checked the pairing itself).
  // A match-score-based filter would miss that case entirely, since the
  // name was never substituted - see refreshDescriptions.js.
  try {
    await refreshDescriptions(resolvedItems);
  } catch (error) {
    // Non-fatal - worst case a mismatched-but-real description from before
    // stays in place, same as if this feature didn't exist.
    console.error('[generate-resolved-itinerary] description refresh failed:', error.message);
  }

  // Meal windows/durations first (touches only the real items Claude
  // generated), then bookend every day with the real accommodation - both
  // need to happen before computeTravelTimes below, since the bookend stops
  // need to already be in day.items for real routing to reach them, and
  // enforceEarliestStart needs the day's final item order to check the
  // right item.
  itinerary.days.forEach((day) => {
    enforceMealConstraints(day, mealDuration);
    ensureBreakfast(day, destination, mealDuration);
    ensureLunch(day, destination, mealDuration);
    ensureDinner(day, destination, mealDuration);
    // ensureLunch pushes a 13:00 item to the end of the array; re-sort so it
    // lands in its real midday slot before bookends wrap the day and before
    // resolveMealPlaceholders and travel times run on the ordered list.
    day.items.sort((a, b) => {
      const aMin = timeToMinutes(a.startTime);
      const bMin = timeToMinutes(b.startTime);
      if (aMin == null && bMin == null) return 0;
      if (aMin == null) return 1;
      if (bMin == null) return -1;
      return aMin - bMin;
    });
    applyAccommodationBookends(day, accommodationDetails, mealDuration);
    enforceEarliestStart(day);
  });

  // Turn any meal that still has no real location - the ensureLunch/ensureDinner
  // backstops, or a meal Claude named that never resolved - into a genuine
  // nearby restaurant, so a meal card is never a bare "find a restaurant"
  // placeholder (Akber, 1 Aug 2026). Sequential, not Promise.all, so the shared
  // usedPlaceIds stays consistent and two days can't adopt the same restaurant.
  for (const day of itinerary.days) {
    await resolveMealPlaceholders(day, anchor, usedPlaceIds);
  }

  // Then remove any non-meal stop that never resolved to a real place, so an
  // unverified stop can't ship looking exactly like a verified one. Runs after
  // the meal pass (which gives meals their own second chance) and before travel
  // times, so nothing routes through a stop that isn't there.
  itinerary.days.forEach((day) => {
    const dropped = dropUnresolvedActivities(day);
    if (dropped.length > 0) {
      console.warn(
        `[generate-resolved-itinerary] day ${day.day}: dropped ${dropped.length} unresolved stop(s): ${dropped.join(', ')}`
      );
    }
  });

  // Runs after the description audit, not before: refreshDescriptions can
  // rewrite a description, and a rewrite is just as capable of asserting a
  // travel time as the original was. This is the last thing to touch
  // description text, so it is the only place the guarantee can hold.
  const retagged = sanitizeCategoryTags(itinerary.days);
  if (retagged > 0) {
    console.info(
      `[generate-resolved-itinerary] stripped a numeric descriptor from ${retagged} categoryTag(s)`
    );
  }

  const sanitized = sanitizeDescriptions(itinerary.days);
  if (sanitized.changed > 0) {
    console.info(
      `[generate-resolved-itinerary] stripped unverified time/distance claims from ${sanitized.changed} description(s)`
    );
  }
  if (sanitized.residual.length > 0) {
    // Mid-sentence claims the anchored patterns cannot remove without leaving a
    // fragment. Logged rather than mangled - the prompt rule is what should
    // stop these, and this is the signal for whether it is working.
    console.warn(
      `[generate-resolved-itinerary] description still contains an unverified claim: ${sanitized.residual.join(', ')}`
    );
  }

  await Promise.all(
    itinerary.days.map((day) => computeTravelTimes(day.items, transport))
  );

  // Sequential per day, not Promise.all - enforceDriveCap mutates
  // usedPlaceIds, and days shouldn't race each other over which one claims
  // a given nearby replacement first.
  for (const day of itinerary.days) {
    await enforceDriveCap(day, transport, usedPlaceIds);
  }

  // No shared state here (unlike enforceDriveCap above), so this can run
  // across all days at once.
  await Promise.all(
    itinerary.days.map((day) => fillMissingTravelTimes(day, transport, destination))
  );

  // Synchronous and last - every day's travelToNext values are now final,
  // so this is the one place the displayed schedule gets reconciled with
  // them.
  itinerary.days.forEach((day) => realignScheduleTimes(day));

  // All variants: absorb any pre-dinner gap by extending the last afternoon
  // Stretch the last pre-dinner activity to fill any gap, then re-cascade so
  // dinner and hotel return reflect the updated duration. Applies to all pacing
  // variants (Packed and Relaxed alike).
  itinerary.days.forEach((day) => {
    stretchPreDinnerGap(day);
    roundStayDurations(day);
    realignScheduleTimes(day);
    snapArrivalsToGrid(day, transport);
  });

  return itinerary;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Before anything billable. This is the single most expensive endpoint in
  // the app (one Claude draft + a Places lookup per stop + a Routes call per
  // leg, per variant), so the guard has to sit ahead of generateRawItinerary,
  // not inside resolveItinerary. See _lib/rateLimit.js for the ceilings and
  // why this fails open.
  const limit = await checkRateLimit('trip', req);
  if (!limit.allowed) {
    return rateLimitResponse(res, limit);
  }

  const destination = req.body.destination;
  const days = req.body.days;
  const budget = req.body.budget;
  const accommodation = req.body.accommodation;
  // The full hotel card (name, real coordinates, rating, photo) captured on
  // the Accommodation screen - accommodation above stays a plain name string
  // (that's all generateRawItinerary.js's prompt needs), but bookending every
  // day with a real, routable stop needs the whole thing. Optional/undefined
  // on older clients or saved trips from before this existed - resolveItinerary
  // just skips bookending in that case (see applyAccommodationBookends).
  const accommodationDetails = req.body.accommodationDetails;
  const interests = req.body.interests;
  const adults = req.body.adults;
  const transport = req.body.transport;

  if (!destination || !days) {
    return res.status(400).json({ error: 'destination and days are required' });
  }

  let raw;
  let anchor;
  try {
    const [rawResult, anchorResult] = await Promise.all([
      generateRawItinerary({ destination, days, budget, accommodation, interests, adults }),
      geocodeDestination(destination).catch(() => null)
    ]);
    raw = rawResult;
    anchor = anchorResult;
  } catch (error) {
    // Out of Anthropic credit is not a bug and must not render as one. It is
    // reported here as the same shape the daily cap uses, so the client shows
    // the example trip rather than "We hit a snag" - see Generating.jsx.
    // Logged at error level regardless, because from the operator's side this
    // absolutely is something to act on.
    if (isCapacityError(error)) {
      console.error('[generate-resolved-itinerary] upstream capacity exhausted:', error.message);
      return res.status(429).json({
        error:
          "Roam has reached its planning limit for now. Here's an example trip in the meantime.",
        code: 'RATE_LIMITED',
        scope: 'capacity',
      });
    }
    if (error.rawText) {
      return res.status(500).json({ error: error.message, raw: error.rawText });
    }
    return res.status(500).json({ error: error.message });
  }

  try {
    // Resolve both variants in parallel - each is independent of the other,
    // so there's no reason to wait for packed before starting slow.
    await Promise.all([
      raw.packed ? resolveItinerary(raw.packed, destination, anchor, transport, accommodationDetails) : Promise.resolve(),
      raw.slow ? resolveItinerary(raw.slow, destination, anchor, transport, accommodationDetails) : Promise.resolve(),
    ]);
    res.status(200).json(raw);
  } catch (error) {
    // Same treatment for the resolution half: the place, route and description
    // passes each call out too, so credit can run dry after the draft succeeds.
    if (isCapacityError(error)) {
      console.error('[generate-resolved-itinerary] upstream capacity exhausted:', error.message);
      return res.status(429).json({
        error:
          "Roam has reached its planning limit for now. Here's an example trip in the meantime.",
        code: 'RATE_LIMITED',
        scope: 'capacity',
      });
    }
    res.status(500).json({ error: error.message });
  }
}
