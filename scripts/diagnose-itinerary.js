// Reads .roam-last-generation.json (written by reseed-tokyo-demo.js) and prints
// the full geometry of every day, plus what a reorder could achieve under
// different pinning rules.
//
// Exists because ten rounds of fixes were reverse-engineered from a four-line
// audit summary while the itinerary that produced it was thrown away. This runs
// offline against a saved generation, so a change can be tested in a second
// instead of EUR 1.43 (Akber, 7 Sep 2026).
//
//   node scripts/diagnose-itinerary.js
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const LONG_LEG_KM = 4;
const REVERSAL_DEGREES = 140;
const EVENING_MINUTES = 19 * 60;

const toRad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angle = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function worstTurn(locs) {
  const longs = [];
  for (let k = 0; k < locs.length - 1; k++) {
    if (km(locs[k], locs[k + 1]) >= LONG_LEG_KM) longs.push(bearing(locs[k], locs[k + 1]));
  }
  let worst = 0;
  for (let k = 0; k < longs.length - 1; k++) worst = Math.max(worst, angle(longs[k], longs[k + 1]));
  return worst;
}
function* perms(a) {
  if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++) {
    for (const t of perms([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...t];
  }
}
// Mirrors the shipped reorder INCLUDING its brute-force cap and swap fallback.
// The first version modelled the algorithm but not the code, so it reported
// "reorder would reach 124 degrees" on a day where the real pass bailed out at
// the cap and did nothing at all. A harness that disagrees with production is
// worse than none, because it is believed (Akber, 7 Sep 2026).
const MAX_REORDER_BRUTE_FORCE = 8;

const MEAL_SEQUENCE = { breakfast: 0, lunch: 1, dinner: 2 };
function mealsInOrder(items) {
  let prev = -1;
  for (const i of items) {
    const r = MEAL_SEQUENCE[i.mealType];
    if (r == null) continue;
    if (r < prev) return false;
    prev = r;
  }
  return true;
}

function bestUnder(items, movableIdx) {
  const base = items.map((i) => i.location);
  const movable = movableIdx.map((i) => items[i]);
  let best = worstTurn(base);
  let bestOrder = items;
  const apply = (arr) => {
    const trial = [...items];
    movableIdx.forEach((slot, i) => { trial[slot] = arr[i]; });
    return trial;
  };

  if (movable.length <= MAX_REORDER_BRUTE_FORCE) {
    for (const p of perms(movable)) {
      const trial = apply(p);
      if (!mealsInOrder(trial)) continue;
      const t = worstTurn(trial.map((i) => i.location));
      if (t < best) { best = t; bestOrder = trial; }
    }
    return { turn: best, order: bestOrder, mode: 'brute' };
  }

  let arrangement = [...movable];
  let improved = true;
  while (improved) {
    improved = false;
    for (let a = 0; a < arrangement.length - 1; a++) {
      for (let b = a + 1; b < arrangement.length; b++) {
        const trialArr = [...arrangement];
        [trialArr[a], trialArr[b]] = [trialArr[b], trialArr[a]];
        const trial = apply(trialArr);
        if (!mealsInOrder(trial)) continue;
        const t = worstTurn(trial.map((i) => i.location));
        if (t < best) { best = t; bestOrder = trial; arrangement = trialArr; improved = true; }
      }
    }
  }
  return { turn: best, order: bestOrder, mode: 'swap' };
}

const dump = JSON.parse(await readFile(path.join(process.cwd(), '.roam-last-generation.json'), 'utf8'));
const hotel = dump.accommodationDetails?.location;
console.log(`hotel: ${dump.accommodationDetails?.name}  ${hotel ? `${hotel.lat.toFixed(4)},${hotel.lng.toFixed(4)}` : 'NO LOCATION'}\n`);

for (const variant of Object.keys(dump.itinerary)) {
  for (const day of dump.itinerary[variant].days || []) {
    const mid = (day.items || []).filter((i) => i.type !== 'accommodation' && i.location);
    console.log(`=== ${variant} day ${day.day}: ${day.theme} ===`);
    mid.forEach((it, k) => {
      const pin = it.mealType ? 'MEAL' : (() => {
        const [h, m] = String(it.startTime || '').split(':').map(Number);
        return Number.isFinite(h) && h * 60 + (m || 0) >= EVENING_MINUTES ? 'EVENING' : '';
      })();
      const next = mid[k + 1];
      const leg = next ? `${km(it.location, next.location).toFixed(1)}km ${bearing(it.location, next.location).toFixed(0)}°` : '';
      const out = hotel ? `${km(it.location, hotel).toFixed(1)}km from hotel` : '';
      console.log(`  ${String(it.startTime || '-').padEnd(5)} ${String(it.name).slice(0, 32).padEnd(32)} ${pin.padEnd(8)} ${out.padEnd(20)} ${leg}`);
    });
    const locs = mid.map((i) => i.location);
    // Matches the shipped rule: meals MAY move (subject to breakfast < lunch <
    // dinner, enforced in bestUnder); only evening activities are pinned.
    const freeIdx = mid.map((i, k) => k).filter((k) => {
      const it = mid[k];
      if (it.mealType) return true;
      const [h, m] = String(it.startTime || '').split(':').map(Number);
      return !(Number.isFinite(h) && h * 60 + (m || 0) >= EVENING_MINUTES);
    });
    const allIdx = mid.map((i, k) => k);
    const now = worstTurn(locs);
    const pinned = bestUnder(mid, freeIdx);
    const verdict = now > REVERSAL_DEGREES ? 'FAILS' : 'passes';
    console.log(`  -> as generated ${now.toFixed(0)}° (${verdict})   ${mid.length - freeIdx.length ? '' : ''}${freeIdx.length} movable via ${pinned.mode}   after reorder ${pinned.turn.toFixed(0)}°`);
    if (pinned.order && pinned.turn < now) {
      console.log(`     after reorder: ${pinned.order.map((i) => String(i.name).slice(0, 18)).join(' -> ')}`);
    }
    console.log();
  }
}
