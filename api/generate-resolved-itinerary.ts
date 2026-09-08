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
  clampStayDurations,
  dayCutoffMinutes
} from './_lib/scheduleRealign.js';
import { applyFixedSchedule, dedupeMeals, starvedBlocks, unsuitableStops, roomForAnotherStop, eveningInsertPoint, hasEnoughReviews, numberedStopCount, MAX_NUMBERED_STOPS_PER_DAY } from './_lib/fixedSchedule.js';
import { sortByBudgetFit, isOffBandDining } from './_lib/budgetFit.js';
import { uncoveredInterests, satisfiesInterest, isEveningInterest } from './_lib/interestCoverage.js';
import { weekdayForDay, isOpenAt } from './_lib/openingHours.js';
import { shapeOf, REORDER_REVERSAL_DEGREES } from './_lib/routeShape.js';
import { describeAdoptedStops, stripAdoptionMarkers } from './_lib/describeAdoptedStops.js';

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
// Nothing on an unhurried day should be a 45-minute stop.
const SLOW_MIN_STAY_MINUTES = 75;

function clampToWindow(time, window) {
  const minutes = timeToMinutes(time);
  const startMinutes = timeToMinutes(window.start);
  const endMinutes = timeToMinutes(window.end);
  // A window whose own bounds will not parse cannot clamp anything, so the time
  // is handed back untouched rather than snapped to a value that means nothing.
  if (minutes == null || startMinutes == null || endMinutes == null) {
    return minutes == null ? window.start : time;
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

async function resolveMealPlaceholders(day, anchor, usedPlaceIds, stay, usedBrands, budget, weekdayIndex) {
  for (let i = 0; i < day.items.length; i++) {
    const item = day.items[i];
    if (!item.mealType) continue;
    if (item.location) {
      // A meal the model chose and that verified normally still claims its
      // brand, or the guard would only stop substitutions repeating a chain
      // while leaving the model free to.
      usedBrands.add(brandKey(item.name, neighbourhoodOf(item)));
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
    const mealMinutes = timeToMinutes(item.startTime);
    const openAtMealTime = (candidate) => {
      if (weekdayIndex == null || mealMinutes == null) return true;
      if (!candidate.weekdayDescriptions) return true; // silence is not evidence
      return isOpenAt(candidate.weekdayDescriptions, weekdayIndex, mealMinutes) !== false;
    };
    const pickNear = async (loc) => {
      if (!loc) return null;
      const candidates = await findNearbyCandidates(query, null, loc).catch(() => []);
      const usable = candidates.filter(
        (c) =>
          c.location &&
          !usedPlaceIds.has(c.placeId) &&
          !sharesBrand(c.name, usedBrands, neighbourhoodOf(c)) &&
          hasReadableName(c.name) &&
          (!anchor || haversineMeters(anchor, c.location) <= MAX_BROAD_DISTANCE_METERS) &&
          withinReachOfStay(c.location, stay) &&
          // Open at the hour this meal actually sits at. Without this the
          // re-adoption below could hand back another restaurant that is shut at
          // 20:00, the check would drop it again next round, and the day would
          // spend its three rounds swapping one closed dinner for another.
          openAtMealTime(c) &&
          // Or the re-placement puts back what the check just rejected.
          !isOffBandDining(c.name, budget)
      );
      // Budget first, then fame. Reordering rather than filtering, so a band
      // with nothing nearby still gets the best available place instead of
      // nothing (see budgetFit.ts).
      const ranked = sortByBudgetFit(usable, budget);
      return preferWellKnown(ranked.filter((c) => c.availablePhotoUrl)) || preferWithPhoto(ranked);
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
    // The candidate came back from a Places search that asks for rating and
    // userRatingCount, and nulling them here threw away the only evidence of
    // whether anyone has ever been to the place. It also meant an adopted stop
    // rendered without the star its card is built to show, which is why the
    // shipped demo carried a rating on 4 of its 21 stops.
    item.rating = pick.rating ?? null;
    item.ratingCount = pick.ratingCount ?? null;
    item.priceLevel = pick.priceLevel ?? null;
    item.photoUrl = pick.availablePhotoUrl || null;
    item.hasHours = pick.hasHours || false;
    item.weekdayDescriptions = pick.weekdayDescriptions || null;
    item.categoryTag = composeCategoryTag(item, pick);
    // The stop is now a different place, so it needs that place's id. Adoption
    // never set this: the id only ever went into usedPlaceIds. That was invisible
    // while adoption only filled in a meal that had no id to begin with, and
    // stopped being invisible once a meal rejected for its hours was emptied and
    // re-adopted - emptying set the id to null and nothing put a new one back.
    // A stop with no id cannot be deduped, swapped or re-verified.
    item.placeId = pick.placeId;
    item.description = describeAdoptedMeal(pick, item.mealType);
    item.adoptedFrom = { neighbourhood: pick.neighbourhood, types: pick.types };
    item.placeTypes = pick.types || null;
    usedPlaceIds.add(pick.placeId);
    usedBrands.add(brandKey(pick.name, neighbourhoodOf(pick)));
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
const EARLIEST_START_MINUTES = 9 * 60;

function enforceEarliestStart(day) {
  const first = day.items[0];
  const startsAt = first?.startTime ? timeToMinutes(first.startTime) : null;
  if (startsAt != null && startsAt < EARLIEST_START_MINUTES) {
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

// Was hasUsableRating, checking typeof candidate.rating === 'number'. rating was
// removed from the Places field mask as Enterprise-tier, so it has been
// permanently undefined and this has returned false for every candidate since.
// It gates three substitution paths, all of which have therefore been dead:
// pickSubstitute, and both branches of enforceDriveCap - which means the
// 60-minute leg cap the case study describes has not actually been running
// (Akber, 4 Sep 2026).
//
// The point was to refuse a junk substitute. Rating is gone, so the test is now
// the same one every other substitution path uses: a real photo, a name a
// reader can use, and not a commemorative marker.
function isUsableCandidate(candidate) {
  if (!candidate.availablePhotoUrl) return false;
  if (!hasReadableName(candidate.name)) return false;
  if (MARKER_NAME_PATTERNS.some((pattern) => pattern.test(candidate.name))) return false;
  return true;
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
// Restaurants and cafés get no prominence bonus from qualityScore, because
// neither type is in PROMINENT_TYPES - correctly, since a good local restaurant
// is not a landmark. So a meal substitution needs its own idea of what counts as
// somewhere worth sending a traveller.
//
// It is review count. That is the closest thing Places offers to how many people
// actually go somewhere, and it separates the famous from the merely present in
// a way nothing else available does. The bar is deliberately high: a place with
// a thousand reviews in a major city is somewhere people seek out.
//
// This used to be a photo-count test, for the only reason that photo count was
// all the field mask still carried. It could not tell a chain branch from a
// destination, because a chain branch photographs just as well - which is how
// two branches of the same yakiniku chain served dinner on consecutive days of
// the Tokyo demo (Akber, 7 Sep 2026).
//
// A preference, never a requirement: candidates arrive already sorted by
// qualityScore, so falling through to the first is falling through to the best
// available rather than to nothing.
const WELL_KNOWN_RATING_COUNT = 1000;
const WELL_KNOWN_PHOTO_COUNT = 5;

function preferWellKnown(candidates) {
  return (
    candidates.find((c) => (c.ratingCount || 0) >= WELL_KNOWN_RATING_COUNT) ||
    candidates.find((c) => (c.photoCount || 0) >= WELL_KNOWN_PHOTO_COUNT) ||
    candidates[0] ||
    null
  );
}

// A trip should not eat at the same brand twice. Places gives no brand field, so
// this compares the significant words in the name: "Yakiniku Kokokara Roppongi
// Store" and "Yakiniku Kokokara Kinshicho Honten" share enough to be caught,
// while two unrelated ramen bars do not.
const BRAND_STOPWORDS = new Set([
  'the', 'and', 'cafe', 'café', 'bar', 'restaurant', 'store', 'shop', 'branch',
  'honten', 'ten', 'main', 'tokyo', 'kitchen', 'house', 'by', 'de', 'la', 'el',
  // Cuisine and format words. Two unrelated sushi counters share "sushi" and
  // must not read as one brand, so these are stripped before names are compared.
  'sushi', 'ramen', 'yakiniku', 'izakaya', 'noodle', 'noodles', 'soba', 'udon',
  'tempura', 'curry', 'grill', 'bakery', 'coffee', 'bistro', 'diner', 'eatery',
]);

// Everything left after the stopwords, run together. Hyphens and spacing are
// where the old version came apart: it took the first two significant words and
// compared those, so "MO-MO-PARADISE Shibuya Center-gai" keyed on
// "paradise shibuya" (the two "mo" fragments were too short to survive) while
// "Momo Paradise Shinjuku Higashi-guchi" keyed on "momo paradise", and the same
// chain served lunch and dinner on one day of the Tokyo demo. A leading word did
// the same damage: "Maidreamin Akihabara Head Store" against "Maidcafe
// Maidreamin Akihabara idol-dori Store" (Akber, 7 Sep 2026).
// Where a place is, taken from whichever field this object happens to carry it
// in: a fresh Places candidate has it directly, an adopted stop keeps it under
// adoptedFrom, and a stop the model chose has it as the second half of its
// category tag ("Restaurant · Shibuya").
function neighbourhoodOf(place) {
  if (!place) return null;
  if (place.neighbourhood) return place.neighbourhood;
  if (place.adoptedFrom && place.adoptedFrom.neighbourhood) return place.adoptedFrom.neighbourhood;
  const tag = String(place.categoryTag || '');
  const dot = tag.indexOf('·');
  return dot >= 0 ? tag.slice(dot + 1).trim() : null;
}

function brandKey(name, neighbourhood) {
  const key = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !BRAND_STOPWORDS.has(word))
    .join('');
  // A Tokyo restaurant is routinely named for the district it stands in, and
  // "shibuya" is seven characters, which is exactly the bar a shared run has to
  // clear. Without this, "Pokemon Center Shibuya" and "Tsukishima Monja Okoge
  // Shibuya" read as one chain. The district is where a place is, never who runs
  // it, so it comes out before anything is compared (Akber, 7 Sep 2026).
  const hood = String(neighbourhood || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (hood.length >= 4 && key.includes(hood)) {
    return key.split(hood).join('');
  }
  return key;
}

// The longest run of characters two names share once the generic words are gone.
// Seven is the shortest real chain name this has to catch ("ichiran"), and short
// enough coincidences do not reach it: "sushizanmai" and "sushiichiban" have
// nothing in common once "sushi" is a stopword.
const BRAND_MATCH_LENGTH = 7;

function longestSharedRun(a, b) {
  if (!a || !b) return 0;
  let best = 0;
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prevDiagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prevDiagonal + 1 : 0;
      if (row[j] > best) best = row[j];
      prevDiagonal = previous;
    }
  }
  return best;
}

function sharesBrand(name, usedBrands, neighbourhood) {
  const key = brandKey(name, neighbourhood);
  if (key.length < BRAND_MATCH_LENGTH) return false;
  for (const used of usedBrands) {
    if (longestSharedRun(key, used) >= BRAND_MATCH_LENGTH) return true;
  }
  return false;
}

function preferWithPhoto(candidates) {
  return candidates.find((candidate) => candidate.availablePhotoUrl) || candidates[0] || null;
}

function pickSubstitute(suggestions, usedPlaceIds, anchor, stay, budget) {
  if (!suggestions) {
    return null;
  }

  const acceptable = suggestions.filter((candidate) => {
    if (!isUsableCandidate(candidate)) return false;
    if (usedPlaceIds.has(candidate.placeId)) return false;
    if (anchor && candidate.location) {
      if (haversineMeters(anchor, candidate.location) > MAX_BROAD_DISTANCE_METERS) return false;
      if (!withinReachOfStay(candidate.location, stay)) return false;
    }
    return true;
  });

  // A substitution happens long after the model that read the budget band is
  // gone, so this is the only place the band can still be honoured for the
  // replacement.
  return preferWithPhoto(sortByBudgetFit(acceptable, budget));
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

function applyResolution(item, result, usedPlaceIds, anchor, stay, budget) {
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
    item.priceLevel = result.priceLevel ?? null;
    item.photoUrl = result.photoUrl;
    item.hasHours = result.hasHours;
    item.weekdayDescriptions = result.weekdayDescriptions;
    item.location = result.location;
    item.categoryTag = composeCategoryTag(item, result);
    // Google's raw types, kept for the interest check. categoryTag cannot stand
    // in for them: it collapses church, place_of_worship, historical_landmark and
    // tourist_attraction all into "Landmark", so a temple and a monument read
    // identically once it has been built.
    item.placeTypes = result.types || null;
    usedPlaceIds.add(result.placeId);
    return;
  }

  const suggestions = result.status === 'not_found' ? result.suggestions : null;
  const substitute = pickSubstitute(suggestions, usedPlaceIds, anchor, stay, budget);

  if (substitute) {
    item.name = substitute.name;
    item.address = substitute.address;
    item.rating = substitute.rating;
    item.ratingCount = substitute.ratingCount;
    item.priceLevel = substitute.priceLevel ?? null;
    // substitute.photoUrl is null by design (see toSuggestion); a candidate that
    // is actually adopted gets the real URL, same as any other resolved stop.
    item.photoUrl = substitute.availablePhotoUrl || substitute.photoUrl || null;
    item.hasHours = substitute.hasHours;
    item.weekdayDescriptions = substitute.weekdayDescriptions;
    item.location = substitute.location;
    item.categoryTag = composeCategoryTag(item, substitute);

    // The description has to go with the name. This pass replaced everything
    // else about the stop and left the model's prose in place, so a substituted
    // place shipped wearing a confident, specific description of the business it
    // replaced: "Roppongi Hills Club", a members' club, described as a 24-hour
    // ramen chain (Akber, 7 Sep 2026).
    //
    // Of everything this app can get wrong, that is the worst: a real place, a
    // real photo, and fluent text about somewhere else. describeAdoptedStops
    // rewrites it from the new place's own data at the end of the pipeline; the
    // line below is what it falls back to.
    item.description = item.mealType
      ? describeAdoptedMeal(substitute, item.mealType)
      : describeAdoptedActivity(substitute);
    item.adoptedFrom = { neighbourhood: substitute.neighbourhood, types: substitute.types };
    item.placeTypes = substitute.types || null;

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
// shorter, which applyFixedSchedule then fits around the meal anchors by
// lengthening what remains - a shorter day of real places is
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


// A backfilled or straightened stop has to be somewhere a person would spend
// an hour, not a thing they would walk past. Searching "landmark" near a point
// and taking the first photographed result put five markers into the demo: a
// flagpole, a playwright's birthplace plaque, the site of a legendary pine
// tree, and two "Site of ... Residence" stones. Google files all of those as
// landmarks, and it is not wrong, they are simply not somewhere you go
// (Akber, 4 Sep 2026).
//
// Two filters, because neither is sufficient alone. The type whitelist demands
// a real venue; the name patterns catch the commemorative markers that are
// nonetheless typed as attractions.
const SUBSTANTIAL_PLACE_TYPES = new Set([
  'tourist_attraction',
  'museum',
  'art_gallery',
  'park',
  'garden',
  'national_park',
  'place_of_worship',
  'church',
  'hindu_temple',
  'mosque',
  'synagogue',
  'shopping_mall',
  'department_store',
  'market',
  'night_club',
  'bar',
  'amusement_park',
  'amusement_center',
  'aquarium',
  'zoo',
  'observation_deck',
  'performing_arts_theater',
  'movie_theater',
  'library',
  'stadium',
  'spa',
  'book_store',
  'electronics_store',
  'store',
]);

// Matched against the name. "Monument to X" and "X Monument" are now included:
// I left them out on the theory that many real attractions are monuments, and
// the production logs promptly returned "Nihonbashi Fish Market Monument" and
// "Monument to Tokugawa Iemitsu" as replacements for Tokyo Skytree and Hoppy
// Street. A named monument to a person or an event is a marker, not a visit.
const MARKER_NAME_PATTERNS = [
  /\bmonument to\b/i,
  /\bmonument$/i,
  /\bsite of\b/i,
  /\bformer site\b/i,
  /\bbirthplace\b/i,
  /\bplaque\b/i,
  /\bmemorial stone\b/i,
  /\bstele\b/i,
  /\bcenotaph\b/i,
  /\bflag ?pole\b/i,
  /誕生の地/,
  /伝承地/,
  /掲揚塔/,
  /\u8de1$/,
];

// The demo shipped names Google returned in Japanese. languageCode: 'en' fixes
// that at the source, but a place with no English name at all still comes back
// in the local script, and a stop a reader cannot pronounce or search for is
// not much use on an English itinerary.
function hasReadableName(name) {
  return typeof name === 'string' && /[A-Za-z]/.test(name);
}

function isSubstantialActivity(candidate) {
  if (!hasReadableName(candidate.name)) return false;
  if (MARKER_NAME_PATTERNS.some((pattern) => pattern.test(candidate.name))) return false;
  return (candidate.types || []).some((type) => SUBSTANTIAL_PLACE_TYPES.has(type));
}

// Interest chips ("Temples & Shrines", "Anime & Pop Culture") mostly work as a
// Places text query as written. These are the few where the chip's wording and
// what Google actually indexes differ enough to matter.
const INTEREST_SEARCH_QUERY = {
  'temples & shrines': 'temple shrine',
  'anime & pop culture': 'anime shop',
  'modern architecture': 'modern architecture landmark',
  'art galleries': 'art gallery',
  'museums': 'museum',
  'nature': 'park',
  'beaches': 'beach',
  'landmarks': 'landmark',
  'shopping': 'shopping street',
  // "bar" returns whichever bar is nearest, which is how a members' club typed
  // as a restaurant became a trip's entire nightlife. Asking for the thing
  // people actually go out for, now that ranking weighs review count, surfaces
  // venues someone has heard of (Akber, 7 Sep 2026).
  'nightlife': 'popular nightclub or cocktail bar',
};

// Interests delivered by the day's meals, not by an activity. Backfilling an
// activity slot with a restaurant would create a second lunch and break the
// one-meal-per-slot rule, so these never become an activity query.
const MEAL_DELIVERED_INTERESTS = new Set(['cuisine', 'food tours', 'food & drink', 'food and drink']);

// Types that make a place a meal rather than an activity. A backfilled stop
// carrying any of these is rejected for the same reason as above.
// Types that make a place worth going to in its own right. A candidate carrying
// one of these is an activity even if it also serves food.
const ACTIVITY_PLACE_TYPES = new Set([
  'night_club',
  'tourist_attraction',
  'museum',
  'art_gallery',
  'park',
  'shopping_mall',
  'amusement_park',
  'aquarium',
  'zoo',
  'place_of_worship',
  'hindu_temple',
  'church',
  'mosque',
  'synagogue',
  'stadium',
  'performing_arts_theater',
  'movie_theater',
  'casino',
  'spa',
  'observation_deck',
]);

const FOOD_PLACE_TYPES = new Set([
  'restaurant',
  'cafe',
  'coffee_shop',
  'bakery',
  'meal_takeaway',
  'meal_delivery',
  'fast_food_restaurant',
]);

// Reject a candidate for an activity slot only when food is ALL it is.
//
// This test was written on 7 Sep for repositionStrandedStops, because Google
// types a Tokyo nightclub as night_club AND bar AND restaurant and the blanket
// version rejected every replacement for the Shinjuku club that turned three
// demo drafts 174 degrees. It fixed that one pass and was never carried to the
// other three, which all kept rejecting anything carrying a food type at all.
//
// That is how a starved block goes quiet: fillStarvedBlocks searched near
// Takeshita Street, and the shrines, complexes and attractions around Harajuku
// that list a tea house or a cafe among their types were all thrown away before
// anything could be chosen. The block stayed starved, fitBlock handed its
// leftover minutes to the one stop it had, and Takeshita Street shipped with
// 3h45m against it (Akber, 8 Sep 2026).
function isFoodOnly(candidate) {
  const types = candidate.types || [];
  return (
    types.some((type) => FOOD_PLACE_TYPES.has(type)) &&
    !types.some((type) => ACTIVITY_PLACE_TYPES.has(type))
  );
}

function interestQuery(interest) {
  if (typeof interest !== 'string') return null;
  const key = interest.trim().toLowerCase();
  if (MEAL_DELIVERED_INTERESTS.has(key)) return null;
  return INTEREST_SEARCH_QUERY[key] || key.replace(/\s*&\s*/g, ' ');
}

// Describes a backfilled stop from Google's own data. Never inherits the
// dropped item's description: that text was written about a different place,
// and carrying it over is precisely the failure this pass exists to prevent.
function describeAdoptedActivity(pick) {
  const label = labelForTypes(pick.types);
  if (!label) {
    return pick.neighbourhood ? `A stop in ${pick.neighbourhood}.` : 'A stop on this day.';
  }
  return pick.neighbourhood ? `${label} in ${pick.neighbourhood}.` : `${label}.`;
}

// Removing a stop that never resolved is correct - an unverified stop must not
// ship looking exactly like a verified one - but removal on its own lets a day
// collapse. The bundled Tokyo demo shipped a Slow day 1 that was hotel,
// restaurant, another restaurant 700 m away, hotel, ending at 15:25 with no
// dinner and no activity at all, because several stops failed on the same day
// and nothing took their place (Akber, 4 Sep 2026).
//
// So try to put a real place in the slot first, and drop only if that fails.
// Deliberate choices here:
//   - searched near an adjacent resolved stop, so the day's geography holds and
//     a backfill can't fling the traveller across the city
//   - a photo is REQUIRED, not preferred: the alternative is dropping, and a
//     shorter day beats a grey placeholder card
//   - food places are rejected, so a backfill can't become a second lunch
//   - "Nightlife" is only used as a query after 19:00, since a bar at 10am is
//     not what the chip meant
async function backfillOrDropActivities(day, anchor, usedPlaceIds, interests, stay) {
  const dropped: string[] = [];
  const adopted: string[] = [];
  const kept: any[] = [];

  for (let i = 0; i < day.items.length; i++) {
    const item = day.items[i];

    if (item.type === 'accommodation' || item.mealType || item.location) {
      kept.push(item);
      continue;
    }

    // Nearest resolved neighbour, searching backwards first so a replacement
    // lands beside where the traveller already is.
    let near: any = null;
    for (let j = i - 1; j >= 0 && !near; j--) {
      if (day.items[j].location) near = day.items[j].location;
    }
    for (let j = i + 1; j < day.items.length && !near; j++) {
      if (day.items[j].location) near = day.items[j].location;
    }

    const startMinutes = timeToMinutes(item.startTime);
    const isEvening = startMinutes != null && startMinutes >= 19 * 60;
    const usable = (Array.isArray(interests) ? interests : []).filter((interest) => {
      const key = String(interest).trim().toLowerCase();
      if (key === 'nightlife' && !isEvening) return false;
      return Boolean(interestQuery(interest));
    });

    // The stop's own type first (a dropped museum should be replaced by a
    // museum), then the trip's interests, then a generic attraction.
    //
    // Except after dinner on a nightlife trip, where the evening's purpose beats
    // whatever the failed stop happened to be. A ramen shop the model had put
    // after dinner failed, its own type "Restaurant" went to the front of the
    // queue, and the trip's entire nightlife became a members' club that Google
    // types as a restaurant (Akber, 7 Sep 2026).
    const queries: string[] = [];
    const nightlifeFirst = isEvening
      ? usable.find((interest) => String(interest).trim().toLowerCase() === 'nightlife')
      : null;
    if (nightlifeFirst) queries.push(interestQuery(nightlifeFirst));

    const ownType = typeof item.categoryTag === 'string' ? item.categoryTag.split('·')[0].trim() : '';
    if (ownType && !queries.includes(ownType.toLowerCase())) queries.push(ownType.toLowerCase());
    for (const interest of usable) {
      const q = interestQuery(interest);
      if (q && !queries.includes(q)) queries.push(q);
    }
    queries.push('tourist attraction');

    let pick: any = null;
    for (const query of queries) {
      for (const loc of [near, anchor]) {
        if (!loc || pick) continue;
        const candidates = await findNearbyCandidates(query, null, loc).catch(() => []);
        pick = candidates.find((candidate) => {
          if (!candidate.location || !candidate.placeId) return false;
          if (!candidate.availablePhotoUrl) return false;
          if (usedPlaceIds.has(candidate.placeId)) return false;
          if (isFoodOnly(candidate)) return false;
          if (!isSubstantialActivity(candidate)) return false;
          if (anchor && haversineMeters(anchor, candidate.location) > MAX_BROAD_DISTANCE_METERS) return false;
          if (!withinReachOfStay(candidate.location, stay)) return false;
          return true;
        }) || null;
      }
      if (pick) break;
    }

    if (!pick) {
      dropped.push(item.name);
      continue;
    }

    item.name = pick.name;
    item.address = pick.address;
    item.location = pick.location;
    // The candidate came back from a Places search that asks for rating and
    // userRatingCount, and nulling them here threw away the only evidence of
    // whether anyone has ever been to the place. It also meant an adopted stop
    // rendered without the star its card is built to show, which is why the
    // shipped demo carried a rating on 4 of its 21 stops.
    item.rating = pick.rating ?? null;
    item.ratingCount = pick.ratingCount ?? null;
    item.priceLevel = pick.priceLevel ?? null;
    item.photoUrl = pick.availablePhotoUrl || null;
    item.hasHours = pick.hasHours || false;
    item.weekdayDescriptions = pick.weekdayDescriptions || null;
    item.description = describeAdoptedActivity(pick);
    item.adoptedFrom = { neighbourhood: pick.neighbourhood, types: pick.types };
    item.placeTypes = pick.types || null;
    item.categoryTag = composeCategoryTag(item, pick) || item.categoryTag;
    usedPlaceIds.add(pick.placeId);
    adopted.push(pick.name);
    kept.push(item);
  }

  day.items = kept;
  return { dropped, adopted };
}

// The whole schedule is built by applyFixedSchedule in _lib/fixedSchedule.js,
// which the swap/reorder recompute path calls too, so an edited day reads
// exactly like a freshly generated one. Imported at the top of this file.

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
// REMOVED: enforceDayRadius and fixBacktracking (4 Sep 2026).
//
// Both tried to fix a day's geography by swapping individual stops for
// whatever Google returned near a computed centre. Both made itineraries
// worse, and the production logs are unambiguous about how:
//
//   day 2: straightened 1 detour: Tokyo Skytree (4.8 km off route)
//                                 -> Nihonbashi Fish Market Monument
//   day 2: pulled 3 outlying stop(s) back into the day:
//          Sensō-ji         (19.3 km out) -> Kuromon
//          Hoppy Street     (19.1 km out) -> Monument to Tokugawa Iemitsu
//          Tsukishima Monja (19.4 km out) -> Sumibiyaki Hiro
//
// That day had a real cluster of famous Asakusa stops in the north-east and
// others in the west. The medoid landed in the west, so the entire Asakusa
// group measured 19 km "out" and was replaced one stop at a time. The passes
// deleted the two most recognisable places in Tokyo and substituted monuments.
//
// The mistake was structural, not a tuning problem. A single stop's distance
// from a centre says nothing about whether it belongs: a legitimate cluster far
// from the middle looks identical to a stray outlier, and swapping stops one at
// a time can only ever pull a day toward its own average, which is precisely the
// clustering these were meant to prevent.
//
// Geography is now handled where it can be judged rather than computed: the
// prompt asks for spread, prominence and a sensible order, and the re-seed audit
// rejects a draft that ignores it. A rejected draft costs a re-run; a silent
// swap costs Sensō-ji, on every live itinerary, with nobody watching.
//
// If this is revisited, reordering the stops is the approach that can work.
// Replacing them is not.

// Kept, unlike the two passes above, because it only removes a late stop - it
// never substitutes one place for another, so it cannot quietly turn Sensō-ji
// into a monument.
//
// The final day ends at the normal time because the traveller checks out and
// travels the next morning. Only a post-dinner stop is eligible, and only while
// the day keeps enough content without it.
const FINAL_NIGHT_CUTOFF_MINUTES = 21 * 60;
// 2, not 3. At 3 this deadlocked against the audit's own 3-activity minimum:
// a last day with exactly three activities and a late bar could not be trimmed
// (the floor blocked it) and could not pass (the late finish failed), so no
// number of re-runs would ever succeed. A departure day is legitimately lighter
// than the rest of the trip (Akber, 4 Sep 2026).
const MIN_ACTIVITIES_AFTER_TRIM = 2;

function trimFinalNight(day) {
  const activities = day.items.filter((i) => i.type !== 'accommodation' && !i.mealType);
  const dropped: string[] = [];

  const late = activities.filter((item) => {
    const start = timeToMinutes(item.startTime);
    return start != null && start >= FINAL_NIGHT_CUTOFF_MINUTES;
  });

  // Identity, not name. Two stops can legitimately share a name - the
  // substantial-type whitelist admits stores, malls and markets, which repeat -
  // and a name filter would delete both while the floor check had counted one.
  const removing = new Set();
  for (const item of late) {
    if (activities.length - removing.size <= MIN_ACTIVITIES_AFTER_TRIM) break;
    removing.add(item);
    dropped.push(item.name);
  }

  if (removing.size > 0) {
    day.items = day.items.filter((i) => !removing.has(i));
  }
  return dropped;
}

// A stop far from the accommodation ruins a day by selection, not by sequence.
// Every day starts and ends at the hotel, so a stop 22km out is travelled twice
// and no reordering can help: the best possible ordering of one such day still
// left a 159 degree turn and 53km of travel.
//
// The prompt asks the model not to do this and the model does it anyway - it
// picked the Ghibli Museum and Inokashira Park, both 22km out, the very next
// run after the rule was added. It is not being disobedient; it reasons about
// places by name and has no idea how far apart they are. So this is enforced
// here, where the distance is known.
//
// Measured from the ACCOMMODATION, which is the one fixed point of the day.
// That distinction matters: an earlier version measured from the day's own
// medoid, which moved with whatever the model chose, and it deleted Sensō-ji as
// an "outlier" because the rest of that day happened to sit west. From this
// hotel Sensō-ji is 1.8km and Ghibli is 22km, which is the discrimination a
// moving centre could never make.
//
// Out-of-reach and photoless stops are marked unresolved rather than replaced
// here, so the existing backfill fills the slot from a place near an adjacent
// stop that IS in reach, or drops it if nothing suitable exists. Nothing is
// silently swapped for something worse (Akber, 4 Sep 2026).
// Every substitution path filtered candidates against the destination CENTRE
// with a 50km tolerance, while markUnusableStops rejects the model's own stops
// beyond 15km of the ACCOMMODATION. So the pass that exists to repair an
// out-of-reach stop could, and did, replace it with another one: "Landmark
// Plaza is 33.1 km from the hotel" was a stop this pipeline chose, not one the
// model did (Akber, 4 Sep 2026).
//
// A replacement must clear the same bar as an original. Set once per request.
// Passed down rather than held at module scope. It was a module-level `let`,
// set inside resolveItinerary, which is fine within one request but wrong in a
// warm serverless instance: two people generating trips at the same time would
// have shared it, and one traveller's hotel would have gated the other's stops
// (Akber, 7 Sep 2026).
function withinReachOfStay(location, stay) {
  if (!stay || !location) return true;
  return haversineMeters(location, stay) / 1000 <= MAX_KM_FROM_ACCOMMODATION;
}

const MAX_KM_FROM_ACCOMMODATION = 15;

function markUnusableStops(day, accommodationLocation) {
  const flagged: string[] = [];

  for (const item of day.items) {
    if (item.type === 'accommodation' || !item.location) continue;

    if (accommodationLocation) {
      const km = haversineMeters(item.location, accommodationLocation) / 1000;
      if (km > MAX_KM_FROM_ACCOMMODATION) {
        flagged.push(`${item.name} (${km.toFixed(1)} km out)`);
        item.location = null;
        item.photoUrl = null;
        continue;
      }
    }

    // A stop with no photo renders as a grey placeholder among cards that all
    // have images, and every substitution path already requires one. The
    // model's own verified stops were the one route by which a photoless card
    // could still ship, which is why the audit kept having to catch them.
    if (!item.photoUrl) {
      flagged.push(`${item.name} (no photo)`);
      item.location = null;
    }
  }

  return flagged;
}

// Reordering, not replacing.
//
// The two earlier repair passes tried to fix a day's shape by swapping stops
// out, and deleted Sensō-ji and Tokyo Skytree doing it. This does the one thing
// that cannot lose a place: it keeps every stop the model chose and only
// changes the order they are visited in.
//
// It is the other half of the reach limit, and neither covers the other:
//   - a stop 22km from the hotel ruins a day whatever the order, because every
//     day starts and ends there. Reach handles that; reordering cannot.
//   - four stops all within reach can still be interleaved into an out-and-back
//     (Shinjuku, Ikebukuro, Ikebukuro, Shinjuku, a 170 degree turn). Reordering
//     fixes that one to 122 degrees and saves 6km; reach cannot see it at all.
//
// Meals stay at their own index in the sequence, so lunch remains the fourth
// stop if that is where it was, and every meal keeps the time the meal-window
// passes already gave it. Only the activities move, into the slots the meals
// are not using. That is why this needs no rescheduling of its own: the cascade
// in realignScheduleTimes recomputes activity times from real travel later,
// and the meals it has to respect have not moved.
//
// Brute force over the activity slots. A day has at most a handful, and the
// cost of 5040 distance sums is nothing next to one Places call.
const EVENING_PIN_MINUTES = 19 * 60;
// Brute force up to this many movable stops. Above it the pass switches to
// pairwise-swap improvement rather than giving up.
//
// It used to be 7 and it used to return null above that. That was safe while
// only non-meal activities moved, and stopped being safe the moment meals
// became movable too: packed day 2 went from 5 movable stops to 8, crossed the
// cap, and the reorder silently did nothing on the one day that needed it -
// 162 degrees shipped when reordering would have reached 124 (Akber, 7 Sep
// 2026). A pass that quietly disables itself on the largest days is worse than
// no pass at all, because it looks like it ran.
const MAX_REORDER_BRUTE_FORCE = 8;
// A generator, not a materialised list. At 8 movable stops the old version
// built all 40,320 arrays up front, which measured ~220ms of the ~480ms this
// pass costs - and it runs twice per day, for both variants, on one event loop.
// Yielding lazily removes that half and lets a rejected arrangement (wrong meal
// order, no afternoon) be discarded without ever being stored.
function* permutations(items) {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

// Breakfast before lunch before dinner. The only ordering constraint meals
// still carry now that they are free to move geographically.
const MEAL_SEQUENCE = { breakfast: 0, lunch: 1, dinner: 2 };

// Checked across the WHOLE day, not just the stops being reordered. A meal that
// failed to resolve has no location, so it is excluded from the reorder and
// pinned at its index - and it was therefore invisible to this check, which
// meant a located dinner could be placed above an unlocated lunch and ship in
// that order (Akber, 7 Sep 2026).
function mealsStillInOrder(dayItems, middleIndexes, candidate) {
  const merged = [...dayItems];
  middleIndexes.forEach((index, i) => { merged[index] = candidate[i]; });

  let previous = -1;
  for (const item of merged) {
    const rank = MEAL_SEQUENCE[item.mealType];
    if (rank == null) continue;
    if (rank < previous) return false;
    previous = rank;
  }
  return true;
}

// The afternoon between lunch and dinner is a fixed four to five hours that the
// stops inside it have to fill. A reorder that empties it leaves the fit with
// nothing to lengthen and the time has to go somewhere, so a day that had an
// afternoon must keep one.
function afternoonSurvives(dayItems, middleIndexes, candidate) {
  return spanSurvives(dayItems, middleIndexes, candidate, 'lunch', 'dinner');
}

// The same protection for the morning, and the reason it now exists: nothing
// stopped the reorder pulling lunch straight up against breakfast, because
// geographically that is often the shortest path and no rule said otherwise.
// Both Slow days shipped that way - a 09:00 breakfast followed immediately by
// lunch, with every activity crammed between lunch and dinner (Akber, 7 Sep
// 2026). A day that started with something to do in the morning has to keep it.
function morningSurvives(dayItems, middleIndexes, candidate) {
  return spanSurvives(dayItems, middleIndexes, candidate, 'breakfast', 'lunch');
}

// A reorder may not empty a span of the day that had something in it. Written
// once for both ends because the failure is identical at either: an empty span
// means two meals back to back, which reads as a mistake and leaves the
// stretch pass with nothing to work with. Where the span is already empty
// before the reorder, this allows anything - the reorder is not obliged to
// invent a stop it was never given.
// Breakfast is the first thing the traveller does, not merely something that
// happens before lunch. mealsStillInOrder only ranks the three meals against
// each other, so nothing objected when the reorder put two sights in front of
// breakfast: hotel to Skytree to the river walk to a cafe in Asakusa is a clean
// line on a map, and it served breakfast at 12:20 and lunch at 15:05 (Akber,
// 7 Sep 2026). Pinning it to the front costs one position; the rest of the day
// still optimises freely.
function breakfastLeadsDay(dayItems, middleIndexes, candidate) {
  const merged = [...dayItems];
  middleIndexes.forEach((index, i) => { merged[index] = candidate[i]; });

  const breakfast = merged.findIndex((item) => item.mealType === 'breakfast');
  // No breakfast item at all means it is taken at the accommodation and handled
  // by breakfastTime, so there is nothing to place. A breakfast that IS the
  // accommodation stop is the day's opening bookend and already leads the day -
  // and it is pinned, so comparing it against the first non-accommodation stop
  // would reject every candidate and silently switch the whole reorder off.
  if (breakfast < 0) return true;
  if (merged[breakfast].type === 'accommodation') return true;

  const first = merged.findIndex((item) => item.type !== 'accommodation');
  if (first < 0) return true;
  return breakfast === first;
}

function spanSurvives(dayItems, middleIndexes, candidate, fromMeal, toMeal) {
  const merged = [...dayItems];
  middleIndexes.forEach((index, i) => { merged[index] = candidate[i]; });

  const gapFor = (items) => {
    const from = items.findIndex((i) => i.mealType === fromMeal);
    const to = items.findIndex((i) => i.mealType === toMeal);
    if (to < 0) return 0;
    // A missing opening meal is not a missing span: breakfast may be taken at
    // the accommodation, in which case the morning simply runs from the start
    // of the day.
    const start = from >= 0 ? from : 0;
    if (to < start) return 0;
    return items.slice(start + 1, to).filter((i) => !i.mealType && i.type !== 'accommodation').length;
  };
  return gapFor(dayItems) === 0 || gapFor(merged) > 0;
}

// A block the scheduler reported as starved needs another stop, and the only
// place to get one is Google. Searches beside the block's last stop, so the new
// arrival sits next to something it will be routed against rather than being
// dropped into the middle of the day from somewhere across town.
//
// The alternative, and what happened before this existed, is that the fit hands
// the leftover time to whichever stop can absorb most of it. That is how a
// shopping street ended up with a four-hour visit on a plan whose whole promise
// is an unhurried day.
async function fillStarvedBlocks(day, cutoff, anchor, usedPlaceIds, stay, interests) {
  const added: string[] = [];

  for (const block of starvedBlocks(day, cutoff)) {
    // The other way a day grows. Same ceiling as roomForAnotherStop.
    if (numberedStopCount(day) >= MAX_NUMBERED_STOPS_PER_DAY) break;
    // Every interest the traveller picked that a restaurant cannot satisfy, tried
    // in turn, then somewhere worth going as a last resort.
    //
    // This used to be `.find(Boolean)`: the FIRST interest, and only that one.
    // For a Tokyo trip that meant every starved block on every day searched for
    // temples and shrines, so a day that already had a shrine got offered more
    // shrines, usedPlaceIds knocked out the good ones, and the block stayed
    // starved with three other interests never asked about. The extra Places
    // calls only happen when the first query comes up empty, which is precisely
    // when they are worth making (Akber, 8 Sep 2026).
    const queries = [...new Set((interests || []).map(interestQuery).filter(Boolean))];
    queries.push('popular tourist attraction');

    let pick: any = null;
    const tried: string[] = [];
    for (const query of queries) {
      const candidates = await findNearbyCandidates(query, null, block.near).catch(() => []);
      const usable = candidates.filter(
          (c) =>
            c.location &&
            c.availablePhotoUrl &&
            !usedPlaceIds.has(c.placeId) &&
            hasReadableName(c.name) &&
            !isFoodOnly(c) &&
            // Or this pass spends the whole loop adding a stop the hours-and-reviews
            // check deletes again on the next round.
            hasEnoughReviews(c) &&
            (!anchor || haversineMeters(anchor, c.location) <= MAX_BROAD_DISTANCE_METERS) &&
            withinReachOfStay(c.location, stay)
      );
      tried.push(`"${query}" ${candidates.length}/${usable.length}`);
      pick = preferWellKnown(usable);
      if (pick) break;
    }

    // A block that stays starved is how a shrine ends up with three and three
    // quarter hours against it: every stop reaches its ceiling and the leftover
    // goes to whichever can hold most of it. Working out why cost a generation
    // each time, so it says so now (Akber, 8 Sep 2026).
    if (!pick) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: nothing to fill a ${Math.round(block.shortfall)}-minute gap with, ` +
          `searched ${tried.join(', ')} (candidates/usable)`
      );
      continue;
    }

    const stop = buildAdoptedStop(pick, MIN_STAY_MINUTES_FOR_NEW_STOP);

    // Its new neighbours were routed against each other, not against it.
    if (block.insertAt > 0) day.items[block.insertAt - 1].travelToNext = null;
    day.items.splice(block.insertAt, 0, stop);
    usedPlaceIds.add(pick.placeId);
    added.push(pick.name);
  }

  return added;
}

const MIN_STAY_MINUTES_FOR_NEW_STOP = 60;

// Builds a stop from a verified Google place. Shared by the two passes that add
// one after the itinerary already exists, so an added stop is indistinguishable
// from one that was there all along.
function buildAdoptedStop(pick, durationMinutes) {
  const stop = {
    type: 'activity',
    name: pick.name,
    address: pick.address,
    location: pick.location,
    description: describeAdoptedActivity(pick),
    adoptedFrom: { neighbourhood: pick.neighbourhood, types: pick.types },
    placeTypes: pick.types || null,
    categoryTag: null,
    startTime: null,
    durationMinutes,
    mealType: null,
    travelToNext: null,
    photoUrl: pick.availablePhotoUrl || null,
    // Carried through, not nulled: see the note on the adoption paths above.
    rating: pick.rating ?? null,
    ratingCount: pick.ratingCount ?? null,
    priceLevel: pick.priceLevel ?? null,
    hasHours: pick.hasHours || false,
    weekdayDescriptions: pick.weekdayDescriptions || null,
  };
  stop.categoryTag = composeCategoryTag(stop, pick) || null;
  return stop;
}

// The prompt asks for every chosen interest to appear somewhere in the trip and
// calls it strictly enforced. Nothing enforced it. A Tokyo trip with Nightlife
// selected shipped with no night venue in either variant, and the demo audit
// passed it on the word "Club" in a restaurant's name (Akber, 7 Sep 2026).
//
// So the finished itinerary is checked, and anything missing is gone and found.
// A candidate has to satisfy the interest itself, not merely turn up in a search
// for it - a search for "temple shrine" will happily return the gift shop
// opposite, and adding that would close the gap on paper while leaving the trip
// without a temple.
async function coverMissingInterests(itinerary, { interests, anchor, usedPlaceIds, stay, cutoffFor }) {
  const added: string[] = [];

  for (const interest of uncoveredInterests(itinerary.days, interests)) {
    const query = interestQuery(interest);
    if (!query) continue;

    let placed = false;
    for (let index = 0; index < itinerary.days.length && !placed; index++) {
      const day = itinerary.days[index];

      // Nightlife goes after dinner or not at all; everything else goes wherever
      // the day still has room for a stop of a sensible length.
      const slot = isEveningInterest(interest)
        ? eveningInsertPoint(day)
        : roomForAnotherStop(day, cutoffFor(index));
      if (!slot) continue;

      const candidates = await findNearbyCandidates(query, null, slot.near).catch(() => []);
      const pick = preferWellKnown(
        candidates.filter(
          (c) =>
            c.location &&
            c.availablePhotoUrl &&
            !usedPlaceIds.has(c.placeId) &&
            hasReadableName(c.name) &&
            hasEnoughReviews(c) &&
            !isFoodOnly(c) &&
            (!anchor || haversineMeters(anchor, c.location) <= MAX_BROAD_DISTANCE_METERS) &&
            withinReachOfStay(c.location, stay) &&
            satisfiesInterest({ ...c, placeTypes: c.types, mealType: null }, interest)
        )
      );
      if (!pick) continue;

      const stop = buildAdoptedStop(pick, MIN_STAY_MINUTES_FOR_NEW_STOP);
      if (slot.insertAt > 0) day.items[slot.insertAt - 1].travelToNext = null;
      day.items.splice(slot.insertAt, 0, stop);
      usedPlaceIds.add(pick.placeId);
      added.push(`${pick.name} (${interest})`);
      placed = true;
    }
  }

  return added;
}

function reorderDayGeographically(day) {
  const middleIndexes: number[] = [];
  day.items.forEach((item, index) => {
    if (item.type !== 'accommodation' && item.location) middleIndexes.push(index);
  });
  if (middleIndexes.length < 3) return null;

  // Meals move too, provided breakfast still precedes lunch and lunch precedes
  // dinner. Pinning them by position was wrong: a day whose activities cluster
  // in Asakusa but whose breakfast sits in Omotesando is dragged across the
  // city by the meal, and with the meal fixed the optimiser could do nothing -
  // 138 degrees before and after, where letting the meals move reaches 0
  // (measured on a real generation, Akber, 7 Sep 2026).
  //
  // Evening activities stay pinned. A post-dinner bar is in that slot because
  // of the hour, not the geography, and the optimiser would happily move it to
  // 09:30 to shave a few degrees.
  const activitySlots = middleIndexes.filter((index) => {
    const item = day.items[index];
    if (item.mealType) return true;
    const start = timeToMinutes(item.startTime);
    return !(start != null && start >= EVENING_PIN_MINUTES);
  });
  const activities = activitySlots.map((index) => day.items[index]);
  if (activities.length < 2) return null;

  // Two different measurements, deliberately.
  //
  // The turn is measured WITHOUT the accommodation bookends, because that is
  // what the audit measures and because a commute out from a hotel on the edge
  // of the city is not the day doubling back on itself, it is just the commute.
  // Optimising the bookended shape minimised a quantity nothing else cared
  // about and left the audit still failing.
  //
  // The distance is measured WITH them, since the traveller really does make
  // those journeys and a shorter day is a better day.
  const opening = day.items.find((i) => i.type === 'accommodation' && i.location) || null;
  const bare = (ordered) => ordered.map((i) => i.location);
  const framed = (ordered) => {
    const locs = bare(ordered);
    return opening ? [opening.location, ...locs, opening.location] : locs;
  };
  const measure = (ordered) => ({
    worstTurn: shapeOf(bare(ordered)).worstTurn,
    path: shapeOf(framed(ordered)).path,
  });

  const sequenceFor = (arrangement) => {
    const byIndex = new Map();
    activitySlots.forEach((slot, i) => byIndex.set(slot, arrangement[i]));
    return middleIndexes.map((index) => byIndex.get(index) || day.items[index]);
  };

  const current = sequenceFor(activities);
  const currentShape = measure(current);

  let best = current;
  let bestShape = currentShape;
  const better = (shape) =>
    shape.worstTurn < bestShape.worstTurn ||
    (shape.worstTurn === bestShape.worstTurn && shape.path < bestShape.path);

  if (activities.length <= MAX_REORDER_BRUTE_FORCE) {
    for (const arrangement of permutations(activities)) {
      const candidate = sequenceFor(arrangement);
      if (!mealsStillInOrder(day.items, middleIndexes, candidate)) continue;
      if (!afternoonSurvives(day.items, middleIndexes, candidate)) continue;
      if (!morningSurvives(day.items, middleIndexes, candidate)) continue;
      if (!breakfastLeadsDay(day.items, middleIndexes, candidate)) continue;
      const shape = measure(candidate);
      if (better(shape)) {
        best = candidate;
        bestShape = shape;
      }
    }
  } else {
    // Too many to enumerate. Repeatedly swap the pair of stops that helps most
    // until nothing does. Not guaranteed optimal, but it always improves what
    // it can, which is the point: the previous behaviour was to do nothing.
    let arrangement = [...activities];
    let improved = true;
    while (improved) {
      improved = false;
      for (let a = 0; a < arrangement.length - 1; a++) {
        for (let b = a + 1; b < arrangement.length; b++) {
          const trial = [...arrangement];
          [trial[a], trial[b]] = [trial[b], trial[a]];
          const candidate = sequenceFor(trial);
          if (!mealsStillInOrder(day.items, middleIndexes, candidate)) continue;
          if (!afternoonSurvives(day.items, middleIndexes, candidate)) continue;
          if (!morningSurvives(day.items, middleIndexes, candidate)) continue;
          if (!breakfastLeadsDay(day.items, middleIndexes, candidate)) continue;
          const shape = measure(candidate);
          if (better(shape)) {
            arrangement = trial;
            best = candidate;
            bestShape = shape;
            improved = true;
          }
        }
      }
    }
  }

  if (best === current) return null;

  middleIndexes.forEach((index, i) => {
    day.items[index] = best[i];
  });

  return {
    fromTurn: Math.round(currentShape.worstTurn),
    toTurn: Math.round(bestShape.worstTurn),
    savedKm: (currentShape.path - bestShape.path) / 1000,
  };
}

// A meal the model chose can sit nowhere near the day it belongs to. One real
// generation put breakfast in Omotesando and dinner in Shinjuku while every
// activity was in Asakusa and Akihabara, 9km east: the day crossed the city
// twice for the meals alone, 155 degrees, and no ordering could repair it
// because the meals were in the wrong PLACE rather than the wrong position.
// Re-picking both took that day to 0 (Akber, 7 Sep 2026).
//
// Deliberately narrow, because replacing stops is how Sensō-ji got deleted
// once already:
//   - only meals, never an activity. Swapping one restaurant for a nearer
//     restaurant loses nothing; swapping a landmark loses the landmark.
//   - only when the day already fails, so a passing day is never touched.
//   - only if the swap measurably lowers the worst turn. On one day here
//     re-picking would have made it worse, 138 to 172, and this refuses it.
//   - measured against the day's own ACTIVITY centre, not a mean that the
//     offending meal itself drags outward.
const MEAL_LEASH_KM = 4;

async function repositionStrandedStops(day, anchor, usedPlaceIds, stay) {
  const located = day.items.filter((i) => i.type !== 'accommodation' && i.location);
  const activities = located.filter((i) => !i.mealType);
  if (activities.length < 2) return [];

  const shape = shapeOf(located.map((i) => i.location));
  let worst = shape.worstTurn;
  if (worst <= REORDER_REVERSAL_DEGREES) return [];

  // The stop the day turns around on. It is eligible whatever its distance from
  // the centre, because the leash test below measures the wrong thing for this
  // failure: a stop can sit comfortably inside the day and still be the reason
  // the day goes out and comes straight back.
  const pivot = shape.worstAt >= 0 ? located[shape.worstAt] : null;

  // Where to look for the pivot's replacement. NOT the day's centre: a stop is
  // the pivot precisely because it sits off the line between its neighbours, so
  // the centre is the wrong place to search. A club in Shinjuku between dinner
  // in Roppongi and a tower in Roppongi is 2.6 km from a Harajuku centre and
  // every candidate found there still turns the day around. The midpoint of its
  // two neighbours is the one place a stop can sit without bending the route at
  // all, so that is where the search goes (Akber, 7 Sep 2026).
  const pivotTarget = (() => {
    if (!pivot) return null;
    // The hotel stands in for a missing neighbour. located excludes the
    // accommodation bookends, so the first and last stop of a day each have one
    // neighbour here and one only in day.items - and the day really does begin
    // and end at the hotel, so it is the honest answer rather than a fudge.
    // Falling back to the pivot's own location, as this did, sent the search to
    // the exact place the stop already was and guaranteed no improvement. That
    // is what happened to a Harajuku breakfast sitting 9.5 km from the Asakusa
    // morning it opened (Akber, 8 Sep 2026).
    const hotel = day.items.find((i) => i.type === 'accommodation' && i.location)?.location || null;
    const before = located[shape.worstAt - 1]?.location || hotel;
    const after = located[shape.worstAt + 1]?.location || hotel;
    if (!before || !after) return pivot.location;
    return {
      lat: (before.lat + after.lat) / 2,
      lng: (before.lng + after.lng) / 2,
    };
  })();

  const centre = medoidOfLocations(activities.map((i) => i.location));
  if (!centre) return [];

  const moved: string[] = [];

  for (const item of located) {
    if (item !== pivot && haversineMeters(item.location, centre) / 1000 <= MEAL_LEASH_KM) continue;

    // Meals were the only thing this moved, on the assumption that a restaurant
    // is the interchangeable stop and an activity is the reason to travel. Two
    // demo generations in a row proved otherwise: a shrine sat alone out east
    // between two western stops for a 165 degree turn, and a Shinjuku nightclub
    // sat between dinner and a Roppongi tower for 174 degrees. Neither could be
    // reordered away - the nightclub is pinned after dinner by the nightlife
    // rule - and neither was a meal, so nothing touched them.
    //
    // An activity is replaced by a comparable one nearer the day, so the trip
    // keeps its shape and its interests. The swap is still only kept if the day
    // measurably straightens, which is what stops this trading a good stop for a
    // convenient one (Akber, 7 Sep 2026).
    const query = item.mealType
      ? MEAL_SEARCH_QUERY[item.mealType] || 'restaurant'
      : queryForStop(item);
    if (!query) continue;

    const searchFrom = item === pivot ? pivotTarget : centre;
    const candidates = await findNearbyCandidates(query, null, searchFrom).catch(() => []);
    // Four demo drafts were rejected for a reversal this pass was supposed to
    // repair, and each time working out why cost a whole generation. Say what
    // happened instead: the stop, what was searched for, and how many candidates
    // survived each gate (Akber, 7 Sep 2026).
    const reasons = { noPhoto: 0, used: 0, unreadable: 0, tooFewReviews: 0, wrongKind: 0, tooFar: 0, notCloser: 0 };

    const acceptable = candidates.filter((candidate) => {
      if (!candidate.location || !candidate.placeId) return false;
      if (!candidate.availablePhotoUrl) { reasons.noPhoto++; return false; }
      if (usedPlaceIds.has(candidate.placeId)) { reasons.used++; return false; }
      if (!hasReadableName(candidate.name)) { reasons.unreadable++; return false; }
      if (!hasEnoughReviews(candidate)) { reasons.tooFewReviews++; return false; }
      // A meal has to land on somewhere that serves food. An activity only has
      // to be the same kind of thing it is replacing, which the query already
      // asks for, so holding it to the food list would reject every candidate.
      if (item.mealType && !(candidate.types || []).some((t) => FOOD_PLACE_TYPES.has(t))) return false;
      // See isFoodOnly. This was the original site of that test; it is shared
      // now so the other three passes stop rejecting a shrine for having a
      // tea house.
      if (!item.mealType && isFoodOnly(candidate)) { reasons.wrongKind++; return false; }
      if (!withinReachOfStay(candidate.location, stay)) { reasons.tooFar++; return false; }
      if (anchor && haversineMeters(anchor, candidate.location) > MAX_BROAD_DISTANCE_METERS) { reasons.tooFar++; return false; }
      // The pivot is judged against the point between its neighbours, not the
      // day's centre. Being nearer that point is what removes the turn.
      if (item === pivot) {
        return (
          haversineMeters(candidate.location, pivotTarget) <
          haversineMeters(item.location, pivotTarget)
        );
      }
      return haversineMeters(candidate.location, centre) < haversineMeters(item.location, centre);
    });
    if (item === pivot) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: repairing pivot ${item.name} with "${query}" - ` +
          `${candidates.length} candidate(s), ${acceptable.length} usable` +
          (acceptable.length === 0
            ? `, rejected: ${Object.entries(reasons).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ') || 'none matched the query'}`
            : '')
      );
    }
    const pick = preferWellKnown(acceptable);
    if (!pick) continue;

    // Only keep the swap if the day is actually straighter for it.
    const original = { ...item };
    item.location = pick.location;
    const after = shapeOf(
      day.items.filter((i) => i.type !== 'accommodation' && i.location).map((i) => i.location)
    ).worstTurn;
    if (after >= worst) {
      if (item === pivot) {
        console.info(
          `[generate-resolved-itinerary] day ${day.day}: ${pick.name} would not straighten ${item.name}, ` +
            `${Math.round(worst)}° -> ${Math.round(after)}°, keeping the original`
        );
      }
      item.location = original.location;
      continue;
    }
    // Move the bar after every accepted swap. Comparing each swap against the
    // ORIGINAL turn let a second swap that was worse than the first still pass,
    // because it was still better than where the day started.
    worst = after;

    moved.push(`${item.name} -> ${pick.name}`);
    item.name = pick.name;
    item.address = pick.address;
    // The candidate came back from a Places search that asks for rating and
    // userRatingCount, and nulling them here threw away the only evidence of
    // whether anyone has ever been to the place. It also meant an adopted stop
    // rendered without the star its card is built to show, which is why the
    // shipped demo carried a rating on 4 of its 21 stops.
    item.rating = pick.rating ?? null;
    item.ratingCount = pick.ratingCount ?? null;
    item.priceLevel = pick.priceLevel ?? null;
    item.photoUrl = pick.availablePhotoUrl || null;
    item.hasHours = pick.hasHours || false;
    item.weekdayDescriptions = pick.weekdayDescriptions || null;
    // The stop is now a different place, so it needs that place's id. Adoption
    // never set this: the id only ever went into usedPlaceIds. That was invisible
    // while adoption only filled in a meal that had no id to begin with, and
    // stopped being invisible once a meal rejected for its hours was emptied and
    // re-adopted - emptying set the id to null and nothing put a new one back.
    // A stop with no id cannot be deduped, swapped or re-verified.
    item.placeId = pick.placeId;
    item.description = describeAdoptedMeal(pick, item.mealType);
    item.adoptedFrom = { neighbourhood: pick.neighbourhood, types: pick.types };
    item.placeTypes = pick.types || null;
    item.categoryTag = composeCategoryTag(item, pick) || item.categoryTag;
    usedPlaceIds.add(pick.placeId);
  }

  return moved;
}

// What to look for when replacing a stranded activity. The stop's own Google
// types first, because they describe what it actually is, then the first half of
// its category tag ("Shrine · Kanda"), then nothing - and nothing means the stop
// is left where it is rather than swapped for something unrelated.
function queryForStop(item) {
  const types = Array.isArray(item.placeTypes) ? item.placeTypes : [];
  const named = types.find((type) => PLACE_TYPE_LABELS[type]);
  if (named) return PLACE_TYPE_LABELS[named].toLowerCase();
  const tagged = String(item.categoryTag || '').split('·')[0].trim().toLowerCase();
  return tagged || null;
}

function medoidOfLocations(points) {
  let best = null;
  let bestTotal = Infinity;
  for (const candidate of points) {
    let total = 0;
    for (const other of points) total += haversineMeters(candidate, other);
    if (total < bestTotal) { bestTotal = total; best = candidate; }
  }
  return best;
}

async function enforceDriveCap(day, transport, usedPlaceIds, stay) {
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
        (candidate) =>
          isUsableCandidate(candidate) &&
          !usedPlaceIds.has(candidate.placeId) &&
          withinReachOfStay(candidate.location, stay)
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
          (candidate) =>
          isUsableCandidate(candidate) &&
          !usedPlaceIds.has(candidate.placeId) &&
          withinReachOfStay(candidate.location, stay)
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
    next.priceLevel = replacement.priceLevel ?? null;
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

async function resolveItinerary(itinerary, destination, anchor, transport, accommodationDetails, interests, checkInDate, budget) {
  const stay = accommodationDetails?.location || null;
  const usedPlaceIds = new Set();
  // Beside usedPlaceIds and for the same reason: per request, never module-level,
  // or one generation's choices leak into another running at the same time.
  const usedBrands = new Set();

  // Slow & Immersive (pacingLabel 'Relaxed', set by computePacing in
  // generateRawItinerary.js) gives every meal a longer, unhurried sitting;
  // every other variant keeps the standard 60. Chosen once per variant here
  // and handed to each meal-building step below so the whole day is built
  // around the right length from the start.
  const mealDuration =
    itinerary.pacingLabel === 'Relaxed'
      ? SLOW_MEAL_DURATION_MINUTES
      : FIXED_MEAL_DURATION_MINUTES;

  // The shortest any stop on this variant may run. 45 minutes is a fine minimum
  // on a Packed day and a contradiction on Slow & Immersive, where it produced a
  // 45-minute Sensō-ji (Akber, 7 Sep 2026).
  const minStayMinutes = itinerary.pacingLabel === 'Relaxed' ? SLOW_MIN_STAY_MINUTES : undefined;

  // "type" is a three-value union on the client (ItemType in src/types.ts) and
  // the model does not always respect it. Told to include real night venues, it
  // started returning "type": "nightlife", which flowed all the way through and
  // failed the build when the demo was saved as TypeScript - the schedule was
  // fine, the file simply would not compile (Akber, 7 Sep 2026).
  //
  // A meal is whatever carries a mealType; everything else the model invents is
  // an activity. The kind of place it is already lives in categoryTag, which is
  // built from Google's own types and is where that information belongs.
  const ITEM_TYPES = new Set(['accommodation', 'activity', 'meal']);
  itinerary.days.forEach((day) => {
    day.items.forEach((item) => {
      if (ITEM_TYPES.has(item.type)) return;
      item.type = item.mealType ? 'meal' : 'activity';
    });
  });

  // Claude sometimes returns a day's items in non-chronological order (e.g. a
  // breakfast item with startTime 09:00 landing at array index 3, after items
  // whose startTimes are 11:00 and 13:00). Every downstream step - allItems
  // indexing, realignScheduleTimes' i-1→i chain, the block boundaries
  // applyFixedSchedule cuts at each meal - assumes items are in time order, so
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
    applyResolution(item, results[index], usedPlaceIds, anchor, stay, budget);
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
    const duplicated = dedupeMeals(day);
    if (duplicated.length > 0) {
      console.warn(
        `[generate-resolved-itinerary] day ${day.day}: dropped ${duplicated.length} duplicate meal(s): ${duplicated.join(', ')}`
      );
    }
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
    await resolveMealPlaceholders(day, anchor, usedPlaceIds, stay, usedBrands, budget, null);
  }

  // Then remove any non-meal stop that never resolved to a real place, so an
  // unverified stop can't ship looking exactly like a verified one. Runs after
  // the meal pass (which gives meals their own second chance) and before travel
  // times, so nothing routes through a stop that isn't there.
  for (const day of itinerary.days) {
    // Before the backfill, not after: a stop out of reach of the hotel is
    // treated exactly like one that never resolved, so the same pass replaces
    // it with something near the rest of the day or drops it.
    const unusable = markUnusableStops(day, accommodationDetails?.location);
    if (unusable.length > 0) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: ${unusable.length} stop(s) sent back for replacement: ${unusable.join('; ')}`
      );
    }

    const { dropped, adopted } = await backfillOrDropActivities(day, anchor, usedPlaceIds, interests, stay);

    // backfillOrDropActivities deliberately skips meals, so a meal that
    // markUnusableStops just invalidated (too far from the hotel, or no photo)
    // would otherwise ship with a real name, no location and no image: a grey
    // card, invisible on the map, with the legs either side of it nulled.
    // resolveMealPlaceholders is exactly the pass that repairs that, so run it
    // again now that the day's activities are settled (Akber, 4 Sep 2026).
    await resolveMealPlaceholders(day, anchor, usedPlaceIds, stay, usedBrands, budget, null);
    if (adopted.length > 0) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: backfilled ${adopted.length} unresolved stop(s): ${adopted.join(', ')}`
      );
    }
    if (dropped.length > 0) {
      console.warn(
        `[generate-resolved-itinerary] day ${day.day}: dropped ${dropped.length} unresolved stop(s) with no replacement: ${dropped.join(', ')}`
      );
    }


    // After the backfill and the reach pass, so it orders the stops that will
    // actually ship, and before travel times, so the cascade recomputes against
    // the new order.
    // Reorder first: it moves nothing and loses nothing, so it gets the first
    // attempt at straightening the day. Only if the day still doubles back does
    // a meal get re-picked.
    // Early, before anything deliberately sets a stay's length. A 240-minute
    // stop at a nightclub starting 23:10 is the model being implausible; a
    // 210-minute museum after the fit is the scheduler doing its job.
    clampStayDurations(day);

    const reordered = reorderDayGeographically(day);
    if (reordered) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: reordered stops, worst turn ${reordered.fromTurn}° -> ${reordered.toTurn}°, ${reordered.savedKm.toFixed(1)} km saved`
      );
    }

    const restranded = await repositionStrandedStops(day, anchor, usedPlaceIds, stay);
    if (restranded.length > 0) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: moved ${restranded.length} stranded stop(s) back to the day: ${restranded.join('; ')}`
      );
      reorderDayGeographically(day);
    }

  }

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
    await enforceDriveCap(day, transport, usedPlaceIds, stay);
  }

  // No shared state here (unlike enforceDriveCap above), so this can run
  // across all days at once.
  await Promise.all(
    itinerary.days.map((day) => fillMissingTravelTimes(day, transport, destination))
  );

  // Synchronous and last - every day's travelToNext values are now final,
  // so this is the one place the displayed schedule gets reconciled with
  // them.
  // Real copy for every substituted stop, replacing the category-and-postcode
  // line each substitution path leaves behind. Runs before the scheduling tail
  // because activityCeiling reads item.description to decide how long a stop can
  // plausibly hold, so a stop described as a park or a museum earns its longer
  // ceiling here rather than being treated as an unrecognised neutral one.
  //
  // Best-effort by design: a failure leaves every stop on the synthesised line
  // it already had, which is the current behaviour, so this can improve the
  // result but never break it. The markers are stripped either way.
  try {
    const described = await describeAdoptedStops(itinerary.days, destination);
    if (described > 0) {
      console.info(
        `[generate-resolved-itinerary] wrote real descriptions for ${described} substituted stop(s)`
      );
    }
  } catch (error) {
    console.warn('[generate-resolved-itinerary] description pass failed, keeping synthesised lines:', error);
  }

  itinerary.days.forEach((day) => realignScheduleTimes(day));

  // Only now, with the schedule reconciled against real travel times, do the
  // start times mean anything. Trimming inside the day loop read the times the
  // model had guessed, and after reorderDayGeographically had shuffled the
  // activities those times belonged to different stops entirely, so the wrong
  // one could be dropped. The realign below puts the schedule straight again
  // once something has been removed (Akber, 4 Sep 2026).
  const lastDay = itinerary.days[itinerary.days.length - 1];
  if (lastDay) {
    const trimmed = trimFinalNight(lastDay);
    if (trimmed.length > 0) {
      console.info(
        `[generate-resolved-itinerary] day ${lastDay.day} is the last: trimmed ${trimmed.length} late stop(s) so the final night ends at the normal time: ${trimmed.join(', ')}`
      );
      // The stop before the gap still holds the leg that was routed TO the stop
      // just removed, and nothing downstream touches geography - realign and
      // snapArrivalsToGrid both derive their arithmetic from that stale value,
      // so the hotel return would show a travel time for a leg that was never
      // routed. Re-route the day before reconciling the clock.
      await computeTravelTimes(lastDay.items, transport);
      realignScheduleTimes(lastDay);
    }
  }

  // Meals sit on fixed times and the day is fitted around them: one pass, no
  // negotiation. See fixedSchedule.js for why the slack lives in the stop
  // durations rather than in the meal times.
  //
  // It runs as a loop because fitting a day can invalidate the checks made on
  // the last one. The first version checked the hours once and then went on to
  // drop stops, refit, add stops and refit again, so anything those later passes
  // moved shipped unexamined - which is how a shrine reached 21:10 and a design
  // gallery 21:00 on a generation where the rule was working perfectly (Akber,
  // 7 Sep 2026). The check has to be the last word, so the day is refitted and
  // rechecked until nothing more needs doing.
  const settings = { cutoffMinutes: 0, transport, minStayMinutes };

  for (let index = 0; index < itinerary.days.length; index++) {
    const day = itinerary.days[index];
    const cutoff = dayCutoffMinutes(index, itinerary.days.length, interests);
    const weekday = weekdayForDay(checkInDate, day.day);
    const options = { ...settings, cutoffMinutes: cutoff };

    // Three rounds is enough for a day to settle in practice, and a bound means
    // a day that cannot settle ships slightly imperfect rather than looping.
    for (let round = 0; round < 3; round++) {
      const { moved, removed } = applyFixedSchedule(day, options);
      if (moved.length > 0) {
        console.info(
          `[generate-resolved-itinerary] day ${day.day}: moved ${moved.length} stop(s) to fit the day's meal times: ${moved.join(', ')}`
        );
      }
      if (removed.length > 0) {
        console.info(
          `[generate-resolved-itinerary] day ${day.day}: dropped ${removed.length} stop(s) the day had no room for: ${removed.join(', ')}`
        );
      }

      // Now, and only now, is every stop sitting on the time it will ship with.
      const unsuitable = unsuitableStops(day, weekday, budget);

      // A meal is a slot, not a stop. Deleting one leaves a day with no dinner,
      // and nothing downstream puts it back: fillStarvedBlocks only ever looks
      // for an attraction, so the hole gets filled with a yakitori restaurant
      // typed as an activity at 22:25 and the day ships with two meals.
      //
      // This surfaced the moment the place cache was versioned. Before that the
      // cache was full of records written without regularOpeningHours, so the
      // closed-at-this-hour check almost never fired; with real hours arriving
      // it fires properly, and every dinner it rejected was simply vanishing.
      //
      // So a rejected meal is emptied rather than removed, and re-adopted below
      // against a candidate that is actually open at the hour it sits at.
      const rejectedMeals = unsuitable.filter((entry) => day.items[entry.index]?.mealType);
      // Kept so a failed re-adoption can put the original back. A dinner at a
      // place that may be closing is a worse dinner; a meal card with a name and
      // no location is the unresolved-stop bug this codebase already fixed once.
      const mealsBefore = new Map(rejectedMeals.map((e) => [e.index, { ...day.items[e.index] }]));
      for (const entry of rejectedMeals) {
        const meal = day.items[entry.index];
        meal.location = null;
        meal.placeId = null;
        meal.address = null;
        meal.photoUrl = null;
        meal.weekdayDescriptions = null;
        meal.hasHours = false;
        meal.rating = null;
        meal.ratingCount = null;
        meal.priceLevel = null;
      }
      if (rejectedMeals.length > 0) {
        console.info(
          `[generate-resolved-itinerary] day ${day.day}: re-placing ${rejectedMeals.length} meal(s) shut at their hour: ` +
            rejectedMeals.map((e) => `${e.name} (${e.reason})`).join('; ')
        );
        await resolveMealPlaceholders(day, anchor, usedPlaceIds, stay, usedBrands, budget, weekday);

        for (const [index, before] of mealsBefore) {
          if (!day.items[index]?.location) {
            Object.assign(day.items[index], before);
            console.info(
              `[generate-resolved-itinerary] day ${day.day}: nothing open found for ${before.mealType}, keeping ${before.name}`
            );
          }
        }
      }

      const dropped = unsuitable.filter((entry) => !day.items[entry.index]?.mealType);
      for (const entry of [...dropped].sort((a, b) => b.index - a.index)) {
        if (entry.index > 0) day.items[entry.index - 1].travelToNext = null;
        day.items.splice(entry.index, 1);
      }
      if (dropped.length > 0) {
        console.info(
          `[generate-resolved-itinerary] day ${day.day}: dropped ${dropped.length} stop(s) that did not belong at their hour: ` +
            dropped.map((e) => `${e.name} (${e.reason})`).join('; ')
        );
      }

      // Dropping leaves the day thinner, and a thin block is what produces a
      // four-hour visit to a shopping street, so it is worth going to find
      // whatever the day is now short of.
      const added = await fillStarvedBlocks(day, cutoff, anchor, usedPlaceIds, stay, interests);
      if (added.length > 0) {
        console.info(
          `[generate-resolved-itinerary] day ${day.day}: added ${added.length} stop(s) to fill a stretch nothing could plausibly cover: ${added.join(', ')}`
        );
      }

      // A round that changed nothing means the day is settled and the times it
      // was just checked against are the times it ships with.
      if (moved.length === 0 && removed.length === 0 && unsuitable.length === 0 && added.length === 0) break;

      // Anything moved, dropped or added leaves legs pointing at somewhere the
      // stop is no longer next to, so the day is re-routed before being refitted
      // at the top of the next round.
      await computeTravelTimes(day.items, transport);

      // A day that uses its last round has been re-routed but not refitted, and
      // shipping the times from before that routing would be worse than shipping
      // one unchecked round. Fit it and let it go.
      if (round === 2) applyFixedSchedule(day, options);
    }

    // Everything below runs after the per-day loop has finished, and each pass
    // undoes the last one's guarantee: the loop drops stops the checks reject,
    // fillStarvedBlocks fetches replacements, coverMissingInterests inserts one
    // more, and any of those bends a route or thins a block that was fine a
    // moment ago.
    //
    // See settleDay: these three passes each undo the last one's guarantee, so
    // they run as a loop until the day stops changing rather than as a sequence.
    await settleDay(day, {
      options, anchor, usedPlaceIds, stay, interests, transport, weekday, budget,
      label: 'on the settled day',
    });
  }

  // Last content decision before the descriptions are written: does this trip
  // actually deliver the interests it was asked for? Checked on the finished
  // itinerary, because until the scheduling loop has settled, stops are still
  // being dropped and added underneath it.
  try {
    const covered = await coverMissingInterests(itinerary, {
      interests,
      anchor,
      usedPlaceIds,
      stay,
      cutoffFor: (index) => dayCutoffMinutes(index, itinerary.days.length, interests),
    });
    if (covered.length > 0) {
      console.info(
        `[generate-resolved-itinerary] added ${covered.length} stop(s) for interests the trip was missing: ${covered.join(', ')}`
      );
      // Each addition sits between two stops it was never routed against, and
      // the day it landed in now holds one more thing than it was fitted for.
      //
      // The clock was always recomputed here. The ROUTE was not, and that is the
      // bug that rejected seven demo drafts in a row. This pass runs after every
      // per-day geometry check has finished, so a stop inserted here bends a day
      // nobody looks at again: the resolver's last reading of one Tokyo day was
      // 137 degrees, comfortably under the bar, and the audit measured the
      // shipped day at 175. The repair was not failing, it had already gone home.
      //
      // Same shape as the opening-hours check running before the passes that
      // moved stops, and the reorder running before the loop that drops and adds
      // them. Third time tonight (Akber, 7 Sep 2026).
      for (let index = 0; index < itinerary.days.length; index++) {
        const day = itinerary.days[index];
        const options = {
          cutoffMinutes: dayCutoffMinutes(index, itinerary.days.length, interests),
          transport,
          minStayMinutes,
        };
        await computeTravelTimes(day.items, transport);
        applyFixedSchedule(day, options);

        // This used to be the same three passes written out again as a
        // sequence, with the thin-block fill last. The fill is what adds a
        // stop, and nothing measured the route after it, so a day could leave
        // this block bent by the stop this block had just inserted. Same
        // function as the settled-day pass now, so there is one sequence to get
        // right instead of two.
        await settleDay(day, {
          options, anchor, usedPlaceIds, stay, interests, transport, budget,
          weekday: weekdayForDay(checkInDate, day.day),
          label: 'after interest coverage',
        });
      }
    }
  } catch (error) {
    console.warn('[generate-resolved-itinerary] interest coverage pass failed, leaving the trip as generated:', error);
  }

  // Again, because the scheduling loop above can adopt stops of its own -
  // fillStarvedBlocks goes to Google for a real place when a stretch of the day
  // is too thin. Those arrive after the first pass has run, so without this they
  // keep the category-and-postcode fallback line and, worse, keep the scratch
  // field that marks them: Meiji Jingu shipped in the demo reading "Landmark in
  // Yoyogikamizonochō" with its adoptedFrom marker still attached, which is what
  // broke the build (Akber, 7 Sep 2026).
  //
  // A no-op when nothing was adopted late, since the pass returns immediately on
  // an empty list.
  try {
    const described = await describeAdoptedStops(itinerary.days, destination);
    if (described > 0) {
      console.info(
        `[generate-resolved-itinerary] wrote real descriptions for ${described} late-adopted stop(s)`
      );
    }
  } catch (error) {
    console.warn('[generate-resolved-itinerary] late description pass failed, keeping synthesised lines:', error);
  }

  // Last thing before the itinerary leaves: no scratch field reaches the client.
  stripAdoptionMarkers(itinerary.days);

  return itinerary;
}

// Every late pass invalidates the guarantee the one before it just made: the
// scheduling loop drops stops its checks reject, fillStarvedBlocks fetches
// replacements, coverMissingInterests inserts one more, and any of those bends
// a route or thins a block that was fine a moment ago.
//
// That shape has now cost five demo drafts. The hours check running before the
// passes that moved stops; the reorder before the loop that drops and adds
// them; the route check before interest coverage; the thin-block check before
// the fill added to fix that; and finally a fill running after the last reorder
// inside the repair block written to fix the third, which shipped a draft with
// a 171 degree turn on day 1 and 177 on day 2.
//
// Four of those five were the same three passes written out as a sequence in
// two different places, so this is the only copy now. It is a loop, not a
// sequence, and it runs until the day stops changing. Bounded at three rounds:
// a day that cannot settle ships slightly imperfect rather than looping
// forever. Anything filled, reordered or moved leaves legs pointing at somewhere
// the stop is no longer beside, so the day is measured and refitted before the
// next round looks at it (Akber, 8 Sep 2026).
async function settleDay(day, context) {
  const { options, anchor, usedPlaceIds, stay, interests, transport, label, weekday, budget } = context;

  for (let round = 0; round < 3; round++) {
    // Sixth instance of the shape, and it is the one that started the list.
    //
    // The hours check runs in the scheduling loop above, under a comment
    // reading "now, and only now, is every stop sitting on the time it will
    // ship with". That was true when it was written and has not been true
    // since: settleDay moves stops, coverMissingInterests inserts them, and
    // both run afterwards. So Yasukuni Shrine, which Google says shuts at
    // 6pm, shipped at 23:20 with two and a half hours against it, in an app
    // whose headline claim is that it checks opening hours.
    //
    // Only activities are dropped here. A rejected meal needs re-adopting
    // rather than deleting, which the scheduling loop already does properly
    // with the placeholder machinery; meals are also anchored to fixed times
    // and do not drift into closed hours the way a moved activity does. The
    // fill pass below then replaces whatever this removed, in the same round
    // (Akber, 8 Sep 2026).
    const wrongHour =
      weekday == null
        ? []
        : unsuitableStops(day, weekday, budget).filter((entry) => !day.items[entry.index]?.mealType);
    for (const entry of [...wrongHour].sort((a, b) => b.index - a.index)) {
      if (entry.index > 0) day.items[entry.index - 1].travelToNext = null;
      day.items.splice(entry.index, 1);
    }
    if (wrongHour.length > 0) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: dropped ${wrongHour.length} stop(s) shut at their hour ${label}: ` +
          wrongHour.map((e) => `${e.name} (${e.reason})`).join('; ')
      );
      await computeTravelTimes(day.items, transport);
      applyFixedSchedule(day, options);
    }

    const filled = await fillStarvedBlocks(
      day, options.cutoffMinutes, anchor, usedPlaceIds, stay, interests
    );
    if (filled.length > 0) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: filled ${filled.length} stretch(es) left thin ${label}: ${filled.join(', ')}`
      );
    }

    const reordered = reorderDayGeographically(day);
    if (reordered) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: reordered ${label}, worst turn ${reordered.fromTurn}° -> ${reordered.toTurn}°`
      );
    }

    const moved = await repositionStrandedStops(day, anchor, usedPlaceIds, stay);
    if (moved.length > 0) {
      console.info(
        `[generate-resolved-itinerary] day ${day.day}: moved ${moved.length} stranded stop(s) ${label}: ${moved.join('; ')}`
      );
      reorderDayGeographically(day);
    }

    if (filled.length === 0 && !reordered && moved.length === 0 && wrongHour.length === 0) break;

    await computeTravelTimes(day.items, transport);
    applyFixedSchedule(day, options);
  }
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
  // Which weekday each day of the trip falls on, which is what makes opening
  // hours mean anything. Optional: a trip planned without dates simply skips the
  // hours check, and the day-part rule still applies.
  //
  // Two names because two callers: the app sends startDate (TripParams in
  // src/types.ts), the demo reseed script sends checkInDate. Reading only one of
  // them would have left the hours check permanently dead in whichever caller
  // used the other, which is exactly the failure the hours data itself had.
  const checkInDate = req.body.startDate || req.body.checkInDate;

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
      raw.packed ? resolveItinerary(raw.packed, destination, anchor, transport, accommodationDetails, interests, checkInDate, budget) : Promise.resolve(),
      raw.slow ? resolveItinerary(raw.slow, destination, anchor, transport, accommodationDetails, interests, checkInDate, budget) : Promise.resolve(),
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
