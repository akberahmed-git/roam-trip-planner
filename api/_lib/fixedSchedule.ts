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
const MIN_DINNER_MINUTES = 18 * 60 + 30;

// Places that only make sense after dinner, so they are never moved into the
// afternoon to balance a day out. Everything else reads better in daylight.
const NIGHTLIFE_KEYWORDS = ['bar', 'club', 'lounge', 'pub', 'izakaya', 'nightlife', 'karaoke', 'disco'];

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner'];

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

function isNightlifeStop(item) {
  const text = `${item.name || ''} ${item.categoryTag || ''}`.toLowerCase();
  return NIGHTLIFE_KEYWORDS.some((word) => text.includes(word));
}

function indexOfMeal(day, mealType) {
  return day.items.findIndex((item) => item.mealType === mealType);
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
  if (latest < anchors.dinner) anchors.dinner = Math.max(latest, MIN_DINNER_MINUTES);
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
      minNeed: stopIndexes.length * MIN_STAY_MINUTES,
      maxHold: stopIndexes.reduce((total, i) => total + activityCeiling(items[i]), 0),
    });
  }
  return blocks;
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

    const [stop] = day.items.splice(takeFrom, 1);
    const insertAt = donorIsEarlier ? needy.startIndex : needy.endIndex - 1;
    day.items.splice(insertAt, 0, stop);

    // Its old neighbours now meet directly and it now sits between two stops it
    // was never routed against. The caller re-routes the day after this.
    if (insertAt > 0) day.items[insertAt - 1].travelToNext = null;
    stop.travelToNext = null;

    // A move is only worth making if the day as a whole fits better for it.
    // Without this the pass ping-ponged one stop across the lunch boundary until
    // it ran out of iterations: taking a stop from the afternoon to fill the
    // morning left the afternoon short, which asked for it straight back.
    if (mismatch(day, cutoffMinutes) >= cost) {
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

    const movable = [...evening].reverse().find((i) => !isNightlifeStop(day.items[i]));
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

  for (const stop of stops) stop.durationMinutes = MIN_STAY_MINUTES;
  let remaining = block.available - stops.length * MIN_STAY_MINUTES;

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
      first.startTime = addMinutesToTime('00:00', nextStart - (legOf(first) || TRAVEL_GRID_MINUTES));
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
export function applyFixedSchedule(day, { cutoffMinutes, transport }) {
  const mode = transport === 'No car or taxi' ? 'walk' : 'drive';
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
