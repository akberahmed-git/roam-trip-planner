// Replays the REAL scheduling passes (api/_lib/scheduleRealign.ts) against the
// saved generation in .roam-last-generation.json and prints every day before
// and after, flagging each meal against its window.
//
//   node scripts/replay-schedule.js
//
// Companion to diagnose-itinerary.js, which explains a day's geometry. This one
// answers the other half: what the clock does. Both exist so a scheduling change
// can be checked in a second against a real generation instead of EUR 1.43 a go
// (Akber, 7 Sep 2026).
//
// scheduleRealign.ts is imported by stripping its handful of type annotations
// into a temporary .mjs rather than by duplicating its logic here. That is the
// whole point: a harness that re-implements the code it is testing will happily
// agree with itself while production does something else, which is exactly how a
// reorder that production never ran got reported as working.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SOURCE = 'api/_lib/scheduleRealign.ts';

function loadScheduleModule() {
  let src = readFileSync(SOURCE, 'utf8');
  // Its only import is used by fillMissingTravelTimes, which this never calls.
  src = src.replace(
    /^import \{ estimateTravelDuration \}.*$/m,
    'const estimateTravelDuration = async () => null;'
  );
  // Two annotation shapes appear in this module: a typed empty array literal,
  // and an optional function parameter. Anything else would need a real
  // TypeScript loader, and the script says so rather than silently mangling it.
  src = src.replace(/(const \w+)\s*:\s*[\w.]+\[\]\s*=/g, '$1 =');
  src = src.replace(/(\(|,\s*)(\w+)\?\s*:\s*[\w.]+(?:\s*\|\s*[\w.]+)*/g, '$1$2');
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'roam-replay-')), 'scheduleRealign.mjs');
  writeFileSync(file, src);
  return import(file);
}

const {
  clampStayDurations, realignScheduleTimes, stretchPreDinnerGap,
  roundStayDurations, snapArrivalsToGrid, dayEndMinutes, MEAL_WINDOWS,
  dayCutoffMinutes, trimTailForDinner, DINNER_TARGET_MINUTES
} = await loadScheduleModule();

const dump = JSON.parse(readFileSync('.roam-last-generation.json', 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// The route re-routes a day after stops move (computeTravelTimes). This harness
// cannot call Google, so a leg left unknown by a move is given a nominal value
// instead. Times after a move are therefore approximate - the shape is right,
// the exact minutes will differ by whatever the real legs turn out to be.
const NOMINAL_LEG_MINUTES = 15;
function fillMovedLegs(day, transport) {
  const mode = transport === 'No car or taxi' ? 'walk' : 'drive';
  for (let i = 0; i < day.items.length - 1; i++) {
    if (!day.items[i].travelToNext) day.items[i].travelToNext = `${NOMINAL_LEG_MINUTES} minute ${mode}`;
  }
}

// The same order the tail of resolveItinerary runs them in. The route re-routes
// the day after a trim; here the removed stop's leg is inherited by the stop
// before it, so the times are within a few minutes of what will actually ship.
function runTail(day, transport, cutoff) {
  clampStayDurations(day);
  realignScheduleTimes(day);
  const { removed, moved } = trimTailForDinner(day, cutoff);
  if (removed.length > 0 || moved.length > 0) {
    fillMovedLegs(day, transport);
    realignScheduleTimes(day);
    if (moved.length > 0) console.log(`    (moved to before dinner: ${moved.join(', ')})`);
    if (removed.length > 0) console.log(`    (dropped: ${removed.join(', ')})`);
  }
  roundStayDurations(day);
  stretchPreDinnerGap(day, cutoff);
  realignScheduleTimes(day);
  snapArrivalsToGrid(day, transport);
  return day;
}

function show(label, day) {
  console.log(`  ${label}   [day ends ${hhmm(dayEndMinutes(day))}]`);
  for (const item of day.items) {
    const window = MEAL_WINDOWS[item.mealType];
    let flag = '';
    if (window && item.startTime) {
      const at = mins(item.startTime);
      flag = at >= window.start && at <= window.end ? '  << IN WINDOW' : '  << OUT OF WINDOW';
    }
    console.log(
      `    ${item.startTime || '--'} ${String(item.durationMinutes ?? '').padStart(4)}m ` +
      `${(item.mealType || '').padEnd(10)}${item.name.slice(0, 34).padEnd(36)}${flag}`
    );
  }
}

const transport = dump.trip?.transport || 'Car';
const interests = dump.trip?.interests || [];
console.log(`transport: ${transport}   interests: ${interests.join(', ') || '(none)'}`);
console.log(`dinner target: ${hhmm(DINNER_TARGET_MINUTES)}`);
for (const variant of ['packed', 'slow']) {
  const days = dump.itinerary?.[variant];
  if (!days) continue;
  console.log(`\n======== ${variant.toUpperCase()} ========`);
  const list = days.days || days;
  list.forEach((day, i) => {
    const cutoff = dayCutoffMinutes(i, list.length, interests);
    console.log(`\n--- Day ${i + 1} ---   [cutoff ${hhmm(cutoff)}]`);
    show('SAVED ', day);
    console.log();
    show('REPLAY', runTail(clone(day), transport, cutoff));
  });
}
