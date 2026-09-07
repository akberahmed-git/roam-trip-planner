// Unit test for api/_lib/budgetFit.ts.
//
//   node scripts/test-budget-fit.js
//
// The budget band used to be one context line in the prompt with nothing acting
// on it. These cases pin the two things that make the new behaviour safe: an
// unpriced place is never pushed behind an off-band one, and the quality order
// candidates arrive in survives inside each rank.
import { spawnSync } from 'node:child_process';

const STRIP = '--experimental-strip-types';
if (!process.execArgv.includes(STRIP)) {
  const r = spawnSync(process.execPath, [STRIP, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  process.exit(r.status ?? 1);
}

const { sortByBudgetFit, priceLevelOf, levelsFor, isOffBandDining } = await import('../api/_lib/budgetFit.ts');

const names = (list) => list.map((c) => c.name).join(',');
let failed = 0;
const check = (label, got, expected) => {
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got:      ${got}\n      expected: ${expected}`);
};

const cheap  = { name: 'cheap',  priceLevel: 'PRICE_LEVEL_INEXPENSIVE' };
const mid    = { name: 'mid',    priceLevel: 'PRICE_LEVEL_MODERATE' };
const posh   = { name: 'posh',   priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE' };
const silent = { name: 'silent', priceLevel: null };

check('luxury puts the expensive place first',
  names(sortByBudgetFit([cheap, silent, posh], 'Luxury')), 'posh,silent,cheap');

check('economy puts the cheap place first',
  names(sortByBudgetFit([posh, silent, cheap], 'Economy')), 'cheap,silent,posh');

check('unpriced beats off-band, never the reverse',
  names(sortByBudgetFit([posh, silent], 'Economy')), 'silent,posh');

check('quality order survives inside a rank',
  names(sortByBudgetFit([mid, cheap], 'Economy')), 'mid,cheap');

check('unknown band leaves the list alone',
  names(sortByBudgetFit([posh, cheap], 'Whatever')), 'posh,cheap');

check('missing band leaves the list alone',
  names(sortByBudgetFit([posh, cheap], null)), 'posh,cheap');

check('numeric priceLevel is read too', String(priceLevelOf({ priceLevel: 3 })), '3');
check('absent priceLevel reads null', String(priceLevelOf({})), 'null');
check('band lookup is case-insensitive', String(levelsFor('  LUXURY ')), '3,4');

// Fine dining on a band that did not ask for it. The case: "Sukiyabashi Jiro
// Roppongi Hills Restaurant" landing as lunch on a Standard trip with no
// priceLevel on the record for the ranking above to act on.
const jiro = 'Sukiyabashi Jiro Roppongi Hills Restaurant Branch of the legendary three-Michelin-starred sushi restaurant offering an intimate omakase experience';
check('Michelin lunch is off band on Standard', String(isOffBandDining(jiro, 'Standard')), 'true');
check('same place is fine on Luxury', String(isOffBandDining(jiro, 'Luxury')), 'false');
check('omakase counter is off band on Economy', String(isOffBandDining('Sushi Saito omakase counter', 'Economy')), 'true');
check('an ordinary ramen bar is not', String(isOffBandDining('ICHIRAN Shibuya, a tonkotsu ramen counter', 'Standard')), 'false');
check('unknown band changes nothing', String(isOffBandDining(jiro, null)), 'false');

console.log(failed === 0 ? '\nAll 14 passed.' : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
