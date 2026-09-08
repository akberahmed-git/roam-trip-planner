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
  const gaps: number[] = [];
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
    // A cascade that lands inside the meal's own window is always accepted,
    // whatever the model had planned. The planned time is only a proxy for "the
    // right time of day", and the window is the real thing: holding a 12:15
    // cascade back to a 13:30 plan protects nothing and costs the day a
    // reconciled hop. This also stops the drift check fighting stretchToMeal,
    // which exists precisely to walk a meal into this window.
    const window = MEAL_WINDOWS[current.mealType];
    const insideWindow =
      window && candidateMinutes >= window.start && candidateMinutes <= window.end;

    if (insideWindow || candidateMinutes >= plannedMinutes - MEAL_DRIFT_TOLERANCE_MINUTES) {
      current.startTime = candidateStart;
    }
    // else: cascade is far earlier than planned AND outside the window (an
    // unusually fast day); keep the meal at its later, AI-planned time.
    //
    // This pass no longer decides what the traveller sees. applyFixedSchedule
    // (fixedSchedule.js) puts every meal on its anchor at the end of the
    // pipeline and rebuilds the clock around it. What is left here is the
    // coherent intermediate schedule that trimFinalNight reads to decide which
    // late stops to cut, which it cannot do against times that do not add up.
  }
}

// Time spent AT a place is always shown in clean 15-minute increments, so we
// never surface something like "319 minutes". Only the stay durations get
// rounded - travel legs between places keep their exact routed values, since
// those are real drive/walk times and forcing them onto a grid would be a lie.
// Accommodation bookends are left alone (their duration is structural, not a
// visit length). Anything positive rounds to the nearest 15 and never below 15.
//
// Lives here (not in generate-resolved-itinerary.js) so the swap/reorder
// recompute path gets identical treatment to initial generation - a swapped
// day should read exactly the same as a freshly generated one.
export const STAY_DURATION_INCREMENT_MINUTES = 15;
// The prompt specifies durationMinutes in a 45-150 range and nothing enforced
// it. A generation came back with a 240-minute stay at a nightclub starting at
// 23:10, which carried that day's hotel return to 03:35 - past even the 02:00
// nightlife cutoff, and flagged by the audit as "ends far too early" because the
// clock had wrapped (Akber, 7 Sep 2026).
//
// Clamped here rather than in the itinerary route so the swap and reorder
// recompute paths get the same treatment as a fresh generation, which is the
// reason rounding lives here too.
export const MAX_STAY_MINUTES = 150;
export const MIN_STAY_MINUTES = 45;

// The meal windows the prompt already states, restated here as the numbers the
// scheduler checks the intermediate schedule against. The times a traveller
// actually sees are the fixed anchors in fixedSchedule.js; these windows are
// what realignScheduleTimes uses to keep the working schedule sane before the
// day is fitted, and are deliberately wider than the anchors.
export const MEAL_WINDOWS = {
  breakfast: { start: 9 * 60, end: 10 * 60 + 30 },
  lunch: { start: 12 * 60, end: 14 * 60 },
  dinner: { start: 19 * 60, end: 21 * 60 }
};

// A meal is not an activity and must not be clamped like one. The global
// MIN/MAX band above is sized for sightseeing, so a model that returned 120 for
// every stop on a Slow day got a two-hour BREAKFAST waved through - and since
// each stop's start cascades from the one before, that single number is what
// pushed lunch to 11:25, an hour and a half before its window even opens. The
// upper bounds here are what each meal can plausibly run to on a slow trip; the
// lower bound stays MIN_STAY_MINUTES for all three.

// Split out of roundStayDurations so it can run EARLY, before anything has
// deliberately set a stay's length. Clamping late undid the fitting pass, which
// stretches a stop to fill the time between two meal anchors and can legitimately
// run one to 240 minutes; the clamp cut it straight back to 150 and reopened the
// hole the fit had just closed (Akber, 7 Sep 2026).
//
// The clamp is about rejecting an implausible duration from the model, not
// about overruling the scheduler's own decisions, so it belongs early, before
// anything has deliberately extended a stay.
export function clampStayDurations(day) {
  for (const item of day.items) {
    // An accommodation stop with a mealType is a real breakfast that happens to
    // be at the hotel, and its duration cascades into the rest of the day like
    // any other. Only the pure bookends (arrive/depart, durationMinutes null)
    // are structural and exempt. Skipping the whole type is what let a 120
    // minute hotel breakfast through and pushed lunch to 11:25.
    if (item.type === 'accommodation' && !item.mealType) continue;
    if (item.durationMinutes == null) continue;
    if (item.durationMinutes > MAX_STAY_MINUTES) item.durationMinutes = MAX_STAY_MINUTES;
    if (item.durationMinutes < MIN_STAY_MINUTES) item.durationMinutes = MIN_STAY_MINUTES;
  }
}

export function roundStayDurations(day) {
  for (const item of day.items) {
    if (item.type === 'accommodation') continue;
    if (item.durationMinutes == null) continue;
    let rounded =
      Math.round(item.durationMinutes / STAY_DURATION_INCREMENT_MINUTES) *
      STAY_DURATION_INCREMENT_MINUTES;
    if (rounded < STAY_DURATION_INCREMENT_MINUTES) {
      rounded = STAY_DURATION_INCREMENT_MINUTES;
    }
    item.durationMinutes = rounded;
  }
}

// Places are the clean grid, travel flexes to fit. With every stay duration
// already snapped to 15 minutes (roundStayDurations above), this walks the day
// forward and snaps each ARRIVAL time to the nearest 15 as well, then rewrites
// the leg that got you there so the numbers still add up exactly. The result:
// every arrival and departure on screen reads as :00 / :15 / :30 / :45, and the
// travel time becomes whatever gap sits between two grid-aligned stops.
//
// This deliberately inverts realignScheduleTimes' original fixed point (per
// Akber's call, 17 Jul 2026): there, travel was the grounded truth and the
// schedule bent to it; here the place times are the truth and the displayed
// travel bends to them. The arithmetic invariant ("start + stay + travel always
// adds up to the next start") is preserved either way - only which value gives
// is different. The cost is that a displayed travel time is now approximate to
// the nearest quarter hour rather than the exact routed minute, which sits well
// inside the app's existing estimate noise. Nearest (not always-up) rounding is
// used on purpose: rounding every leg up would accumulate across the day and
// drag dinner steadily later, whereas nearest cancels out and lets dinner keep
// landing on its clean intended time.
//
// Travel is snapped on its own, finer grid than stay durations. Both used to
// share STAY_DURATION_INCREMENT_MINUTES, which meant every leg in the app was
// either 15 or 30 minutes and nothing else - across three test days, 27 legs
// produced exactly two distinct values. The floor did the damage: Jardin
// Botanic and the restaurant inside it resolve 31 metres apart by their own
// Places coordinates and were shown as a "15 minute walk", which is the kind of
// number that makes a reader doubt every other number on the page.
//
// Arrivals now land on a 5-minute grid instead of 15. Stay durations keep their
// 15-minute grid (roundStayDurations above is unchanged), so a stop still reads
// "1h 30m" rather than "1h 27m"; only the clock times gain :05 / :10 / :20
// positions. The arithmetic invariant is untouched - start + stay + travel
// still adds up exactly to the next start - and the routed value now survives
// contact with the grid instead of being rounded into meaninglessness.
//
// The floor cannot go below the grid without abandoning grid-aligned times
// altogether: arrivals derive from it, so a 2-minute floor would put stops at
// :02, :07, :19 and cascade through the day. 5 is the smallest floor that keeps
// the clock readable. If a literal routed minute matters more than a tidy
// clock, the change is to skip this pass entirely and let realignScheduleTimes'
// exact times stand.
export const TRAVEL_GRID_MINUTES = 5;


// Afternoon gap-fill. Shared by generate-resolved-itinerary.js (Slow variant
// generation) and recompute-day-travel-times.js (after a swap or reorder), so
// a swapped day keeps dinner parked in its window with no dead time, exactly
// like a freshly generated one. Depends only on parseTravelMinutes and
// timeToMinutes above; the ceiling constants and keyword lists are private
// helpers used solely by activityCeiling.
// For the Slow & Immersive variant: when the last pre-dinner activity wraps
// up significantly before dinner (a common side-effect of real travel times
// being shorter than Claude assumed when writing the schedule), extend its
// durationMinutes to absorb the dead time rather than leaving an awkward
// gap. Spending a long afternoon at a spa, beach, or viewpoint is exactly
// what "slow" means - capped at 3 hours so it stays plausible. Runs after
// realignScheduleTimes so it operates on the final cascaded start times,
// then realign is called again to cascade the updated duration forward.
// Minimum gap (minutes) worth bothering to fix.
// How long a single afternoon stop may plausibly run after absorbing dead time,
// by the kind of place it is. A castle, museum, park or palace earns a long,
// immersive visit; a viewpoint or church does not; anything unrecognised sits
// in between. This is what stops a Slow day dumping four hours onto a wine bar
// (which reads as absurd) while still letting four hours land on a castle
// (which doesn't). Keyword-based, so it is a heuristic nudge: a place whose name
// gives nothing away just gets the neutral middle.
// Must stay BELOW the demo audit's marathon cap (200 minutes, in
// reseed-tokyo-demo.js). At 240 the two disagreed: the scheduler thought a
// four-hour stop was fine, so starvedBlocks saw no shortfall and never asked for
// another stop, and the audit then rejected the draft for a stay the scheduler
// had deliberately chosen. Under the cap, anything that ships over it can only
// have come from fitBlock's overflow, which starvedBlocks does catch
// (Akber, 8 Sep 2026).
const LINGER_ACTIVITY_CEILING_MINUTES = 180;
const NEUTRAL_ACTIVITY_CEILING_MINUTES = 150;
const QUICK_ACTIVITY_CEILING_MINUTES = 90;

// Words that mark a stop as worth a long visit versus a quick one. Used only to
// pick each stop's ceiling above, never to add, drop or reorder stops, so loose
// substring matching is fine. Portuguese spellings are included because Google
// returns local place names.
const LINGER_KEYWORDS = ['park', 'garden', 'jardim', 'beach', 'praia', 'spa', 'thermal', 'museum', 'museu', 'gallery', 'galeria', 'palace', 'palacio', 'palácio', 'castle', 'castelo', 'monaster', 'mosteiro', 'aquarium', 'botanic', 'vineyard', 'winery', 'quinta', 'promenade', 'waterfront', 'forest'];
const QUICK_KEYWORDS = ['viewpoint', 'miradouro', 'lookout', 'church', 'igreja', 'chapel', 'capela', 'monument', 'statue', 'memorial', 'fountain'];

export function activityCeiling(item) {
  // Name only. Reading the description too made Meiji Jingu a park, because the
  // model wrote that the shrine sits in a forested park, and a shrine then drew
  // the four-hour ceiling meant for the park itself. The name says what a place
  // is; the description says what is near it (Akber, 8 Sep 2026).
  const text = `${item.name || ''}`.toLowerCase();
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
// Where dinner should land on every day of the trip, so a traveller is not
// eating at 17:55 on Monday and 20:35 on Tuesday. Before this, dinner was simply
// wherever the day's cascade happened to leave it, which is how those two times
// shipped side by side (Akber, 7 Sep 2026).
//
// It is a target, not a promise. The day's real cutoff can force it earlier, and
// so can the plain fact that the afternoon has only so much stretch in it; see
// stretchToMeal for what happens when it cannot be reached.

function dayEndMinutes(day) {
  const items = day.items;
  const first = items.find((item) => item.startTime);
  const last = [...items].reverse().find((item) => item.startTime);
  if (!first || !last) return null;
  const start = timeToMinutes(first.startTime);
  let end = timeToMinutes(last.startTime);
  if (start == null || end == null) return null;
  end += last.durationMinutes || 0;
  // A nightlife day legitimately runs past midnight, so a smaller end than
  // start is a wrap, not an error.
  while (end < start) end += 24 * 60;
  return end;
}






// The two end-of-day cutoffs the prompt states, as the numbers the scheduler
// enforces. Kept in step with buildTripPreamble's End time line: a nightlife
// trip may run to 02:00, except on its last day, when the traveller checks out
// the next morning. Expressed past midnight (26:00) because a day that ends at
// 02:00 ends 17 hours after it started, not 7 hours before.
const LATE_NIGHT_CUTOFF_MINUTES = 26 * 60;
const NORMAL_CUTOFF_MINUTES = 22 * 60 + 30;

export function dayCutoffMinutes(dayIndex, dayCount, interests) {
  const hasNightlife = (interests || []).some((interest) =>
    String(interest).toLowerCase().includes('nightlife'));
  if (!hasNightlife) return NORMAL_CUTOFF_MINUTES;
  if (dayCount <= 1) return LATE_NIGHT_CUTOFF_MINUTES;
  return dayIndex === dayCount - 1 ? NORMAL_CUTOFF_MINUTES : LATE_NIGHT_CUTOFF_MINUTES;
}


// Places that only make sense after dinner. A bar or a club promoted into the
// afternoon is worse than the problem being solved, so these stay where they
// are; anything else - a shrine, a viewpoint, a shopping street - is a stop that
// reads better in daylight anyway.



export { dayEndMinutes };
