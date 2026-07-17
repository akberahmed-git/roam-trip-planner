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
import {
  parseTravelMinutes,
  addMinutesToTime,
  timeToMinutes,
  fillMissingTravelTimes,
  realignScheduleTimes,
  roundStayDurations,
  snapArrivalsToGrid
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
function enforceMealConstraints(day) {
  for (const item of day.items) {
    if (!item.mealType) {
      continue;
    }
    const window = MEAL_WINDOWS[item.mealType];
    if (window) {
      item.startTime = clampToWindow(item.startTime, window);
    }
    item.durationMinutes = FIXED_MEAL_DURATION_MINUTES;
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
function ensureDinner(day, destination) {
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
    durationMinutes: FIXED_MEAL_DURATION_MINUTES,
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
function ensureBreakfast(day, destination) {
  if (day.breakfastAtAccommodation) return;
  const hasBreakfast = day.items.some((item) => item.mealType === 'breakfast');
  if (hasBreakfast) return;

  day.items.push({
    type: 'meal',
    name: 'Breakfast',
    categoryTag: 'Cafe',
    description: `Find a local spot for breakfast in ${destination}.`,
    startTime: '09:00',
    durationMinutes: FIXED_MEAL_DURATION_MINUTES,
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
function ensureLunch(day, destination) {
  const hasLunch = day.items.some((item) => item.mealType === 'lunch');
  if (hasLunch) return;

  day.items.push({
    type: 'meal',
    name: 'Lunch',
    categoryTag: 'Restaurant',
    description: `Find a local restaurant for lunch in ${destination}.`,
    startTime: '13:00',
    durationMinutes: FIXED_MEAL_DURATION_MINUTES,
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
      return (
        candidates.find(
          (c) =>
            c.location &&
            !usedPlaceIds.has(c.placeId) &&
            (!anchor || haversineMeters(anchor, c.location) <= MAX_BROAD_DISTANCE_METERS)
        ) || null
      );
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
    item.photoUrl = null;
    item.hasHours = pick.hasHours || false;
    item.weekdayDescriptions = pick.weekdayDescriptions || null;
    const label = item.mealType.charAt(0).toUpperCase() + item.mealType.slice(1);
    item.description = `${label} at ${pick.name}.`;
    usedPlaceIds.add(pick.placeId);
  }
}

// Bookends a single day with the real accommodation: a departure/breakfast
// stop first, a return stop last. Per Akber's call (9 Jul 2026). Skipped
// entirely if the accommodation has no real coordinates (accommodationDetails
// missing, or an older saved trip from before location was captured) - a
// bookend stop that can't be routed to/from would just be a dead entry with
// no travel time, worse than not adding it.
function applyAccommodationBookends(day, accommodationDetails) {
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
        durationMinutes: FIXED_MEAL_DURATION_MINUTES,
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
function pickSubstitute(suggestions, usedPlaceIds, anchor) {
  if (!suggestions) {
    return null;
  }
  for (const candidate of suggestions) {
    if (!hasUsableRating(candidate)) {
      continue;
    }
    if (usedPlaceIds.has(candidate.placeId)) {
      continue;
    }
    if (anchor && candidate.location) {
      const distance = haversineMeters(anchor, candidate.location);
      if (distance > MAX_BROAD_DISTANCE_METERS) {
        continue;
      }
    }
    return candidate;
  }
  return null;
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
    item.photoUrl = substitute.photoUrl;
    item.hasHours = substitute.hasHours;
    item.weekdayDescriptions = substitute.weekdayDescriptions;
    item.location = substitute.location;
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

// For the Slow & Immersive variant: when the last pre-dinner activity wraps
// up significantly before dinner (a common side-effect of real travel times
// being shorter than Claude assumed when writing the schedule), extend its
// durationMinutes to absorb the dead time rather than leaving an awkward
// gap. Spending a long afternoon at a spa, beach, or viewpoint is exactly
// what "slow" means - capped at 3 hours so it stays plausible. Runs after
// realignScheduleTimes so it operates on the final cascaded start times,
// then realign is called again to cascade the updated duration forward.
// Minimum gap (minutes) worth bothering to fix.
const MIN_GAP_TO_STRETCH_MINUTES = 30;
// How long a single afternoon stop may plausibly run after absorbing dead time,
// by the kind of place it is. A castle, museum, park or palace earns a long,
// immersive visit; a viewpoint or church does not; anything unrecognised sits
// in between. This is what stops a Slow day dumping four hours onto a wine bar
// (which reads as absurd) while still letting four hours land on a castle
// (which doesn't). Keyword-based, so it is a heuristic nudge: a place whose name
// gives nothing away just gets the neutral middle.
const LINGER_ACTIVITY_CEILING_MINUTES = 240;
const NEUTRAL_ACTIVITY_CEILING_MINUTES = 150;
const QUICK_ACTIVITY_CEILING_MINUTES = 90;

// Words that mark a stop as worth a long visit versus a quick one. Used only to
// pick each stop's ceiling above, never to add, drop or reorder stops, so loose
// substring matching is fine. Portuguese spellings are included because Google
// returns local place names.
const LINGER_KEYWORDS = ['park', 'garden', 'jardim', 'beach', 'praia', 'spa', 'thermal', 'museum', 'museu', 'gallery', 'galeria', 'palace', 'palacio', 'palácio', 'castle', 'castelo', 'monaster', 'mosteiro', 'aquarium', 'botanic', 'vineyard', 'winery', 'quinta', 'promenade', 'waterfront', 'forest'];
const QUICK_KEYWORDS = ['viewpoint', 'miradouro', 'lookout', 'church', 'igreja', 'chapel', 'capela', 'monument', 'statue', 'memorial', 'fountain'];

function activityCeiling(item) {
  const text = `${item.name || ''} ${item.description || ''}`.toLowerCase();
  if (LINGER_KEYWORDS.some((word) => text.includes(word))) return LINGER_ACTIVITY_CEILING_MINUTES;
  if (QUICK_KEYWORDS.some((word) => text.includes(word))) return QUICK_ACTIVITY_CEILING_MINUTES;
  return NEUTRAL_ACTIVITY_CEILING_MINUTES;
}

// Fills the gap before dinner by spreading it across the afternoon, so a Slow
// day runs unhurried right up to a normal dinner instead of ending early.
// Dinner itself never moves - it stays clamped in its meal window (19:00 at the
// earliest, the same window Packed uses). The time is shared out in even
// portions across the afternoon stops rather than piled onto one, and each stop
// only takes as much as its own kind of place can plausibly hold (see
// activityCeiling); whatever one stop can't take redistributes across the ones
// that still have room. The realignScheduleTimes pass straight after recascades
// the stretched durations, landing dinner on its window. If even every stop at
// its ceiling can't absorb the whole gap - a day with a single afternoon stop
// that would need more than four hours to fill - the remainder is handed to the
// most linger-worthy stop so the timeline is never left with a hole, even though
// that stop then runs long. The real cure for that case is the generator handing
// this step enough stops to spread across, not something the schedule can invent
// its way out of.
function stretchPreDinnerGap(day) {
  const dinnerIndex = day.items.findIndex((item) => item.mealType === 'dinner');
  if (dinnerIndex <= 0) return;

  const dinner = day.items[dinnerIndex];
  if (!dinner.startTime) return;

  // Collect only activities that fall AFTER lunch and before dinner. Stretching
  // morning activities (before lunch) causes an impossible schedule: if a morning
  // activity is extended past lunchtime, realignScheduleTimes pushes lunch forward
  // but the drift-tolerance guard snaps it back to its original time, leaving a
  // phantom gap where the card shows you at lunch before you've left the morning
  // stop. Restricting to post-lunch activities means only genuinely free afternoon
  // time gets filled.
  const lunchIndex = day.items.findIndex((item) => item.mealType === 'lunch');
  const afternoonStart = lunchIndex >= 0 ? lunchIndex + 1 : 0;
  const afternoonActivities = [];
  for (let i = afternoonStart; i < dinnerIndex; i++) {
    const item = day.items[i];
    if (item.type !== 'meal' && item.type !== 'accommodation' && item.startTime && item.durationMinutes) {
      afternoonActivities.push(item);
    }
  }
  if (afternoonActivities.length === 0) return;

  const lastActivity = afternoonActivities[afternoonActivities.length - 1];
  const travelParsed = parseTravelMinutes(lastActivity.travelToNext);
  const travelMinutes = travelParsed ? travelParsed.minutes : 0;

  const activityEndMinutes = timeToMinutes(lastActivity.startTime) + lastActivity.durationMinutes;
  const dinnerStartMinutes = timeToMinutes(dinner.startTime);
  const gap = dinnerStartMinutes - activityEndMinutes - travelMinutes;

  if (gap < MIN_GAP_TO_STRETCH_MINUTES) return;

  // Share the gap out in even portions across the afternoon stops. Each stop can
  // absorb up to its own plausible ceiling (activityCeiling); whenever a stop
  // hits its ceiling, the leftover is redistributed across the stops that still
  // have room on the next pass. This keeps a long afternoon spread over two or
  // three natural stops instead of ballooning one, while still respecting that
  // some places (a castle) can hold far more time than others (a wine bar). The
  // total added equals the gap unless nothing can absorb it, so dinner still
  // cascades onto its window.
  const fillable = afternoonActivities
    .map((activity) => ({ activity, headroom: activityCeiling(activity) - activity.durationMinutes }))
    .filter((entry) => entry.headroom > 0);

  let minutesLeft = gap;
  let active = fillable;
  while (minutesLeft > 0 && active.length > 0) {
    const share = minutesLeft / active.length;
    let addedThisPass = 0;
    for (const entry of active) {
      const add = Math.min(Math.round(share), entry.headroom, minutesLeft - addedThisPass);
      if (add <= 0) continue;
      entry.activity.durationMinutes += add;
      entry.headroom -= add;
      addedThisPass += add;
    }
    minutesLeft -= addedThisPass;
    active = active.filter((entry) => entry.headroom > 0);
    if (addedThisPass <= 0) break;
  }

  // If time is still left over after every stop has reached its ceiling - a day
  // with too few afternoon stops, e.g. a single castle that would need five-plus
  // hours to reach dinner - hand the remainder to the most linger-worthy stop
  // and let it run past its nominal ceiling rather than leave a hole in the day.
  // A visible gap reads as a bug; an extra-long castle just reads as a slow day.
  // The proper cure is the generator giving Slow days enough stops in the first
  // place; this guarantees the timeline is always continuous regardless.
  if (minutesLeft > 0 && afternoonActivities.length > 0) {
    const anchor = afternoonActivities
      .slice()
      .sort((a, b) => (activityCeiling(b) - activityCeiling(a)) || (b.durationMinutes - a.durationMinutes))[0];
    anchor.durationMinutes += minutesLeft;
    minutesLeft = 0;
  }

  // dinner.startTime is deliberately left untouched so it stays in its window.
  // The realignScheduleTimes pass right after this recascades the stretched
  // durations: because the afternoon now ends right before the window time and
  // the whole gap has been absorbed, dinner lands exactly on its window with the
  // travel leg flowing straight into it and no dead time anywhere in the day.
}

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
    let replacement = nearby.find(
      (candidate) => hasUsableRating(candidate) && !usedPlaceIds.has(candidate.placeId)
    );

    // Fallback: if the specific search found nothing, search by category alone
    // (e.g. just "activity" or "restaurant") near the current location. This
    // fires when the named place is in a different city entirely and no
    // same-named alternative exists nearby.
    if (!replacement && next.type) {
      const fallbackNearby = await findNearbyCandidates(next.type, next.type, current.location).catch(() => []);
      replacement = fallbackNearby.find(
        (candidate) => hasUsableRating(candidate) && !usedPlaceIds.has(candidate.placeId)
      );
    }

    if (!replacement) {
      continue;
    }

    next.name = replacement.name;
    next.address = replacement.address;
    next.rating = replacement.rating;
    next.ratingCount = replacement.ratingCount;
    next.photoUrl = replacement.photoUrl;
    next.hasHours = replacement.hasHours;
    next.weekdayDescriptions = replacement.weekdayDescriptions;
    next.location = replacement.location;
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

  const allItems = [];

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
    enforceMealConstraints(day);
    ensureBreakfast(day, destination);
    ensureLunch(day, destination);
    ensureDinner(day, destination);
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
    applyAccommodationBookends(day, accommodationDetails);
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
    res.status(500).json({ error: error.message });
  }
}
