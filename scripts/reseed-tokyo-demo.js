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
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO_DIR = path.join(ROOT, 'public', 'demo', 'tokyo');
const PUBLIC_PREFIX = '/demo/tokyo';
const FIXTURE_PATH = path.join(ROOT, 'src', 'data', 'savedTrips', 'tokyo.ts');

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

// Any stop that resolved to a real place but has no Google photo - the
// substituted meals, which skip the billable photo fetch by design - gets a
// small map of where it is instead. The demo is the app's shop window, and a
// grey placeholder illustration there reads as broken; a map of the block the
// restaurant is on is honest, useful, and free from the existing static-map
// endpoint.
async function bakeMapFallbacks(itinerary) {
  let filled = 0;

  for (const variant of ['packed', 'slow']) {
    for (const day of itinerary[variant]?.days || []) {
      for (const item of day.items) {
        if (item.photoUrl || !item.location) continue;
        const filename = `map-${slugFor(item.name, ++mapIndex)}`;
        const points = `1:${item.location.lat},${item.location.lng}`;
        const localUrl = await downloadPhoto(
          `/api/static-map?points=${encodeURIComponent(points)}`,
          filename
        );
        if (localUrl) {
          item.photoUrl = localUrl;
          filled += 1;
        }
      }
    }
  }

  return filled;
}

let mapIndex = 0;

function serialiseFixture(itinerary, accommodation) {
  return `import type { ResolvedItinerary } from '../../types'

// Generated by scripts/reseed-tokyo-demo.js - do not hand-edit. Re-run that
// script instead, so the demo stays a real output of the current pipeline
// rather than a snapshot that silently drifts away from it.
//
// Photos are local files under /public/demo/tokyo, not Google photo
// references: a reference expires and takes the whole demo card down with it.
export const TOKYO_2_DAYS: ResolvedItinerary = ${JSON.stringify(itinerary, null, 2)}

// The accommodation the demo was generated against. demoTrips.js imports this
// rather than keeping its own copy, so the card, the Finalise screen and the
// itinerary's bookend stops can never disagree about which hotel this is.
export const TOKYO_ACCOMMODATION = ${JSON.stringify(accommodation, null, 2)}
`;
}

// The demo is the only itinerary most visitors will ever see, and it is bundled
// rather than generated, so a bad draft would sit on the home screen until
// someone noticed. A previous re-seed shipped a "Slow" day 1 that was hotel,
// restaurant, another restaurant 700 m away, hotel, ending at 15:25 with no
// dinner and no activity at all, and it stayed there (Akber, 4 Sep 2026).
//
// So the script now refuses to write a fixture it would not defend. Every check
// here is one a visitor could notice unaided.
// A day that never leaves one pocket is not a day out, and a day spent crossing
// the city is not one either. These bound both ends. Generous on purpose: the
// re-seed costs a real generation each time it runs, so the audit should catch
// the genuinely bad drafts, not bicker with the merely imperfect ones.
const MIN_DAY_SPREAD_KM = 2.5;
const MAX_DAY_SPREAD_KM = 30;

// Backtracking. A day that runs Akihabara -> Shibuya -> back past Akihabara to
// the Imperial Palace -> back west again to Shinjuku covers plenty of ground
// and is still wrong: 20 km walked to cover 7.7 km of city, with a 178-degree
// turn in the middle. Only long legs count, since a couple of hundred metres in
// the "wrong" direction between two neighbouring stops is meaningless.
const LONG_LEG_KM = 3;
const REVERSAL_DEGREES = 120;

function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleBetween(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

// Returns a description of each place the day doubles back on itself.
function findBacktracking(stops) {
  const pts = stops.filter((s) => s.location && s.location.lat != null);
  if (pts.length < 3) return [];
  const legs = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const km = haversineKm(pts[k].location, pts[k + 1].location);
    if (km >= LONG_LEG_KM) {
      legs.push({ km, deg: bearing(pts[k].location, pts[k + 1].location), from: pts[k].name, to: pts[k + 1].name });
    }
  }
  const found = [];
  for (let k = 0; k < legs.length - 1; k++) {
    const turn = angleBetween(legs[k].deg, legs[k + 1].deg);
    if (turn > REVERSAL_DEGREES) {
      found.push(
        `${legs[k].from} to ${legs[k].to} (${legs[k].km.toFixed(1)} km) then doubles back ` +
          `${legs[k + 1].from} to ${legs[k + 1].to} (${legs[k + 1].km.toFixed(1)} km), a ${Math.round(turn)}° turn`
      );
    }
  }
  return found;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function auditDemo(itinerary) {
  const problems = [];
  const dayHoods = [];
  const wantedInterests = TRIP.interests.map((i) => i.toLowerCase());
  const seenInterestText = [];

  for (const variant of ['packed', 'slow']) {
    const days = itinerary[variant]?.days || [];
    if (days.length !== TRIP.days) {
      problems.push(`${variant}: expected ${TRIP.days} days, got ${days.length}`);
    }

    const districts = [];

    for (const day of days) {
      const items = day.items || [];
      const activities = items.filter((i) => i.type !== 'accommodation' && !i.mealType);
      const meals = items.filter((i) => i.mealType);
      const label = `${variant} day ${day.day}`;

      if (activities.length < 2) {
        problems.push(`${label}: only ${activities.length} activity stop(s), a day of meals is not an itinerary`);
      }
      if (!meals.some((m) => m.mealType === 'dinner')) {
        problems.push(`${label}: no dinner`);
      }
      const last = items[items.length - 1];
      const endsAt = last && typeof last.startTime === 'string' ? last.startTime : null;
      if (endsAt && Number(endsAt.split(':')[0]) < 19) {
        problems.push(`${label}: day ends at ${endsAt}, far too early`);
      }
      const noPhoto = items.filter((i) => !i.photoUrl);
      if (noPhoto.length > 0) {
        problems.push(`${label}: ${noPhoto.length} stop(s) with no photo: ${noPhoto.map((i) => i.name).join(', ')}`);
      }

      for (const item of items) {
        seenInterestText.push(`${item.name} ${item.categoryTag || ''} ${item.description || ''}`.toLowerCase());
      }
      // Does the day actually move? Two measures, because either can be
      // missing: the neighbourhood half of categoryTag ("Museum · Roppongi"),
      // and the raw spread of the stops on the ground. A day where every
      // activity sits in one pocket is the thing this whole change is about.
      const hoods = new Set(
        activities
          .map((i) => (typeof i.categoryTag === 'string' && i.categoryTag.includes('·')
            ? i.categoryTag.split('·').pop().trim().toLowerCase()
            : null))
          .filter(Boolean)
      );
      const pts = activities.map((i) => i.location).filter((l) => l && l.lat != null);
      let spreadKm = 0;
      for (let a = 0; a < pts.length; a++) {
        for (let b = a + 1; b < pts.length; b++) {
          spreadKm = Math.max(spreadKm, haversineKm(pts[a], pts[b]));
        }
      }

      // Distance, not neighbourhood count, is the honest test. Three adjacent
      // Minato neighbourhoods spanning 2 km is nominally "three areas" and is
      // still the same pocket - that exact day is what prompted this work.
      if (pts.length >= 2 && spreadKm < MIN_DAY_SPREAD_KM) {
        problems.push(
          `${label}: activities span only ${spreadKm.toFixed(1)} km ` +
            `(${hoods.size} neighbourhood(s)) - the day orbits instead of travelling`
        );
      }
      if (spreadKm > MAX_DAY_SPREAD_KM) {
        problems.push(`${label}: stops are ${spreadKm.toFixed(1)} km apart, that is a day of commuting`);
      }

      // Order, not just spread: the stops can cover the whole city and still be
      // sequenced so the traveller crosses it three times.
      for (const hop of findBacktracking(items.filter((i) => i.type !== 'accommodation'))) {
        problems.push(`${label}: route doubles back - ${hop}`);
      }

      dayHoods.push(hoods);
      if (day.theme) districts.push(String(day.theme).toLowerCase());
    }

    if (new Set(districts).size < districts.length) {
      problems.push(`${variant}: two days share the same theme, so the trip circles one idea`);
    }
    for (let a = 0; a < dayHoods.length; a++) {
      for (let b = a + 1; b < dayHoods.length; b++) {
        const shared = [...dayHoods[a]].filter((h) => dayHoods[b].has(h));
        if (dayHoods[a].size > 0 && shared.length === dayHoods[a].size) {
          problems.push(`${variant}: days ${a + 1} and ${b + 1} cover the same neighbourhoods`);
        }
      }
    }
  }

  // Interest coverage, checked with the words a person would actually look for
  // rather than the chip's exact label, since no place is literally called
  // "Temples & Shrines".
  const INTEREST_EVIDENCE = {
    'temples & shrines': ['temple', 'shrine', 'jinja', 'ji ', '-ji', 'taisha'],
    'anime & pop culture': ['anime', 'manga', 'akihabara', 'game', 'pop culture', 'figure'],
    nightlife: ['bar', 'club', 'nightlife', 'izakaya', 'golden-gai', 'live music'],
    'modern architecture': ['architecture', 'tower', 'skytree', 'observation', 'museum', 'gallery', 'hills', 'midtown'],
  };
  const haystack = seenInterestText.join(' | ');
  for (const interest of wantedInterests) {
    const evidence = INTEREST_EVIDENCE[interest];
    if (!evidence) continue;
    if (!evidence.some((word) => haystack.includes(word))) {
      problems.push(`interest "${interest}" appears nowhere in the trip`);
    }
  }

  return problems;
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

  const problems = auditDemo(itinerary);
  if (problems.length > 0) {
    console.error('\nThis generation is not good enough to ship as the demo:\n');
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(
      '\nNothing was written. The demo is the first thing every visitor sees, so a\n' +
        'weak generation must not silently replace a good one. Re-run to get a\n' +
        'different draft, or fix the pipeline if it keeps failing the same check.'
    );
    process.exit(1);
  }
  console.log('\nAudit passed: every day has activities, a dinner, photos and its interests.');

  console.log('Baking photos into public/demo/tokyo ...');
  const { downloaded, missing } = await bakePhotos(itinerary);
  console.log(`  ${downloaded} photo(s) saved, ${missing} stop(s) with no photo`);

  const filled = await bakeMapFallbacks(itinerary);
  if (filled > 0) {
    console.log(`  ${filled} stop(s) given a map thumbnail instead of a placeholder`);
  }

  const hotelPhoto =
    itinerary.packed?.days?.[0]?.items?.find((item) => item.type === 'accommodation')?.photoUrl ||
    null;

  await writeFile(
    FIXTURE_PATH,
    serialiseFixture(itinerary, { ...accommodationDetails, photoUrl: hotelPhoto }),
    'utf-8'
  );
  console.log(`Wrote ${path.relative(ROOT, FIXTURE_PATH)}`);

  console.log('\nDone. Commit public/demo/tokyo/ and tokyo.ts together.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
