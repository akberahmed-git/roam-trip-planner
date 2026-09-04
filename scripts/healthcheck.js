// Checks that a deployment's API endpoints actually work, not just that Vercel
// says "Ready".
//
//   npm run health                          # production
//   npm run health -- <deployment url>      # a preview
//
// Why this exists: on 4 Sep 2026 production sat broken for over an hour with a
// green tick next to it. Editing an environment variable in Vercel had silently
// dropped the Production scope from both API keys, and later corrupted the
// Google key's value on save. Vercel reported the deployment healthy throughout,
// because the build had succeeded - it has no idea whether the functions can
// reach anything. It was found by accident.
//
// Every check here hits a real upstream through the app's own routes, so a
// missing key, a bad key value, a disabled Google API or an exhausted Anthropic
// balance all show up as a failure rather than as silence.
//
// Deliberately not part of the build. A build runs before a deployment exists;
// this has to run after one, and after any settings change - which is exactly
// the moment nothing else is watching.
const BASE = (process.argv[2] || 'https://roam.akberahmed.com').replace(/\/$/, '');
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

const headers = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};

// Each check names what breaks in the product when it fails, so a red line
// reads as a consequence rather than a route name.
const CHECKS = [
  {
    name: 'Trending carousel',
    detail: 'Home screen',
    run: async () => {
      const r = await fetch(`${BASE}/api/trending-locations`, { headers });
      if (!r.ok) return `HTTP ${r.status}`;
      const body = await r.json();
      // The route wraps the array: { locations: [...] } - see
      // api/trending-locations.js. Checked the same way Home.jsx reads it.
      const locations = body.locations;
      return Array.isArray(locations) && locations.length > 0
        ? null
        : 'no locations returned';
    },
  },
  {
    name: 'Destination search',
    detail: 'Google Places key',
    run: async () => {
      const r = await fetch(`${BASE}/api/place-autocomplete?input=Istanbul`, { headers });
      if (!r.ok) return `HTTP ${r.status} - ${(await r.text()).slice(0, 120)}`;
      const body = await r.json();
      const n = body.suggestions?.length || 0;
      return n > 0 ? null : 'no suggestions returned';
    },
  },
  {
    name: 'Interest chips',
    detail: 'Anthropic key',
    run: async () => {
      const r = await fetch(`${BASE}/api/interest-suggestions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'Istanbul, İstanbul, Türkiye' }),
      });
      if (!r.ok) return `HTTP ${r.status} - ${(await r.text()).slice(0, 120)}`;
      const body = await r.json();
      const n = body.interests?.length || body.suggestions?.length || 0;
      return n > 0 ? null : 'no interests returned';
    },
  },
  {
    name: 'Demo trip photos',
    detail: 'static files',
    run: async () => {
      const r = await fetch(`${BASE}/demo/tokyo/01-one-tokyo-by-insomnia.jpg`, { headers });
      if (!r.ok) return `HTTP ${r.status}`;
      const type = r.headers.get('content-type') || '';
      return type.startsWith('image/') ? null : `unexpected content-type ${type}`;
    },
  },
  {
    name: 'Plan a trip page',
    detail: '/plan redirect',
    run: async () => {
      const r = await fetch(`${BASE}/plan`, { headers });
      return r.ok ? null : `HTTP ${r.status}`;
    },
  },
];

// Generation is deliberately NOT checked. It costs a real Claude call plus a
// Places lookup per stop, so a health check that ran it would itself become a
// meaningful line on the bill - and every dependency it needs is already
// covered by the two key checks above.

async function main() {
  console.log(`\nChecking ${BASE}\n`);
  let failed = 0;
  let unreachableCount = 0;

  for (const check of CHECKS) {
    let problem;
    let unreachable = false;
    try {
      problem = await check.run();
    } catch (error) {
      problem = error.message;
      // A connection-level failure means this machine could not reach the host
      // at all - no DNS, no network, wrong URL. Tracked separately because the
      // conclusion is the opposite of a failed check: nothing has been learned
      // about the deployment, and reporting it as "production is broken" would
      // send someone to fix a site that is fine.
      unreachable = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(
        String(error.message)
      );
    }
    if (unreachable) unreachableCount += 1;
    const label = `${check.name} (${check.detail})`.padEnd(42);
    if (problem) {
      failed += 1;
      console.log(`  FAIL  ${label} ${problem}`);
    } else {
      console.log(`  ok    ${label}`);
    }
  }

  if (unreachableCount === CHECKS.length) {
    console.log(`\nCould not reach ${BASE} at all.`);
    console.log('Every check failed to connect, which points at this machine or');
    console.log('the URL rather than at the deployment. Check your network and');
    console.log('that the address is right, then run this again.\n');
    process.exit(2);
  }

  if (failed > 0) {
    console.log(`\n${failed} of ${CHECKS.length} checks failed.`);
    console.log('If the key checks failed, look at Vercel > Settings > Environment');
    console.log('Variables first: confirm each key reads "Production and Preview" AND');
    console.log('that its value is the full key, then redeploy.\n');
    process.exit(1);
  }

  console.log(`\nAll ${CHECKS.length} checks passed.\n`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
