// Unit test for the dash normalisation in api/_lib/sanitizeDescriptions.ts.
//
//   node scripts/test-dashes.js
//
// Claude writes em dashes into stop descriptions and one shipped in the Tokyo
// demo for weeks. The prompt now forbids them and the sanitiser strips whatever
// leaks; this checks the stripper does not also eat a numeric range, which is
// how "5-10 minutes" is recognised by the claim patterns it runs after.
import { spawnSync } from 'node:child_process';

const STRIP = '--experimental-strip-types';
if (!process.execArgv.includes(STRIP)) {
  const r = spawnSync(process.execPath, [STRIP, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  process.exit(r.status ?? 1);
}

const { normaliseDashes, stripUnverifiedClaims } = await import('../api/_lib/sanitizeDescriptions.ts');

const cases = [
  ['em dash between clauses',
   'Harajuku’s alley packed with costume shops—the heart of Tokyo’s pop culture retail.',
   'Harajuku’s alley packed with costume shops, the heart of Tokyo’s pop culture retail.'],
  ['spaced em dash',
   'A quiet garden — one of the oldest in the city.',
   'A quiet garden, one of the oldest in the city.'],
  ['en dash between words',
   'A shrine – rebuilt after the war.',
   'A shrine, rebuilt after the war.'],
  ['numeric range with en dash survives',
   'Open 5–10 minutes after sunrise.',
   'Open 5–10 minutes after sunrise.'],
  ['year range survives',
   'Built 1920–1935 by a single workshop.',
   'Built 1920–1935 by a single workshop.'],
  ['hyphens untouched',
   'A well-known family-run soba counter.',
   'A well-known family-run soba counter.'],
  ['no dashes passes through',
   'A covered market of tiny stalls and standing bars.',
   'A covered market of tiny stalls and standing bars.'],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const got = normaliseDashes(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got:      ${got}\n      expected: ${expected}`);
}

// The dash strip must not disturb the claim trimming it runs after.
const claim = stripUnverifiedClaims('A hilltop shrine — the oldest in the ward, a 15-minute walk from breakfast.');
const claimOk = !claim.text.includes('—') && !/15\s*-?\s*minute/.test(claim.text);
if (!claimOk) failed++;
console.log(`${claimOk ? 'PASS' : 'FAIL'}  dash strip and claim trim together`);
if (!claimOk) console.log(`      got: ${claim.text}`);

console.log(failed === 0 ? `\nAll ${cases.length + 1} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
