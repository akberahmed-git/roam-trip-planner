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
  realignScheduleTimes
} from './_lib/scheduleRealign.js';

// Fixed meal windows and the "day can't start before 9am" rule, per Akber's
// call (9 Jul 2026). Enforced here rather than trusted to the prompt alone
// (see generateRawItinerary.js for the prompt-side instruction) - Claude's
// own startTime/durationMinutes are a plausible first guess, but this is the
// one place they're actually guaranteed to hold.
const MEAL_WINDOWS = {
  breakfast: { start: '09:00', end: '10:30' },
  lunch: { start: '12:00', end: '14:00' },
  dinner: { start: '20:00', end: '22:00' },
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
const MAX_SAME_DAY_DRIVE_MINUTES = 120;

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

    if (!parsed || parsed.mode !== 'drive' || parsed.minutes <= MAX_SAME_DAY_DRIVE_MINUTES) {
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

    const nearby = await findNearbyCandidates(next.name, next.type, current.location).catch(() => []);
    const replacement = nearby.find(
      (candidate) => hasUsableRating(candidate) && !usedPlaceIds.has(candidate.placeId)
    );
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

  // Every item gets audited here, not just the ones verification changed -
  // a "found, exact name match" item can still carry a description that
  // contradicts its own real name (e.g. Claude both named and described a
  // place called "Smack Burger" as "a chic brunch café" in the same
  // generation pass, with nothing ever having checked the pairing itself).
  // A match-score-based filter would miss that case entirely, since the
  // name was never substituted - see refreshDescriptions.js.
  try {
    await refreshDescriptions(allItems);
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
    applyAccommodationBookends(day, accommodationDetails);
    enforceEarliestStart(day);
  });

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
