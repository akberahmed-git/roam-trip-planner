// One-off script: regenerates the bundled Tokyo demo trip and bakes its photos
// into /public/demo/tokyo as static files.
//
// Run against a deployment that already has the current pipeline on it:
//   node scripts/reseed-tokyo-demo.js https://<your-preview>.vercel.app
//
// Preview deployments sit behind Vercel Authentication, so an unauthenticated
// request gets a 401 with {"error":{"code":"401","message":"Protected
// deployment"}} rather than an itinerary. Pass the project's automation bypass
// secret (Vercel > Project > Settings > Deployment Protection > Protection
// Bypass for Automation) and every request here carries it:
//
//   VERCEL_AUTOMATION_BYPASS_SECRET=... node scripts/reseed-tokyo-demo.js <url>
//
// Not needed when running against production, which is not protected.
//
// Talks to the deployed API over HTTP rather than importing the pipeline
// directly. That is not a shortcut - it is the only thing that works. The
// api/ modules are TypeScript that import each other with .js specifiers,
// which resolves under Vercel's bundler but not under plain Node's ESM
// resolver, so `import ... from '../api/_lib/generateRawItinerary.js'` fails
// with ERR_MODULE_NOT_FOUND. (scripts/seed-interest-cache.js has the same
// problem and would fail the same way; it predates the TypeScript migration.)
//
// Going over HTTP also has two real advantages: no API keys are needed
// locally, since the deployment holds them, and the demo ends up being a
// genuine output of the code that is actually deployed rather than of
// whatever happens to be checked out.
//
// Two problems this fixes, both of which only show on the demo card because it
// is the one itinerary in the app that is frozen rather than generated fresh.
//
// 1. Its photos were stored as /api/place-photo?ref=... URLs. A Google photo
//    reference is not permanent, and every one of the 34 in the old fixture had
//    gone stale - all ten requests a page load makes returned 502, so the first
//    thing a new visitor saw on the home screen was a grid of broken images.
//    Re-fetching at render would fix it once, rot again, and bill a Place
//    Details Photos call every time. Downloading once and serving from /public
//    is what trendingLocations.js already does for the Home carousel, for
//    exactly the same reasons: free, instant, and it cannot expire.
//
// 2. The fixture predates every correctness fix in the pipeline - the
//    unresolved-stop drop, server-composed categoryTag, description
//    sanitisation, the finer travel grid.
//
// Costs one real generation (one Claude call, a Places lookup per stop, a
// Routes call per leg) and counts against the daily rate limit, so run it when
// the pipeline has changed, not casually.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO_DIR = path.join(ROOT, 'public', 'demo', 'tokyo');
const PUBLIC_PREFIX = '/demo/tokyo';
const FIXTURE_PATH = path.join(ROOT, 'src', 'data', 'savedTrips', 'tokyo.ts');
const DEMO_TRIPS_PATH = path.join(ROOT, 'src', 'data', 'demoTrips.ts');

const BASE_URL = (process.argv[2] || '').replace(/\/$/, '');
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

// x-vercel-set-bypass-cookie is left off deliberately: this is a one-shot
// script, not a browser session, so there is no reason to have the deployment
// hand back a cookie that would keep the bypass alive beyond this run.
function requestHeaders(extra = {}) {
  return BYPASS_SECRET
    ? { ...extra, 'x-vercel-protection-bypass': BYPASS_SECRET }
    : extra;
}

const HOTEL_NAME = 'Hotel Chinzanso Tokyo';

// Must match DEMO_TRIPS[0] in src/data/demoTrips.js, otherwise the card's
// subtitle would advertise a trip the fixture doesn't contain.
const TRIP = {
  destination: 'Tokyo',
  days: 2,
  budget: 'Standard',
  accommodation: HOTEL_NAME,
  interests: ['Temples & Shrines', 'Anime & Pop Culture', 'Nightlife', 'Modern Architecture'],
  adults: 2,
  transport: 'Car or taxi',
  // Dates only matter for the hotel lookup below; the itinerary itself is
  // date-agnostic (the card's subtitle says "Feb 2026", written in demoTrips.js).
  checkInDate: '2026-02-14',
  checkOutDate: '2026-02-16',
};


// The accommodation is fetched rather than hardcoded, for the same reason the
// itinerary is regenerated rather than hand-patched: a hardcoded photoUrl is a
// Google photo reference, and those expire. Going through the real
// accommodation endpoint gives a fresh reference that this script then bakes
// into /public alongside the rest.
//
// A previous version of this script passed photoUrl: null here, which quietly
// left all eight accommodation bookend stops (two a day, two variants) with no
// image at all and left demoTrips.js pointing at the same dead reference the
// whole re-seed exists to remove.
async function fetchAccommodation() {
  const response = await fetch(`${BASE_URL}/api/accommodation-options`, {
    method: 'POST',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      destination: TRIP.destination,
      checkInDate: TRIP.checkInDate,
      checkOutDate: TRIP.checkOutDate,
    }),
  });

  if (!response.ok) {
    throw new Error(`Accommodation lookup failed (${response.status})`);
  }

  const { options, priceRangeByTier, destinationCurrency } = await response.json();
  const tiered = options?.[TRIP.budget] || [];
  const match =
    tiered.find((option) => option.name === HOTEL_NAME) ||
    Object.values(options || {})
      .flat()
      .find((option) => option.name === HOTEL_NAME) ||
    tiered[0];

  if (!match) {
    throw new Error(`Could not find an accommodation option for ${TRIP.destination}`);
  }

  if (match.name !== HOTEL_NAME) {
    console.warn(
      `  ! ${HOTEL_NAME} was not in the results; using ${match.name} instead. ` +
        'Update demoTrips.js accommodation/subtitle to match.'
    );
  }

  return {
    ...match,
    budget: TRIP.budget,
    nights: 2,
    priceRange: priceRangeByTier?.[TRIP.budget] || null,
    destinationCurrency,
  };
}

// The deployment's own photo proxy already holds the API key, so this needs
// no credentials locally - it just pulls the bytes the browser would.
async function downloadPhoto(photoUrl, filename) {
  const response = await fetch(BASE_URL + photoUrl, { headers: requestHeaders() });
  if (!response.ok) {
    console.warn(`  ! photo fetch failed (${response.status}) for ${filename}`);
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(PHOTO_DIR, filename), buffer);
  return `${PUBLIC_PREFIX}/${filename}`;
}

// A stable, readable filename per place. Two stops resolving to the same place
// (the accommodation bookends every day) share one file rather than being
// downloaded twice.
function slugFor(name, index) {
  const slug = String(name || 'place')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${String(index).padStart(2, '0')}-${slug || 'place'}.jpg`;
}

async function bakePhotos(itinerary) {
  await mkdir(PHOTO_DIR, { recursive: true });

  const seen = new Map();
  let index = 0;
  let downloaded = 0;
  let missing = 0;

  for (const variant of ['packed', 'slow']) {
    for (const day of itinerary[variant]?.days || []) {
      for (const item of day.items) {
        if (typeof item.photoUrl !== 'string' || !item.photoUrl.startsWith('/api/place-photo')) {
          if (!item.photoUrl) missing += 1;
          continue;
        }
        if (seen.has(item.photoUrl)) {
          item.photoUrl = seen.get(item.photoUrl);
          continue;
        }
        const original = item.photoUrl;
        index += 1;
        const localUrl = await downloadPhoto(original, slugFor(item.name, index));
        if (localUrl) {
          seen.set(original, localUrl);
          item.photoUrl = localUrl;
          downloaded += 1;
        } else {
          item.photoUrl = null;
          missing += 1;
        }
      }
    }
  }

  return { downloaded, missing };
}

function serialiseFixture(itinerary) {
  return `import type { ResolvedItinerary } from '../../types'

// Generated by scripts/reseed-tokyo-demo.js - do not hand-edit. Re-run that
// script instead, so the demo stays a real output of the current pipeline
// rather than a snapshot that silently drifts away from it.
//
// Photos are local files under /public/demo/tokyo, not Google photo
// references: a reference expires and takes the whole demo card down with it.
export const TOKYO_2_DAYS: ResolvedItinerary = ${JSON.stringify(itinerary, null, 2)}
`;
}

async function main() {
  if (!BASE_URL || !/^https?:\/\//.test(BASE_URL)) {
    throw new Error(
      'Pass the deployment URL:\n  node scripts/reseed-tokyo-demo.js https://<your-preview>.vercel.app'
    );
  }

  console.log('Looking up the accommodation ...');
  const accommodationDetails = await fetchAccommodation();
  console.log(`  ${accommodationDetails.name} - ${accommodationDetails.categoryTag}`);

  console.log(`Generating Tokyo demo via ${BASE_URL} ...`);
  const response = await fetch(`${BASE_URL}/api/generate-resolved-itinerary`, {
    method: 'POST',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...TRIP, accommodationDetails }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 && !BYPASS_SECRET) {
      throw new Error(
        'Generation failed (401): this deployment is behind Vercel Authentication.\n' +
          'Get the secret from Vercel > Settings > Deployment Protection > Protection Bypass\n' +
          'for Automation, then re-run as:\n' +
          '  VERCEL_AUTOMATION_BYPASS_SECRET=... node scripts/reseed-tokyo-demo.js ' +
          BASE_URL
      );
    }
    throw new Error(`Generation failed (${response.status}): ${body.slice(0, 400)}`);
  }

  const itinerary = await response.json();

  for (const variant of ['packed', 'slow']) {
    for (const day of itinerary[variant]?.days || []) {
      const unresolved = day.items.filter((item) => !item.location);
      if (unresolved.length > 0) {
        console.warn(
          `  ! ${variant} day ${day.day}: ${unresolved.length} stop(s) with no location: ` +
            unresolved.map((item) => item.name).join(', ')
        );
      }
    }
  }

  console.log('Baking photos into public/demo/tokyo ...');
  const { downloaded, missing } = await bakePhotos(itinerary);
  console.log(`  ${downloaded} photo(s) saved, ${missing} stop(s) with no photo`);

  await writeFile(FIXTURE_PATH, serialiseFixture(itinerary), 'utf-8');
  console.log(`Wrote ${path.relative(ROOT, FIXTURE_PATH)}`);

  // The accommodation card on Finalise reads from demoTrips.js, not from the
  // itinerary, so it needs the same treatment or the hotel alone stays broken.
  const hotel = itinerary.packed?.days?.[0]?.items?.find((item) => item.type === 'accommodation');
  if (hotel?.photoUrl?.startsWith(PUBLIC_PREFIX)) {
    const source = await readFile(DEMO_TRIPS_PATH, 'utf-8');
    const updated = source.replace(/photoUrl: '[^']*'/, `photoUrl: '${hotel.photoUrl}'`);
    if (updated !== source) {
      await writeFile(DEMO_TRIPS_PATH, updated, 'utf-8');
      console.log(`Updated accommodation photoUrl in ${path.relative(ROOT, DEMO_TRIPS_PATH)}`);
    }
  }

  console.log('\nDone. Commit public/demo/tokyo/, tokyo.ts and demoTrips.ts together.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
