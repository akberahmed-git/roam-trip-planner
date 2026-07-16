import { estimateTravelDuration } from './estimateTravelDuration.js';

// Shared by generate-resolved-itinerary.js (initial generation) and
// recompute-day-travel-times.js (after a swap or reorder) - both need the
// exact same "fill in whatever's missing, then reconcile the schedule
// against it" logic, and duplicating it risked the two paths quietly
// drifting apart over time.

export function parseTravelMinutes(label) {
  if (!label) {
    return null;
  }
  const match = /^(\d+) minute (walk|drive)$/.exec(label);
  if (!match) {
    return null;
  }
  return { minutes: parseInt(match[1], 10), mode: match[2] };
}

// Same mod-24h wraparound approach the frontend's own computeEndTime already
// uses for start+duration - the extra "+ 24 * 60" before the final modulo
// just guards against a negative minutesToAdd, which shouldn't happen here
// but costs nothing to handle.
export function addMinutesToTime(time, minutesToAdd) {
  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return time;
  }
  const total = (((hours * 60 + minutes + minutesToAdd) % (24 * 60)) + 24 * 60) % (24 * 60);
  const newHours = Math.floor(total / 60);
  const newMinutes = total % 60;
  return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

export function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

// How far a meal's actual (schedule-reconciled) time is allowed to drift
// from its AI-planned time before realignScheduleTimes falls back to
// keeping the meal at its original time instead. Per Akber's call
// (9 Jul 2026): +/- 60 minutes - wide enough that the fallback (and the
// one-hop mismatch it reintroduces) should rarely trigger on a normally-
// paced day, tight enough that a meal still reads as roughly the right time
// of day even when it does.
export const MEAL_DRIFT_TOLERANCE_MINUTES = 60;

// Fills in any gap real routing (computeTravelTimes) left null - almost
// always because one or both stops in the pair never resolved to a real,
// verified place, so there was no coordinate pair to route between at all.
// See estimateTravelDuration.js for why this exists and the trade-off it
// carries. Only touches real gaps (i < length - 1); the last item of a day
// is always null on purpose (nothing to travel to next) and is left alone.
//
// Runs every gap's estimate call in parallel (Promise.all), not one at a
// time - each gap is independent (filling one never depends on another's
// result), so there was no correctness reason for the original sequential
// for-loop, only an unnecessary latency cost. Mattered most on the swap/
// reorder recompute path (recompute-day-travel-times.js): a day with two or
// three simultaneously-missing gaps meant two or three full Claude round
// trips stacked back to back with zero loading feedback on screen, which is
// most likely what Akber saw as travel indicators taking "a minute" to
// reappear after a swap (9 Jul 2026 bug report).
export async function fillMissingTravelTimes(day, transport, destination) {
  const gaps = [];
  for (let i = 0; i < day.items.length - 1; i++) {
    if (!day.items[i].travelToNext) {
      gaps.push(i);
    }
  }

  await Promise.all(
    gaps.map(async (i) => {
      const current = day.items[i];
      const next = day.items[i + 1];
      try {
        current.travelToNext = await estimateTravelDuration({
          fromName: current.name,
          fromDescription: current.description,
          toName: next.name,
          toDescription: next.description,
          destination,
          transportMode: transport,
        });
      } catch {
        // Leave it null - a failed estimate call is no worse than the gap
        // this was trying to fill in the first place.
      }
    })
  );
}

// Runs last, once every gap has a final travelToNext (real, drive-cap-
// adjusted, or Claude-estimated) - see fillMissingTravelTimes above. The raw
// itinerary generation assigns startTime/durationMinutes to every stop
// before any real travel time is known, so a stop's stated arrival time and
// its stated travel-time-to-get-there can end up disagreeing (e.g. a 50
// minute stop starting at 08:30, arriving somewhere at 10:00, but showing a
// "28 minute drive" in between - 08:30 + 50 + 28 is 09:48, not 10:00).
//
// Per Akber's explicit call (9 Jul 2026): the travel time is the grounded
// number here (real routing data, or at minimum a Claude estimate that's
// still trying to reflect these two actual places), so it stays fixed and
// the schedule is what gets corrected to agree with it, not the reverse -
// bending the travel number to fit an arbitrary AI-chosen gap would mean
// occasionally showing a knowingly false duration instead of a real one.
//
// The first stop of the day keeps its original AI-assigned startTime as the
// day's anchor; every later stop's startTime is derived from the previous
// stop's own start + duration + travelToNext. If a hop still has no
// travelToNext at all (both real routing and the Claude estimate failed),
// that one stop's original startTime is left as-is and the chain continues
// from there rather than guessing a 0-minute gap.
//
// Meal stops (item.mealType set - breakfast/lunch/dinner) get the same
// cascaded candidate time as any other stop, but it's only accepted if it
// falls within MEAL_DRIFT_TOLERANCE_MINUTES of the AI's own originally
// planned time for that meal. That keeps every single hop in the itinerary,
// meal-adjacent ones included, fully consistent on a normally-paced day,
// without letting accumulated slack silently push dinner an hour or more
// earlier than intended on a day that happens to run faster than the AI
// assumed.
//
// Only when the drift is large enough to fall outside that window does this
// fall back to keeping the meal at its original planned time - the same
// trade-off as a hard anchor (the one hop leading into the meal can go back
// to not perfectly reconciling), but now only on the rarer day where the
// pacing genuinely ran unusually fast or slow, not as standard behavior.
export function realignScheduleTimes(day) {
  for (let i = 1; i < day.items.length; i++) {
    const previous = day.items[i - 1];
    const current = day.items[i];

    if (!previous.startTime) {
      continue;
    }

    const parsed = parseTravelMinutes(previous.travelToNext);
    if (!parsed) {
      continue;
    }

    // durationMinutes is intentionally null on the accommodation bookend
    // stops (see generate-resolved-itinerary.js's buildAccommodationItem) -
    // a pure departure/arrival point has no stay time of its own, just a
    // moment in time. Treated as a 0-minute stay here rather than skipped
    // outright, so the very first real leg of the day (accommodation ->
    // breakfast, or accommodation -> first activity) still gets reconciled
    // against real travel time like every other hop, instead of silently
    // being the one gap in the day exempt from "the travel duration always
    // adds up."
    const candidateStart = addMinutesToTime(previous.startTime, (previous.durationMinutes || 0) + parsed.minutes);

    if (!current.mealType) {
      current.startTime = candidateStart;
      continue;
    }

    const plannedMinutes = timeToMinutes(current.startTime);
    const candidateMinutes = timeToMinutes(candidateStart);
    if (plannedMinutes == null || candidateMinutes == null) {
      continue;
    }

    // A meal must never be shown starting before the stop before it has
    // finished. The old check was symmetric (abs), so when the morning ran
    // long and the cascade pushed a meal well PAST its planned time, it fell
    // back to the earlier planned time - printing, for example, a 12:30 lunch
    // straight after a stop that doesn't end until 13:47 (the first-half-of-day
    // "times running backwards" bug). So the cascade is now always accepted
    // whenever it lands at or after the planned time (a late-but-real meal),
    // and also when it lands only slightly before it. The fallback to the
    // planned time is kept only for the opposite case - the day ran much faster
    // than the AI assumed and the cascade would put the meal well BEFORE its
    // planned time - where holding it at the later planned time keeps it
    // reading as the right time of day and still never precedes the prior stop.
    if (candidateMinutes >= plannedMinutes - MEAL_DRIFT_TOLERANCE_MINUTES) {
      current.startTime = candidateStart;
    }
    // else: cascade is far earlier than planned (an unusually fast day); keep
    // the meal at its later, AI-planned time.
  }
}
