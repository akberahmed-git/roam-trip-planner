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
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Node strips the types itself rather than this script trying to. An earlier
// version pattern-matched the annotations away and broke every time the module
// grew a shape it had not seen - a generic, an `as`, an optional parameter -
// which is a silly way for a test harness to fail.
const STRIP = '--experimental-strip-types';
if (!process.execArgv.includes(STRIP)) {
  const result = spawnSync(process.execPath, [STRIP, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  process.exit(result.status ?? 1);
}

const SOURCES = ['api/_lib/scheduleRealign.ts', 'api/_lib/routeShape.ts', 'api/_lib/openingHours.ts', 'api/_lib/fixedSchedule.ts'];

// Copied into one temp directory so the modules' imports of each other still
// resolve, with the source's .js specifiers pointed at the .ts files Node is
// about to strip. The only import neutralised is the one that would reach for
// the network; nothing this harness calls goes near it.
async function loadScheduleModule() {
  const dir = mkdtempSync(path.join(tmpdir(), 'roam-replay-'));
  for (const source of SOURCES) {
    const src = readFileSync(source, 'utf8')
      .replace(/^import \{ estimateTravelDuration \}.*$/m, 'const estimateTravelDuration = async () => null;')
      .replace(/from '\.\/(\w+)\.js'/g, "from './$1.ts'");
    writeFileSync(path.join(dir, path.basename(source)), src);
  }
  const loaded = {};
  for (const source of SOURCES) {
    Object.assign(loaded, await import(path.join(dir, path.basename(source))));
  }
  return loaded;
}

const {
  clampStayDurations, dayEndMinutes, dayCutoffMinutes, applyFixedSchedule, MEAL_ANCHORS,
  dayShape, REORDER_REVERSAL_DEGREES, unsuitableStops, starvedBlocks, weekdayForDay
} = await loadScheduleModule();

const dump = JSON.parse(readFileSync('.roam-last-generation.json', 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// The route re-routes a day after stops move (computeTravelTimes) and then runs
// the fit a second time. This harness cannot call Google, so a leg left unknown
// by a move gets a nominal value instead: the shape is right, the exact minutes
// will differ by whatever the real legs turn out to be.
const NOMINAL_LEG_MINUTES = 15;

function runTail(day, transport, cutoff) {
  clampStayDurations(day);
  const first = applyFixedSchedule(day, { cutoffMinutes: cutoff, transport });
  if (first.moved.length > 0 || first.removed.length > 0) {
    const mode = transport === 'No car or taxi' ? 'walk' : 'drive';
    for (let i = 0; i < day.items.length - 1; i++) {
      if (!day.items[i].travelToNext) day.items[i].travelToNext = `${NOMINAL_LEG_MINUTES} minute ${mode}`;
    }
    applyFixedSchedule(day, { cutoffMinutes: cutoff, transport });
  }
  if (first.moved.length > 0) console.log(`    (moved: ${first.moved.join(', ')})`);
  if (first.removed.length > 0) console.log(`    (dropped: ${first.removed.join(', ')})`);
  return day;
}

// The guarantee the whole design rests on: the only gap between two stops is the
// travel between them. Every start time must equal the one before it plus that
// stop's length plus its leg, to the minute. A day that fails this is showing
// dead time on a card somewhere, which is the thing fixed anchors are supposed
// to make impossible.
function checkContinuity(day) {
  const faults = [];
  for (let i = 0; i < day.items.length - 1; i++) {
    const here = day.items[i];
    const next = day.items[i + 1];
    if (!here.startTime || !next.startTime) continue;
    const leg = /^(\d+) minute/.exec(here.travelToNext || '');
    if (!leg) { faults.push(`${here.name}: no travel time`); continue; }
    let expected = mins(here.startTime) + (here.durationMinutes || 0) + Number(leg[1]);
    let actual = mins(next.startTime);
    while (actual < expected - 720) actual += 24 * 60;
    if (actual !== expected) {
      faults.push(`${here.name} -> ${next.name}: ${hhmm(actual)} but ${hhmm(expected)} expected (${actual - expected > 0 ? '+' : ''}${actual - expected} min)`);
    }
  }
  return faults;
}

function show(label, day) {
  console.log(`  ${label}   [day ends ${hhmm(dayEndMinutes(day))}]`);
  for (const item of day.items) {
    const anchor = MEAL_ANCHORS[item.mealType];
    let flag = '';
    if (anchor != null && item.startTime) {
      const at = mins(item.startTime);
      flag = at === anchor ? '  << ON TIME' : `  << ${at > anchor ? '+' : ''}${at - anchor} min off ${hhmm(anchor)}`;
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
console.log(`meal anchors: ${Object.entries(MEAL_ANCHORS).map(([k, v]) => `${k} ${hhmm(v)}`).join('   ')}`);
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
    const fitted = runTail(clone(day), transport, cutoff);
    show('REPLAY', fitted);
    const turn = Math.round(dayShape(fitted).worstTurn);
    console.log(`    route: worst turn ${turn} deg` +
      (turn > REORDER_REVERSAL_DEGREES ? `  << DOUBLES BACK (audit rejects above ${REORDER_REVERSAL_DEGREES})` : ', OK'));
    const weekday = weekdayForDay(dump.trip?.startDate || dump.trip?.checkInDate, i + 1);
    const wrongHour = unsuitableStops(fitted, weekday);
    console.log(wrongHour.length === 0
      ? '    hours: OK, every stop belongs at the time it is scheduled'
      : '    WRONG HOUR:\n      ' + wrongHour.map((e) => `${e.name} - ${e.reason}`).join('\n      '));

    const thin = starvedBlocks(fitted, cutoff);
    console.log(thin.length === 0
      ? '    blocks: OK, every stretch can be filled by the stops it holds'
      : '    THIN BLOCKS: ' + thin.map((b) => `${b.stops} stop(s), ${b.shortfall} min more than they can hold`).join('; '));

    const faults = checkContinuity(fitted);
    console.log(faults.length === 0
      ? '    continuity: OK, every gap is exactly its travel time'
      : '    CONTINUITY FAULTS:\n      ' + faults.join('\n      '));
  });
}
