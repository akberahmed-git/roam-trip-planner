import {
  parseTravelMinutes,
  timeToMinutes,
  addMinutesToTime,
  activityCeiling,
  roundStayDurations,
  MIN_STAY_MINUTES,
  STAY_DURATION_INCREMENT_MINUTES,
  TRAVEL_GRID_MINUTES,
} from './scheduleRealign.js';
import { dayShape } from './routeShape.js';
import { isOpenAt, closesAt } from './openingHours.js';
import { isOffBandDining } from './budgetFit.js';

// Meals happen at the same time every day, and the rest of the day is fitted
// around them. This replaces the arrangement where meal times were whatever the
// day's arithmetic left over and half a dozen passes then negotiated over the
// result - which is how one Slow day served dinner at 17:55 and the next at
// 20:35, and how a breakfast landed at 12:20 (Akber, 7 Sep 2026).
//
// The reasoning, in one line: the slack has to live somewhere, and a meal time
// is the most legible thing on the page while a stop's length is a number the
// model invented. Nobody can tell whether a gallery should take 120 minutes or
// 95. Everybody knows what time they eat. So the slack lives in the durations.
//
// What that costs, honestly: fixing both ends of a stretch of the day means the
// stop durations inside it have to sum to exactly the time left after real
// travel. When there is too little time the day has to lose a stop, and when
// there is too much it has to gain one or let a stop run long. So this
// negotiates over how many stops a day holds rather than over what time dinner
// is - which is the better trade, because a day with three stops instead of four
// reads as a lighter day, while a 17:55 dinner reads as broken.
export const MEAL_ANCHORS = {
  breakfast: 9 * 60,
  lunch: 13 * 60 + 30,
  dinner: 20 * 60,
};

// Dinner gives ground only when the day would otherwise overrun its cutoff, and
// only this far. Below it the evening loses stops instead: a 17:30 dinner is not
// a fix for a day that is simply too full.
// How far dinner may slide before the evening has to give something up instead.
// This was 18:30 and a Slow day took every minute of it: two post-dinner stops
// totalling four and a half hours pushed dinner to 18:45 while the trip's other
// three days ate at 20:00. Half past seven is the point at which a meal stops
// reading as dinner, so below it the evening loses a stop rather than the meal
// losing its hour (Akber, 7 Sep 2026).
const MIN_DINNER_MINUTES = 19 * 60 + 30;

// Places that only make sense after dinner, so they are never moved into the
// afternoon to balance a day out. Everything else reads better in daylight.
const NIGHTLIFE_KEYWORDS = ['bar', 'club', 'lounge', 'pub', 'izakaya', 'nightlife', 'karaoke', 'disco'];

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner'];

// The shortest a stop may run, which depends on how the trip is paced and so is
// set per call rather than fixed. 45 minutes is a reasonable minimum on a Packed
// day; on Slow & Immersive it is a contradiction. A Slow morning with two stops
// can only afford the floor for both, and that is how Sensō-ji came to get 45
// minutes on a plan whose whole promise is an unhurried day (Akber, 7 Sep 2026).
//
// Raising it does not squeeze the stops - it makes a two-stop Slow morning
// infeasible, so rebalanceBlocks moves one out and the survivor gets the time.
let floorMinutes = MIN_STAY_MINUTES;

// After this, the day is the evening and only nightlife belongs in it. Akber's
// call (7 Sep 2026): by nine almost every museum, shop, temple and viewpoint has
// shut, so a stop scheduled later than this is either a bar, a club, a live
// music venue - or a mistake.
export const EVENING_STARTS_MINUTES = 21 * 60;

// Deliberately low. WELL_KNOWN_RATING_COUNT (1000) is a ranking preference, used
// to pick the better of several real candidates; this is a rejection bar, and set
// anywhere near 1000 it would throw out the neighbourhood shrine and the small
// museum that are the reason to travel. It only has to catch places with
// effectively no visitors at all, and every rejection costs another lookup.
export const MIN_REVIEWS_FOR_A_STOP = 50;

// The same bar unsuitableStops enforces, for the passes that go looking for a
// stop to add. Without it the loop adds a place nobody has reviewed and deletes
// it again on the next round, three times over, and the block it was meant to
// fill still ships with one stop holding four hours (Akber, 7 Sep 2026).
export function hasEnoughReviews(candidate) {
  if (!candidate || candidate.hasHours !== true) return true; // silence is not evidence
  const reviews = typeof candidate.ratingCount === 'number' ? candidate.ratingCount : null;
  return reviews !== null && reviews >= MIN_REVIEWS_FOR_A_STOP;
}

// A safety net behind validateMeals, which rejects a duplicated meal and retries
// the generation once. If the retry comes back duplicated too, failing the whole
// trip would be a worse outcome than keeping the better of the two, so the
// extras are dropped here instead of being shown. A generation on 7 Sep 2026
// came back with day 2 of both variants carrying two dinners, and everything
// downstream took them both at face value.
//
// The one kept is whichever sits closest to that meal's anchor, since that is
// the one the rest of the day was most likely built around.
export function dedupeMeals(day) {
  const dropped: string[] = [];
  for (const mealType of MEAL_ORDER) {
    const matches = day.items.filter((item) => item.mealType === mealType);
    if (matches.length <= 1) continue;

    const anchor = MEAL_ANCHORS[mealType];
    const distance = (item) => {
      const at = item.startTime ? timeToMinutes(item.startTime) : null;
      return at == null ? Number.MAX_SAFE_INTEGER : Math.abs(at - anchor);
    };
    const keep = matches.reduce((best, item) => (distance(item) < distance(best) ? item : best));

    for (const item of matches) {
      if (item === keep) continue;
      dropped.push(`${item.name} (${mealType})`);
      day.items.splice(day.items.indexOf(item), 1);
    }
  }
  return dropped;
}

function isStop(item) {
  return item.type !== 'accommodation' && !item.mealType;
}

// Whole words only. Substring matching read "Akihabara Electric Town" as a bar,
// because Akiha-bar-a contains one, and would have thrown a district out of the
// afternoon for it. Any keyword this short needs boundaries.
function isNightlifeStop(item) {
  const text = `${item.name || ''} ${item.categoryTag || ''}`.toLowerCase();
  const words = new Set(text.split(/[^a-z]+/).filter(Boolean));
  return NIGHTLIFE_KEYWORDS.some((word) => words.has(word));
}

function indexOfMeal(day, mealType) {
  return day.items.findIndex((item) => item.mealType === mealType);
}

// The rule runs in both directions, which is the half that is easy to miss. The
// Tokyo demo sent a traveller to a government building at 22:15, two hours after
// it shut - and, on another day, to a whisky bar at 11:10 in the morning for two
// hours. Same error, opposite ends of the day (Akber, 7 Sep 2026).
//
// Returns the stops the day cannot justify, with a reason each, so the caller
// can log what it dropped and go looking for a replacement. Meals are exempt
// from the nightlife half: an izakaya is a perfectly good dinner.
// How many stops on this day are scheduled at an hour they are shut.
function closedStopCount(day, weekdayIndex) {
  if (weekdayIndex == null) return 0;
  let count = 0;
  for (const item of day.items) {
    if (item.type === 'accommodation' || !item.startTime || !item.weekdayDescriptions) continue;
    const at = timeToMinutes(item.startTime);
    if (at == null) continue;
    if (isOpenAt(item.weekdayDescriptions, weekdayIndex, at) === false) count++;
  }
  return count;
}

// Visit the thing that shuts first, first.
//
// Nothing in this file ever consulted opening hours while deciding WHEN a stop
// happens. fitBlock hands out durations and the times cascade, and only
// afterwards does unsuitableStops look and delete whatever landed shut. Deleting
// does not help: the replacement is scheduled just as blindly. So an afternoon
// holding a shrine that shuts at five and a tower open until eleven had a
// one-in-two chance of putting the shrine second, and the demo has been shipping
// stops at hours they are closed for weeks - a nightclub at 15:40 among them.
//
// This reorders a stretch by closing time instead, and is deliberately timid
// about it: it does nothing unless the day already has a stop scheduled shut, it
// re-fits and counts again, and it keeps the new order only if strictly fewer
// stops are shut than before. It cannot make a day worse, and because it acts
// only on a day that is already wrong it will not sit trading places with the
// geographic reorder on a day that is fine (Akber, 8 Sep 2026).
export function orderBlocksByOpeningHours(day, options, weekdayIndex) {
  if (weekdayIndex == null) return false;
  const before = closedStopCount(day, weekdayIndex);
  if (before === 0) return false;

  const snapshot = {
    items: [...day.items],
    times: day.items.map((item) => ({ startTime: item.startTime, durationMinutes: item.durationMinutes })),
  };

  const anchors = resolveAnchors(day, options.cutoffMinutes);
  let reordered = false;
  for (const block of blocksOf(day, anchors)) {
    const slots = block.stopIndexes;
    if (slots.length < 2) continue;
    const keyed = slots.map((slot, position) => ({
      item: day.items[slot],
      position,
      closes: closesAt(day.items[slot].weekdayDescriptions, weekdayIndex),
    }));
    if (keyed.every((entry) => entry.closes == null)) continue;
    const sorted = [...keyed].sort((a, b) => {
      // Unknown hours keep their place rather than being shoved to either end:
      // silence is not evidence here any more than it is anywhere else.
      const left = a.closes == null ? Infinity : a.closes;
      const right = b.closes == null ? Infinity : b.closes;
      return left === right ? a.position - b.position : left - right;
    });
    if (sorted.every((entry, position) => entry.position === position)) continue;
    sorted.forEach((entry, position) => { day.items[slots[position]] = entry.item; });
    reordered = true;
  }
  if (!reordered) return false;

  applyFixedSchedule(day, options);
  if (closedStopCount(day, weekdayIndex) < before) return true;

  // No better. Put the day back exactly as it was, times included, so a failed
  // attempt costs nothing downstream.
  day.items = snapshot.items;
  day.items.forEach((item, index) => {
    item.startTime = snapshot.times[index].startTime;
    item.durationMinutes = snapshot.times[index].durationMinutes;
  });
  return false;
}

export function unsuitableStops(day, weekdayIndex, budget) {
  const found: any[] = [];
  const dinnerIndex = indexOfMeal(day, 'dinner');

  day.items.forEach((item, index) => {
    if (item.type === 'accommodation' || !item.startTime) return;
    const at = timeToMinutes(item.startTime);
    if (at == null) return;

    // Three-valued on purpose: true, false, or nobody knows. Google having
    // nothing to say about a place is not evidence that it is shut.
    const knownOpen =
      weekdayIndex != null && item.weekdayDescriptions
        ? isOpenAt(item.weekdayDescriptions, weekdayIndex, at)
        : null;

    if (knownOpen === false) {
      found.push({ index, name: item.name, reason: `closed at ${item.startTime}` });
      return;
    }

    if (item.mealType) {
      // A three-Michelin sushi counter is a real place, open at the right hour,
      // with a real photo and a real rating. Every other rule passes it. The only
      // thing wrong with it is that the traveller asked for Standard.
      if (isOffBandDining(`${item.name || ''} ${item.description || ''}`, budget)) {
        found.push({ index, name: item.name, reason: 'fine dining on a budget that did not ask for it' });
      }
      return;
    }

    // A place nobody has reviewed is usually not a place. "Kamadera East
    // Heritage" shipped in the Tokyo demo with 75 minutes against it, no rating,
    // no reviews, and a description that said only that it was historical: it is
    // a historic-site marker stone on a Suginami street corner. It passed every
    // other rule - inside the radius, a real Google place, open 24 hours, a tag
    // built from real place types - because nothing asked whether it was worth
    // going to.
    //
    // Only trusted when the Enterprise fields plainly came back for this place.
    // hasHours is the tell: regularOpeningHours rides the same tier as
    // userRatingCount, so hours present and reviews absent means Google has none,
    // while hours absent means we cannot tell and the stop is left alone. Same
    // principle as the hours check above: silence is not evidence.
    if (item.hasHours === true) {
      const reviews = typeof item.ratingCount === 'number' ? item.ratingCount : null;
      if (reviews === null || reviews < MIN_REVIEWS_FOR_A_STOP) {
        found.push({
          index,
          name: item.name,
          reason: reviews === null ? 'nobody has reviewed it' : `only ${reviews} reviews`,
        });
        return;
      }
    }

    const nightlife = isNightlifeStop(item);

    // Real hours outrank the keyword guess. Omoide Yokocho is an alley of
    // late-night bars whose name says none of that, and throwing it out of a
    // 21:00 slot when Google plainly says it is open would be the rule being
    // more confident than the evidence.
    if (at >= EVENING_STARTS_MINUTES && !nightlife && knownOpen !== true) {
      found.push({ index, name: item.name, reason: `scheduled at ${item.startTime}, when somewhere like this is shut` });
      return;
    }

    if (nightlife && dinnerIndex >= 0 && index < dinnerIndex) {
      found.push({ index, name: item.name, reason: `a night venue scheduled at ${item.startTime}` });
    }
  });

  return found;
}

function legOf(item) {
  const parsed = parseTravelMinutes(item.travelToNext);
  return parsed ? parsed.minutes : null;
}

// A leg with no value at all means neither routing nor the Claude estimate could
// produce one, which is rare and always the result of a stop that never resolved
// to real coordinates. A nominal hop keeps the day continuous; the alternative is
// a visible hole, which reads as a bug rather than as an unknown.
function fillMissingLegs(day, mode) {
  for (let i = 0; i < day.items.length - 1; i++) {
    if (legOf(day.items[i]) == null) {
      day.items[i].travelToNext = `${TRAVEL_GRID_MINUTES} minute ${mode}`;
    }
  }
}

// Everything from a meal's arrival to the end of the day, in minutes, computed
// from durations and legs rather than from start times so it stays correct while
// stops are being moved around it.
function loadAfter(items, index) {
  let total = items[index].durationMinutes || 0;
  for (let i = index; i < items.length - 1; i++) {
    total += legOf(items[i]) || 0;
    total += items[i + 1].durationMinutes || 0;
  }
  return total;
}

// The anchors this particular day can actually keep. Only dinner ever moves, and
// only backwards, and only because the day would otherwise finish past the time
// the traveller was promised.
function resolveAnchors(day, cutoffMinutes) {
  const anchors = { ...MEAL_ANCHORS };
  const dinnerIndex = indexOfMeal(day, 'dinner');
  if (dinnerIndex < 0 || cutoffMinutes == null) return anchors;

  const latest = cutoffMinutes - loadAfter(day.items, dinnerIndex);
  if (latest < anchors.dinner) {
    // Down to the travel grid, never up: rounding up would spend minutes the
    // cutoff does not have. Flooring also keeps the clock readable, because
    // every time after dinner is derived from this one. A day that had to
    // compress for a 22:30 checkout was showing dinner at 19:34, an evening
    // stop at 20:59 and the hotel at 22:29 - all correct to the minute, and all
    // looking like a rounding error rather than a plan (Akber, 7 Sep 2026).
    const pulled = Math.max(latest, MIN_DINNER_MINUTES);
    anchors.dinner = Math.floor(pulled / TRAVEL_GRID_MINUTES) * TRAVEL_GRID_MINUTES;
  }
  return anchors;
}

// The day split at its meals. Each bounded block knows the exact number of
// minutes its stops must add up to: the time between the end of one meal and the
// start of the next, less every travel leg crossing it.
//
// The evening is deliberately unbounded - it ends when it ends, subject only to
// the cutoff - so it is measured but never fitted.
function blocksOf(day, anchors) {
  const blocks: any[] = [];
  const items = day.items;

  for (let m = 0; m < MEAL_ORDER.length - 1; m++) {
    const fromType = MEAL_ORDER[m];
    const toType = MEAL_ORDER[m + 1];
    const to = indexOfMeal(day, toType);
    if (to < 0) continue;

    const from = indexOfMeal(day, fromType);
    // No breakfast item means breakfast is handled at the accommodation, so the
    // morning simply runs from the first thing the traveller does.
    const start = from >= 0 ? from : items.findIndex((i) => i.type !== 'accommodation');
    if (start < 0 || start >= to) continue;

    const stopIndexes: number[] = [];
    for (let i = start + 1; i < to; i++) if (isStop(items[i])) stopIndexes.push(i);

    let legs = 0;
    for (let i = start; i < to; i++) legs += legOf(items[i]) || 0;

    const opensAt = (from >= 0 ? anchors[fromType] : anchors.breakfast) + (items[start].durationMinutes || 0);
    const available = anchors[toType] - opensAt - legs;

    blocks.push({
      name: `${fromType}-${toType}`,
      endType: toType,
      startIndex: start,
      endIndex: to,
      stopIndexes,
      available,
      minNeed: stopIndexes.length * floorMinutes,
      maxHold: stopIndexes.reduce((total, i) => total + activityCeiling(items[i]), 0),
    });
  }
  return blocks;
}

// Blocks with more time than the stops inside them can plausibly hold, and by how
// much. rebalanceBlocks tries to fix these by borrowing from a neighbouring
// block, but it often cannot: the borrow has to leave the route alone, and on a
// day that sweeps across a city the morning stops are nowhere near the afternoon.
// When that happens the leftover time is handed to whichever stop can hold most
// of it, which is how a shopping street got four hours on a Slow day while
// Sensō-ji two blocks earlier got the 45-minute minimum (Akber, 7 Sep 2026).
//
// A block reported here needs another stop, not more minutes spread over the
// ones it has. Only the caller can go and find one, so this just says where and
// how big the hole is.
export function starvedBlocks(day, cutoffMinutes) {
  const anchors = resolveAnchors(day, cutoffMinutes);
  return blocksOf(day, anchors)
    .map((block) => ({
      shortfall: block.available - block.maxHold,
      available: block.available,
      // A new stop goes at the end of the block, next to the meal that closes
      // it, so it lands beside the stop it will be routed against.
      insertAt: block.endIndex,
      near: [...block.stopIndexes].reverse().map((i) => day.items[i].location).find(Boolean)
        || day.items[block.startIndex]?.location
        || null,
      stops: block.stopIndexes.length,
    }))
    // Two separate questions, and the old test answered only one of them badly.
    //
    // It was `shortfall >= floorMinutes`: report a block only when its surplus
    // is at least one whole minimum stay. That reads as "is there room for
    // another stop", but it is not, because fitBlock does not squeeze a new stop
    // into the surplus. It resets EVERY stop in the block to the floor and
    // regrows them all, so what a new stop needs is room in the block's total,
    // not room in the leftovers.
    //
    // The gap that let through was exactly the size that breaks things. A stop
    // Google gives no keyword to sits at the 150-minute neutral ceiling and the
    // demo audit rejects anything over 200, so a 51-to-74 minute overflow was
    // too big to ship and too small to report. A museum ceilings at 180, making
    // its blind spot 21 to 74. teamLab Borderless shipped at 3h30m out of a
    // 210-minute block that could comfortably have held two stops: shortfall 30,
    // threshold 75, so nothing was ever asked for (Akber, 8 Sep 2026).
    //
    // So: report a block whose stops cannot legally hold its time, whenever one
    // more stop would fit. That second clause is the same arithmetic
    // roomForAnotherStop uses, which is the point - the pass that finds the stop
    // and the pass that asks for one now agree on what "room" means.
    .filter(
      (block) =>
        block.shortfall > 0 &&
        block.available >= (block.stops + 1) * floorMinutes &&
        block.near
    );
}

// Where a day could take one more stop without anything being dropped again.
// Used when an interest the traveller chose is missing from the whole trip and a
// stop has to be found for it - there is no point inserting one into a stretch
// that is already full, because the next fit would drop it straight back out.
//
// Returns the roomiest block's insertion point, or null when the day is full.
// Google Static Maps allows one character per marker label, so a day that grows
// past nine numbered stops loses the label on the rest and ships an anonymous
// pin. The accommodation is drawn as a house and takes no number, so this counts
// only the stops that do. Nine is also simply a lot for one day - a Packed day
// asks for four or five activities and three meals, which is eight - so this is
// a ceiling the pipeline should never reach rather than a limit it works against
// (Akber, 8 Sep 2026).
export const MAX_NUMBERED_STOPS_PER_DAY = 9;

export function numberedStopCount(day) {
  return (day.items || []).filter((item) => item.type !== 'accommodation').length;
}

export function roomForAnotherStop(day, cutoffMinutes) {
  if (numberedStopCount(day) >= MAX_NUMBERED_STOPS_PER_DAY) return null;
  const anchors = resolveAnchors(day, cutoffMinutes);

  const candidates = blocksOf(day, anchors)
    .map((block) => ({
      // What the block would need if it held one more stop, against what it has.
      spare: block.available - (block.stopIndexes.length + 1) * floorMinutes,
      insertAt: block.endIndex,
      near: [...block.stopIndexes].reverse().map((i) => day.items[i].location).find(Boolean)
        || day.items[block.startIndex]?.location
        || null,
    }))
    .filter((block) => block.spare >= 0 && block.near)
    .sort((a, b) => b.spare - a.spare);

  return candidates[0] || null;
}

// Where a stop that only makes sense after dark goes: immediately after dinner,
// before whatever else the evening already holds, so it is the first thing the
// traveller does once they have eaten.
export function eveningInsertPoint(day) {
  if (numberedStopCount(day) >= MAX_NUMBERED_STOPS_PER_DAY) return null;
  const dinnerIndex = indexOfMeal(day, 'dinner');
  if (dinnerIndex < 0) return null;

  const near = day.items[dinnerIndex].location
    || [...day.items].reverse().find((item) => item.location)?.location
    || null;
  return near ? { insertAt: dinnerIndex + 1, near } : null;
}

// A block with more time than its stops can plausibly hold wants another stop; a
// block with less time than they need has one too many. Moving a stop across a
// meal boundary fixes both at once and costs the day nothing, so it is always
// tried before anything is dropped. The stop that moves is the one already
// adjacent to the boundary, so the route bends as little as possible.
function rebalanceBlocks(day, cutoffMinutes) {
  const changed = { moved: [] as string[], removed: [] as string[] };

  for (let guard = 0; guard < 8; guard++) {
    const anchors = resolveAnchors(day, cutoffMinutes);
    const blocks = blocksOf(day, anchors);

    const needy = blocks
      .filter((b) => b.available - b.maxHold > 0)
      .sort((a, b) => (b.available - b.maxHold) - (a.available - a.maxHold))[0];
    if (!needy) break;

    const donor = blocks
      .filter((b) => b !== needy && b.stopIndexes.length > 0)
      .sort((a, b) => (b.minNeed - b.available) - (a.minNeed - a.available)
        || b.stopIndexes.length - a.stopIndexes.length)[0];
    if (!donor) break;

    // Take the donor's stop nearest the shared boundary and put it on the
    // needy block's own side of that boundary.
    const donorIsEarlier = donor.startIndex < needy.startIndex;
    const takeFrom = donorIsEarlier
      ? donor.stopIndexes[donor.stopIndexes.length - 1]
      : donor.stopIndexes[0];

    const before = snapshot(day);
    const cost = mismatch(day, cutoffMinutes);
    const turn = dayShape(day).worstTurn;

    const [stop] = day.items.splice(takeFrom, 1);
    const insertAt = donorIsEarlier ? needy.startIndex : needy.endIndex - 1;
    day.items.splice(insertAt, 0, stop);

    // Its old neighbours now meet directly and it now sits between two stops it
    // was never routed against. The caller re-routes the day after this.
    if (insertAt > 0) day.items[insertAt - 1].travelToNext = null;
    stop.travelToNext = null;

    // A move has to earn its place twice over.
    //
    // It must make the day fit better. Without this the pass ping-ponged one
    // stop across the lunch boundary until it ran out of iterations: taking a
    // stop from the afternoon to fill the morning left the afternoon short,
    // which asked for it straight back.
    //
    // And it must not bend the route. Time and geography are both real, and
    // this pass only understands time - it will happily haul a stop across a
    // meal boundary because the minutes work out, with no idea that it has just
    // sent the traveller back across the city. On packed day 1 it moved Tokyo
    // National Museum out of the morning to give the afternoon 45 more minutes,
    // turning a clean Asakusa-to-Azabudai run into Asakusa, Ginza, Ueno,
    // Azabudai: a 163 degree reversal that the demo audit refused to ship, and
    // rightly (Akber, 7 Sep 2026). Undoing the geographic reorder to save a
    // stop from running 45 minutes long is a bad trade in any direction, so
    // the route is a hard constraint here and the fit is what gets optimised
    // inside it.
    // The route may not get worse at all, not merely stay under the audit's 140
    // degree bar: a move that took a day from a clean 0 degrees to 139 would
    // pass every check and still read as a zig-zag to the person walking it.
    // The geographic reorder has already found a good order by the time this
    // runs, and there is nothing here that knows better.
    const fitsBetter = mismatch(day, cutoffMinutes) < cost;
    const routeHolds = dayShape(day).worstTurn <= turn;
    if (!fitsBetter || !routeHolds) {
      restore(day, before);
      break;
    }
    changed.moved.push(stop.name);
  }

  // Nothing left to trade with: a block still holding more stops than its time
  // allows has to lose one, and it loses the last, keeping the earlier stops
  // the day was built around.
  for (let guard = 0; guard < 8; guard++) {
    const anchors = resolveAnchors(day, cutoffMinutes);
    const blocks = blocksOf(day, anchors);
    const over = blocks
      .filter((b) => b.minNeed - b.available > 0 && b.stopIndexes.length > 0)
      .sort((a, b) => (b.minNeed - b.available) - (a.minNeed - a.available))[0];
    if (!over) break;

    const index = over.stopIndexes[over.stopIndexes.length - 1];
    if (index > 0) day.items[index - 1].travelToNext = day.items[index].travelToNext;
    changed.removed.push(day.items[index].name);
    day.items.splice(index, 1);
  }

  return changed;
}

// How badly the day does not fit, in minutes: time no block can absorb, plus
// time no block has to give. Zero means every stretch of the day can be filled
// by the stops it holds without any of them running implausibly long or short.
function mismatch(day, cutoffMinutes) {
  const anchors = resolveAnchors(day, cutoffMinutes);
  return blocksOf(day, anchors).reduce(
    (total, b) => total + Math.max(0, b.available - b.maxHold) + Math.max(0, b.minNeed - b.available),
    0
  );
}

function snapshot(day) {
  return day.items.map((item) => ({ item, travelToNext: item.travelToNext }));
}

function restore(day, saved) {
  day.items = saved.map((entry) => {
    entry.item.travelToNext = entry.travelToNext;
    return entry.item;
  });
}

// The evening decides how late dinner can be. When it is heavy enough to push
// dinner below MIN_DINNER_MINUTES, a stop comes out of it: moved into the
// afternoon where it will be seen in daylight, or dropped when it is somewhere
// that only makes sense at night.
function relieveEvening(day, cutoffMinutes) {
  const changed = { moved: [] as string[], removed: [] as string[] };
  if (cutoffMinutes == null) return changed;

  for (let guard = 0; guard < 8; guard++) {
    const dinnerIndex = indexOfMeal(day, 'dinner');
    if (dinnerIndex < 0) break;
    if (cutoffMinutes - loadAfter(day.items, dinnerIndex) >= MIN_DINNER_MINUTES) break;

    const evening: number[] = [];
    for (let i = dinnerIndex + 1; i < day.items.length; i++) if (isStop(day.items[i])) evening.push(i);
    if (evening.length === 0) break;

    // Latest first, since the last stop of the night is both the most absurdly
    // scheduled and the cheapest to unhook. Among those, prefer one whose move
    // does not bend the route - this pass has to act, because a dinner that
    // cannot reach a normal hour is a broken day, but it can still pick the
    // least damaging way to act rather than the first one it finds.
    const candidates = [...evening].reverse().filter((i) => !isNightlifeStop(day.items[i]));
    let movable: number | null = null;
    if (candidates.length > 0) {
      const turn = dayShape(day).worstTurn;
      movable = candidates.find((i) => {
        const trial = snapshot(day);
        const [stop] = day.items.splice(i, 1);
        day.items.splice(dinnerIndex, 0, stop);
        const holds = dayShape(day).worstTurn <= turn;
        restore(day, trial);
        return holds;
      }) ?? candidates[0];
    }

    if (movable != null) {
      const [stop] = day.items.splice(movable, 1);
      day.items[movable - 1].travelToNext = null;
      stop.travelToNext = null;
      day.items.splice(dinnerIndex, 0, stop);
      changed.moved.push(stop.name);
      continue;
    }

    const last = evening[evening.length - 1];
    day.items[last - 1].travelToNext = day.items[last].travelToNext;
    changed.removed.push(day.items[last].name);
    day.items.splice(last, 1);
  }
  return changed;
}

// Hands out a block's minutes. Everyone starts at the floor, then whole
// 15-minute steps go round the block until the time is used up or every stop has
// reached what its kind of place can plausibly hold. Round-robin rather than an
// even split so a long afternoon spreads across three stops instead of
// ballooning one, while a castle can still outlast a viewpoint.
function fitBlock(day, block) {
  const stops = block.stopIndexes.map((i) => day.items[i]);
  if (stops.length === 0) return block.available;

  for (const stop of stops) stop.durationMinutes = floorMinutes;
  let remaining = block.available - stops.length * floorMinutes;

  let progress = true;
  while (remaining >= STAY_DURATION_INCREMENT_MINUTES && progress) {
    progress = false;
    for (const stop of stops) {
      if (remaining < STAY_DURATION_INCREMENT_MINUTES) break;
      if (stop.durationMinutes + STAY_DURATION_INCREMENT_MINUTES > activityCeiling(stop)) continue;
      stop.durationMinutes += STAY_DURATION_INCREMENT_MINUTES;
      remaining -= STAY_DURATION_INCREMENT_MINUTES;
      progress = true;
    }
  }

  // Every stop is at its ceiling and there is still time to account for. The
  // most linger-worthy one takes the rest rather than the day showing a hole.
  // The real cure is the generator handing this block another stop, which
  // rebalanceBlocks has already tried.
  if (remaining >= STAY_DURATION_INCREMENT_MINUTES) {
    const longest = [...stops].sort((a, b) => activityCeiling(b) - activityCeiling(a))[0];
    const whole = Math.floor(remaining / STAY_DURATION_INCREMENT_MINUTES) * STAY_DURATION_INCREMENT_MINUTES;
    longest.durationMinutes += whole;
    remaining -= whole;
  }

  return remaining;
}

// Writes the clock. Meals sit on their anchors, every other start time follows
// from the stop before it, and whatever minutes the 15-minute duration grid could
// not express are spread across that block's travel legs so the arithmetic still
// closes exactly on the next anchor. A leg never drops below the travel grid, so
// no stop is ever shown as reached the same minute the last one was left.
function assignTimes(day, anchors, residuals, mode) {
  const items = day.items;

  for (const mealType of MEAL_ORDER) {
    const index = indexOfMeal(day, mealType);
    if (index >= 0) items[index].startTime = addMinutesToTime('00:00', anchors[mealType]);
  }

  // The opening bookend is a departure, so it sits one leg before whatever the
  // traveller does first.
  const first = items[0];
  if (first && first.type === 'accommodation' && !first.mealType && items.length > 1) {
    const next = items[1];
    const nextStart = timeToMinutes(next.startTime);
    if (nextStart != null) {
      // Snapped like every other leg, so the departure time reads as cleanly as
      // the rest of the day rather than as an 08:51.
      const leg = Math.max(
        TRAVEL_GRID_MINUTES,
        Math.round((legOf(first) || TRAVEL_GRID_MINUTES) / TRAVEL_GRID_MINUTES) * TRAVEL_GRID_MINUTES
      );
      first.travelToNext = `${leg} minute ${mode}`;
      first.startTime = addMinutesToTime('00:00', nextStart - leg);
    }
  }

  const blocks = blocksOf(day, anchors);
  for (const block of blocks) {
    const residual = residuals.get(block.name) || 0;
    const legCount = block.endIndex - block.startIndex;
    const share = Math.trunc(residual / legCount);

    // Legs land on the 5-minute travel grid, which is what keeps every arrival
    // on the clock reading as :05, :10, :15 rather than :06 or :53. It works
    // because everything else in the sum already is: stay durations are whole
    // 15-minute steps and the anchors are whole half hours, so once the legs are
    // too, so is every time on the page - including the closing leg below, which
    // is simply the difference between two of them.
    for (let i = block.startIndex; i < block.endIndex; i++) {
      const isLast = i === block.endIndex - 1;
      const base = legOf(items[i]) || TRAVEL_GRID_MINUTES;
      const raw = base + (isLast ? residual - share * (legCount - 1) : share);
      const value = Math.max(
        TRAVEL_GRID_MINUTES,
        Math.round(raw / TRAVEL_GRID_MINUTES) * TRAVEL_GRID_MINUTES
      );
      items[i].travelToNext = `${value} minute ${mode}`;
    }

    // Cascade the block, then close the last leg on the next anchor exactly, so
    // rounding can never leave a gap or an overlap in front of a meal.
    let clock = timeToMinutes(items[block.startIndex].startTime) + (items[block.startIndex].durationMinutes || 0);
    for (let i = block.startIndex; i < block.endIndex - 1; i++) {
      clock += legOf(items[i]) || TRAVEL_GRID_MINUTES;
      items[i + 1].startTime = addMinutesToTime('00:00', clock);
      clock += items[i + 1].durationMinutes || 0;
    }
    const closing = Math.max(TRAVEL_GRID_MINUTES, anchors[block.endType] - clock);
    items[block.endIndex - 1].travelToNext = `${closing} minute ${mode}`;
  }

  // The evening has no anchor to close on; it simply runs from dinner.
  const dinnerIndex = indexOfMeal(day, 'dinner');
  if (dinnerIndex >= 0) {
    let clock = anchors.dinner + (items[dinnerIndex].durationMinutes || 0);
    for (let i = dinnerIndex; i < items.length - 1; i++) {
      const leg = Math.max(
        TRAVEL_GRID_MINUTES,
        Math.round((legOf(items[i]) || TRAVEL_GRID_MINUTES) / TRAVEL_GRID_MINUTES) * TRAVEL_GRID_MINUTES
      );
      items[i].travelToNext = `${leg} minute ${mode}`;
      clock += leg;
      items[i + 1].startTime = addMinutesToTime('00:00', clock);
      clock += items[i + 1].durationMinutes || 0;
    }
  }
}

// One entry point, replacing the passes that used to negotiate over the clock
// between them. Returns what it had to change about the day's contents so the
// caller can re-route and log it.
export function applyFixedSchedule(day, { cutoffMinutes, transport, minStayMinutes }: { cutoffMinutes?: number | null; transport?: string; minStayMinutes?: number }) {
  const mode = transport === 'No car or taxi' ? 'walk' : 'drive';
  floorMinutes = minStayMinutes || MIN_STAY_MINUTES;
  const duplicates = dedupeMeals(day);
  fillMissingLegs(day, mode);

  const evening = relieveEvening(day, cutoffMinutes);
  const balance = rebalanceBlocks(day, cutoffMinutes);
  fillMissingLegs(day, mode);

  // Every stay lands on the 15-minute grid before anything is fitted. The
  // bounded blocks below hand out whole 15-minute steps anyway, so this is only
  // doing real work on the evening, which has no anchor to fit against and
  // otherwise keeps whatever length the model gave it.
  roundStayDurations(day);

  const anchors = resolveAnchors(day, cutoffMinutes);
  const residuals = new Map<string, number>();
  for (const block of blocksOf(day, anchors)) {
    residuals.set(block.name, fitBlock(day, block));
  }

  assignTimes(day, anchors, residuals, mode);

  return {
    moved: [...evening.moved, ...balance.moved],
    removed: [...duplicates, ...evening.removed, ...balance.removed],
  };
}
