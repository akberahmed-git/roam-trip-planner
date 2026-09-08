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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Re-exec under type stripping so the audit can import the REAL opening-hours
// module instead of reimplementing it. Same trick scripts/replay-schedule.js
// uses, and for the same reason: an audit that re-implements the code it is
// checking will agree with itself while production does something else.
// openingHours.ts is self-contained - no imports of its own - so it loads
// directly rather than needing the temp-directory dance replay-schedule does
// for the modules that import each other (Akber, 8 Sep 2026).
const STRIP = '--experimental-strip-types';
if (!process.execArgv.includes(STRIP)) {
  const result = spawnSync(process.execPath, [STRIP, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  process.exit(result.status ?? 1);
}

const { isOpenAt, weekdayForDay, closesAt } = await import('../api/_lib/openingHours.ts');
// Also self-contained, so it loads here too. The audit asks the same list the
// pipeline does rather than keeping its own.
const { isDeclinedPlace } = await import('../api/_lib/declinedPlaces.ts');
// The pipeline's own interest matcher, imported rather than reimplemented.
// This script used to carry its own keyword lists and they drifted: the
// pipeline counted a 1393 temple as modern architecture off its description
// while this file, matching names only, said nothing delivered it. Neither
// side was going to give way, and five re-seeds failed on the disagreement.
const { satisfiesInterest } = await import('../api/_lib/interestCoverage.ts');

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

// There is deliberately no HOTEL_NAME here any more.
//
// It used to say 'Mandarin Oriental, Tokyo' while TRIP.budget said Standard,
// and the lookup below reconciled the two by falling back to a scan of all
// three tiers. That fallback is what let the mismatch ship: the accommodation
// block bakes in priceRangeByTier[TRIP.budget], so the demo went out with the
// Standard tier's 15k-80k JPY estimate printed under a hotel the app's own
// Luxury tier prices at 120k-250k. A wrong price under a real hotel name is
// the one thing this app is built not to do, and a hand-picked name is what
// made it possible.
//
// The hotel is now whatever the chosen tier ranks first, which is the same
// hotel the Accommodation screen pre-selects for a traveller planning this
// exact trip. That is the property worth having: the demo cannot show a hotel
// nobody can find. It also means the demo hotel can change between re-seeds if
// Google's ratings move, which is correct - the alternative is a frozen name
// slowly drifting out of the live results with nothing to catch it.
// (Akber, 8 Sep 2026)

// Must match DEMO_TRIPS[0] in src/data/demoTrips.js, otherwise the card's
// subtitle would advertise a trip the fixture doesn't contain.
// The bar every stop in the demo has to clear, sent to the pipeline as
// minReviews so it accepts on exactly this number too. Declared here rather than
// beside the other audit constants because TRIP below needs it.
const MIN_REVIEWS_FOR_ANY_DEMO_STOP = 1000;

const TRIP = {
  destination: 'Tokyo',
  days: 2,
  budget: 'Standard',
  interests: ['Temples & Shrines', 'Anime & Pop Culture', 'Nightlife', 'Modern Architecture'],
  // Sent to the pipeline so it accepts on exactly the bar this script rejects
  // on. Without it every adopting pass accepted at 200 and this audit blocked at
  // 1,000, and the generations in that band could never converge.
  minReviews: MIN_REVIEWS_FOR_ANY_DEMO_STOP,
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

  // Top of the chosen tier, and nothing else. No cross-tier fallback on
  // purpose: if the tier the demo claims is empty, that is a real problem with
  // the hotel search worth stopping on, not something to paper over by
  // borrowing a hotel from a tier the demo does not advertise.
  const match = tiered[0];

  if (!match) {
    throw new Error(
      `No ${TRIP.budget} accommodation for ${TRIP.destination}. ` +
        'Fix the hotel search rather than re-pointing the demo at another tier.'
    );
  }

  console.log(`  hotel: ${match.name} (${TRIP.budget}, top of ${tiered.length} shown)`);

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
// "Packed & Varied" is meant to roam; "Slow & Immersive" is explicitly fewer
// stops with longer stays, so holding both to the same minimum punishes the slow
// variant for doing its job. It still has to move - a day inside 1.2 km is one
// street, not a neighbourhood - just not as far.
// The last day is a departure day: the traveller checks out and travels, and
// the pipeline trims its late stops for exactly that reason. Holding it to the
// same count as a full day deadlocked against that trim.
// Above this a stop has stopped being a visit. First set at 250, clear of the
// 240 a teamLab or a big museum can justify, which let a shrine ship with 3h45m
// against it and a shopping street with 3h15m. Neither is a visit; both are a
// block with too few stops handing its leftover minutes to whatever could hold
// most of them. 200 is above anything worth three hours and below anything that
// only got there by default (Akber, 8 Sep 2026).
// Read out of the pipeline source rather than copied. fixedSchedule.ts cannot be
// imported here - unlike openingHours.ts it has imports of its own, with .js
// specifiers plain Node will not resolve - but a number the audit and the
// pipeline each keep their own copy of is the most expensive bug shape in this
// project, and this at least fails loudly the moment they diverge.
const MAX_PLAUSIBLE_STAY_MINUTES = (() => {
  const source = readFileSync(new URL('../api/_lib/fixedSchedule.ts', import.meta.url), 'utf8');
  const found = source.match(/MAX_PLAUSIBLE_STAY_MINUTES = (\d+)/);
  if (!found) {
    throw new Error('MAX_PLAUSIBLE_STAY_MINUTES is gone from api/_lib/fixedSchedule.ts - the audit and the pipeline can no longer agree on it');
  }
  return Number(found[1]);
})();

const MIN_ACTIVITIES_PER_DAY = 3;
const MIN_ACTIVITIES_FINAL_DAY = 2;
// Raised: the goal is a day that crosses the city, not one that huddles.
const MIN_DAY_SPREAD_KM = { packed: 4, slow: 2 };
const MAX_DAY_SPREAD_KM = 30;

// Backtracking. A day that runs Akihabara -> Shibuya -> back past Akihabara to
// the Imperial Palace -> back west again to Shinjuku covers plenty of ground
// and is still wrong: 20 km walked to cover 7.7 km of city, with a 178-degree
// turn in the middle. Only long legs count, since a couple of hundred metres in
// the "wrong" direction between two neighbouring stops is meaningless.
// A day may legitimately finish after midnight (the prompt allows 02:00 when
// nightlife is among the interests), so any end time before 03:00 is read as a
// late finish rather than an early one.
const LATEST_WRAPPED_END_HOUR = 3;
const EARLIEST_ACCEPTABLE_END_HOUR = 19;

const MAX_KM_FROM_HOTEL = 15;
// See the prominence check for why these live here and not in the pipeline.
const MIN_WELL_KNOWN_REVIEWS = 5000;
const MIN_WELL_KNOWN_PER_DAY = 2;
// A floor under every activity, not just a count of the good ones. The
// prominence rule above asks for two well-known places a day and says nothing
// about the rest, so a day could clear it and still send someone to a marker
// stone for an afternoon. In a city the size of Tokyo anywhere worth an hour has
// four figures of reviews; this is a demo-only number for exactly that reason.
// Matches MAX_STOPS_PER_INTEREST_PER_DAY in generate-resolved-itinerary.ts,
// which is where the pipeline now repairs a day that breaks it. The audit is
// the backstop, not the enforcement: refusing a draft fifteen times taught it
// nothing, and the previous "more than half a day" rule was both looser and
// harder to reason about than a plain cap of one (Akber, 8 Sep 2026).
const MAX_STOPS_PER_INTEREST_PER_DAY = 1;
// Mirrors MAX_STOPS_PER_INTEREST_PER_PLAN in generate-resolved-itinerary.ts.
// Blocking here, because unlike the per-day balance target this is a flat rule
// the traveller stated (Akber, 8 Sep 2026).
const MAX_STOPS_PER_INTEREST_PER_PLAN = {
  'temples & shrines': 1,
};
const LONG_LEG_KM = 4;
const REVERSAL_DEGREES = 140;

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
  const notes = [];
  const dayHoods = [];
  const wantedInterests = TRIP.interests.map((i) => i.toLowerCase());
  const seenInterestText = { packed: [], slow: [] };

  for (const variant of ['packed', 'slow']) {
    // Reset per variant. These accumulated across BOTH plans, so the
    // neighbourhood check compared packed day 2 against slow day 1 and reported
    // it as "slow: days 2 and 3" - a rejection for an overlap between two plans
    // the traveller never sees together (Akber, 8 Sep 2026).
    dayHoods.length = 0;
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

      // Packed asks for 4-5 activities, Slow for 3-4. Three is the floor for
      // either: below that a day is three meals with something wedged between
      // them, which is what the Slow variant was shipping.
      const minActivities = day.day === TRIP.days ? MIN_ACTIVITIES_FINAL_DAY : MIN_ACTIVITIES_PER_DAY;
      if (activities.length < minActivities) {
        problems.push(
          `${label}: only ${activities.length} activity stop(s), under the ${minActivities} minimum - ` +
            `a day of meals is not an itinerary`
        );
      }
      if (!meals.some((m) => m.mealType === 'dinner')) {
        problems.push(`${label}: no dinner`);
      }

      // A block with more time than the stops inside it can hold gives the
      // leftover to whichever stop can absorb most of it, so the timeline never
      // shows a hole. With a single stop in the block that dump is unbounded,
      // and a gallery shipped with four hours and forty-five minutes against it.
      // The cure is the generator handing that block another stop; this is here
      // so a draft where it failed to cannot reach anybody.
      // A travel leg nobody could believe. Advisory, deliberately: the pipeline
      // no longer fabricates these (an empty block used to have its whole dead
      // span written into its leg, which is how a 11.8 km hop became a "330
      // minute drive"), and I am not adding another blocking check tonight
      // without a repair standing behind it. It is here so the next one is
      // visible in the output rather than shipping to a traveller's timeline.
      const crawls = items
        .map((i) => ({ name: i.name, minutes: Number(String(i.travelToNext || '').match(/(\d+)\s*minute/)?.[1] || 0) }))
        .filter((leg) => leg.minutes > 90);
      if (crawls.length > 0) {
        notes.push(
          `${label}: ` + crawls.map((l) => `${l.minutes} minute leg after ${l.name}`).join(', ') + ' - check the routing'
        );
      }

      const marathon = activities.filter((i) => (i.durationMinutes || 0) > MAX_PLAUSIBLE_STAY_MINUTES);
      if (marathon.length > 0) {
        problems.push(
          `${label}: ` +
            marathon
              .map((i) => `${i.name} runs ${Math.floor(i.durationMinutes / 60)}h ${i.durationMinutes % 60}m`)
              .join(', ') +
            `, so that block needs another stop rather than a longer one`
        );
      }
      // A day that finishes at 00:05 has run LATE, not early - with nightlife
      // among the interests the prompt allows up to 02:00, so the clock wraps.
      // Reading the bare hour called those days too early and rejected two
      // perfectly good ones (Akber, 4 Sep 2026).
      const last = items[items.length - 1];
      const endsAt = last && typeof last.startTime === 'string' ? last.startTime : null;
      if (endsAt) {
        const endHour = Number(endsAt.split(':')[0]);
        const ranPastMidnight = endHour < LATEST_WRAPPED_END_HOUR;
        const isFinalDay = day.day === TRIP.days;
        if (!ranPastMidnight && endHour < EARLIEST_ACCEPTABLE_END_HOUR) {
          problems.push(`${label}: day ends at ${endsAt}, far too early`);
        }
        // The last night ends at a normal hour whatever the interests say -
        // the traveller checks out and travels the next morning.
        if (isFinalDay && ranPastMidnight) {
          problems.push(
            `${label}: last day runs to ${endsAt}, but the final night should end at the standard time`
          );
        }
      }
      // Blocking. Akber has asked for Tokyo Tower to be gone three times and it
      // has shipped three times; the pipeline now refuses it in every adoption
      // path and drops it from the model's draft, and this is the backstop.
      const declined = items.filter((i) => isDeclinedPlace(i.name));
      if (declined.length > 0) {
        problems.push(
          `${label}: ${declined.map((i) => i.name).join(', ')} - the traveller asked for this to be left out`
        );
      }

      const noPhoto = items.filter((i) => !i.photoUrl);
      if (noPhoto.length > 0) {
        problems.push(`${label}: ${noPhoto.length} stop(s) with no photo: ${noPhoto.map((i) => i.name).join(', ')}`);
      }

      for (const item of items) {
        // Per stop and per variant, not one merged blob for the whole trip.
        // Merged, a single incidental word anywhere cleared an interest for
        // both plans at once.
        seenInterestText[variant].push({
          name: item.name || '',
          categoryTag: item.categoryTag || '',
          description: item.description || '',
          placeTypes: item.placeTypes || null,
          day: day.day,
          isActivity: !item.mealType && item.type !== 'accommodation',
        });
      }

      // Prominence, which the prompt has asked for all along and nothing has
      // ever checked: "A day should contain at least two places the city is
      // genuinely known for."
      //
      // Review count is the only measure available that separates a landmark
      // from a plaque, and 5,000 is calibrated for Tokyo, where the real sights
      // run from ten thousand to a hundred thousand. It lives in this script
      // rather than in the pipeline for exactly that reason: an absolute number
      // is honest for a demo that is always Tokyo and would be nonsense for a
      // town where nothing clears a thousand. Generalising it needs a measure
      // relative to what the destination actually offers (Akber, 8 Sep 2026).
      const known = activities.filter(
        (i) => typeof i.ratingCount === 'number' && i.ratingCount >= MIN_WELL_KNOWN_REVIEWS
      );
      // Meals included. A restaurant nobody has heard of is the same problem as
      // an attraction nobody has heard of, and the demo shipped a 491-review
      // dinner because this line only ever looked at activities.
      const obscure = items.filter(
        (i) =>
          i.type !== 'accommodation' &&
          typeof i.ratingCount === 'number' &&
          i.ratingCount < MIN_REVIEWS_FOR_ANY_DEMO_STOP
      );
      if (obscure.length > 0) {
        problems.push(
          `${label}: ${obscure.map((i) => `${i.name} (${i.ratingCount} reviews)`).join(', ')} ` +
            `- too obscure for the demo, under ${MIN_REVIEWS_FOR_ANY_DEMO_STOP.toLocaleString()}`
        );
      }
      // Advisory. This asks for two places the city is famous for, and the
      // one-stop-per-interest cap asks that no interest dominate. In Tokyo the
      // famous places overwhelmingly ARE shrines, so the two rules pull in
      // opposite directions and a day cannot satisfy both. The floor under every
      // activity below is what actually keeps the quality up (Akber, 8 Sep 2026).
      if (activities.length > 0 && known.length < MIN_WELL_KNOWN_PER_DAY) {
        notes.push(
          `${label}: only ${known.length} of ${activities.length} activities are places Tokyo is known for ` +
            `(${MIN_WELL_KNOWN_REVIEWS.toLocaleString()}+ reviews), needs ${MIN_WELL_KNOWN_PER_DAY}`
        );
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
      // Advisory, not blocking. How far a day should spread is a judgement, and
      // the number is a guess - a slow day 1.1 km across was rejected against a
      // 1.2 km minimum invented an hour earlier, costing a real generation to
      // find out (Akber, 4 Sep 2026). The failure this was meant to catch, a day
      // of two restaurants and nothing else, is already caught by the activity
      // count, so blocking on distance too was redundant as well as arbitrary.
      const minSpread = MIN_DAY_SPREAD_KM[variant] ?? 2.5;
      if (pts.length >= 2 && spreadKm < minSpread) {
        notes.push(
          `${label}: activities span ${spreadKm.toFixed(1)} km, under the ${minSpread} km ` +
            `guide for ${variant} (${hoods.size} neighbourhood(s)) - a tight day, worth a look`
        );
      }
      if (spreadKm > MAX_DAY_SPREAD_KM) {
        problems.push(`${label}: stops are ${spreadKm.toFixed(1)} km apart, that is a day of commuting`);
      }

      // A stop far from the hotel ruins a day by selection, not by sequence:
      // every day starts and ends at the accommodation, so a stop 22km out
      // forces the journey twice and no reordering can help. Measured from the
      // hotel, which never moves, rather than from the day's own centre.
      const hotel = (items.find((i) => i.type === 'accommodation') || {}).location;
      if (hotel) {
        for (const item of items) {
          if (item.type === 'accommodation' || !item.location) continue;
          const out = haversineKm(hotel, item.location);
          if (out > MAX_KM_FROM_HOTEL) {
            problems.push(`${label}: ${item.name} is ${out.toFixed(1)} km from the hotel, too far out to belong in a day`);
          }
        }
      }

      // Order, not just spread: the stops can cover the whole city and still be
      // sequenced so the traveller crosses it three times.
      for (const hop of findBacktracking(items.filter((i) => i.type !== 'accommodation'))) {
        problems.push(`${label}: route doubles back - ${hop}`);
      }

      // Opening hours, checked here as well as in the pipeline, because the
      // pipeline's check kept ending up in the wrong place. It ran inside the
      // scheduling loop under a comment saying every stop was now on the time it
      // would ship with, and then two more passes were added after it that move
      // stops. Yasukuni Shrine, which Google says shuts at 6pm, passed this
      // audit at 23:20 with two and a half hours against it - in an app whose
      // headline claim is that it checks opening hours.
      //
      // unsuitableStops would have caught it; nothing asked it. So the audit
      // asks, using the same isOpenAt the pipeline uses rather than a second
      // opinion that could drift from it. Unknown hours stay open, exactly as
      // the pipeline treats them: silence is not evidence (Akber, 8 Sep 2026).
      const weekdayIndex = weekdayForDay(TRIP.checkInDate, day.day);
      for (const item of items) {
        if (item.type === 'accommodation' || !item.startTime || !item.weekdayDescriptions) continue;
        const [h, m] = String(item.startTime).split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        if (isOpenAt(item.weekdayDescriptions, weekdayIndex, h * 60 + m) === false) {
          problems.push(`${label}: ${item.name} is scheduled at ${item.startTime} and is closed then`);
          continue;
        }
        // Open at the hour it starts is not the same as open until the traveller
        // leaves. The shipped demo sat a two-hour dinner at Sukiyabashi Jiro from
        // 20:00 against a 21:00 close and this audit passed it, because nothing
        // asked about the end (Akber, 8 Sep 2026).
        const closing = closesAt(item.weekdayDescriptions, weekdayIndex);
        const ends = h * 60 + m + (item.durationMinutes || 0);
        if (closing != null && ends > closing + 15) {
          const hh = String(Math.floor(closing / 60) % 24).padStart(2, '0');
          const mm = String(closing % 60).padStart(2, '0');
          problems.push(
            `${label}: ${item.name} runs to ${String(Math.floor(ends / 60) % 24).padStart(2, '0')}:` +
              `${String(ends % 60).padStart(2, '0')} but closes at ${hh}:${mm}`
          );
        }
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
  // Keyword matching is a blunt instrument and it has already been wrong once:
  // a trip containing the Ghibli Museum was rejected for having no anime in it,
  // because "Ghibli" was not on the list (Akber, 4 Sep 2026). Err towards
  // accepting - a false rejection costs a whole real generation, while a false
  // acceptance costs a look at the output, which happens anyway.
  //
  // Three things were wrong with how this used to run.
  //
  // It matched against ONE string holding every stop of both plans, so a single
  // incidental word cleared an interest for the whole trip. "AFURI Harajuku", a
  // ramen shop, satisfied Anime & Pop Culture because harajuku was on the list.
  //
  // It matched substrings, so "bar" was inside Barbecue and Barista.
  //
  // And it asked the question once for the trip rather than once per plan, so a
  // traveller could pick the option that delivered none of what they asked for
  // and the audit would have passed it. The chips are the promise; each plan has
  // to keep it on its own.
  //
  // The evidence lists lost the words that were matching things they did not
  // mean: harajuku and takeshita are neighbourhoods rather than anime venues,
  // game and character are too generic to mean anything, golden only meant Golden
  // Gai, and a museum or a gallery is not modern architecture however good the
  // building is (Akber, 8 Sep 2026).
  // Interest coverage and balance, both answered by the pipeline's own
  // satisfiesInterest so the audit and the generator cannot disagree about what
  // a chip means.
  const matchesInterest = (entry, interest) =>
    satisfiesInterest(
      { type: 'activity', name: entry.name, categoryTag: entry.categoryTag, description: entry.description, placeTypes: entry.placeTypes },
      interest
    );

  for (const variant of ['packed', 'slow']) {
    const days = [...new Set(seenInterestText[variant].map((entry) => entry.day))];
    for (const dayNumber of days) {
      const activities = seenInterestText[variant].filter(
        (entry) => entry.day === dayNumber && entry.isActivity
      );
      // Four is the floor, not three. On a three-activity day, two stops sharing
      // an interest is a themed afternoon, which is the thing the chips are for
      // - a day of Akihabara, Super Potato and teamLab is exactly what someone
      // picking Anime & Pop Culture wants, and rejecting it would be the audit
      // arguing with the traveller.
      for (const interest of wantedInterests) {
        const count = activities.filter((entry) => matchesInterest(entry, interest)).length;
        // Advisory until the pipeline repair has proved it can hit this. The cap
        // is enforced in generate-resolved-itinerary.ts, where a surplus stop is
        // swapped for one serving an under-used interest; when that swap cannot
        // find a replacement the day stays over cap, and blocking here turns a
        // partial improvement into a thrown-away generation. Fifteen have gone
        // that way. The pipeline still pushes every day toward the cap, which is
        // what the traveller actually feels (Akber, 8 Sep 2026).
        // Two of one interest in a day is a themed afternoon and stays advisory.
        // Three is the planner running out of ideas - "Akihabara Gamers, JUMP
        // SHOP, Animate Akihabara" in a row - and blocks. The pipeline now drops
        // a per-day surplus it cannot swap when the day can spare it, and the
        // fill pass no longer buys an interest the day is already at cap for,
        // so this is a bar it can actually reach (Akber, 8 Sep 2026).
        if (count >= MAX_STOPS_PER_INTEREST_PER_DAY + 2) {
          problems.push(
            `${variant} day ${dayNumber}: ${count} activities are "${interest}" in one day ` +
              `(${activities.filter((e) => matchesInterest(e, interest)).map((e) => e.name).join(', ')}) - that is a rut, not a theme`
          );
        } else if (count > MAX_STOPS_PER_INTEREST_PER_DAY) {
          notes.push(
            `${variant} day ${dayNumber}: ${count} activities are "${interest}", the cap is ` +
              `${MAX_STOPS_PER_INTEREST_PER_DAY} a day`
          );
        }
      }

      // A stop serving none of the four chips, in a day that is missing one of
      // them. Advisory: the pipeline swaps these out, and the swap depends on
      // Google having something suitable nearby.
      const uncovered = wantedInterests.filter(
        (interest) => !activities.some((entry) => matchesInterest(entry, interest))
      );
      const serveNothing = activities.filter(
        (entry) => !wantedInterests.some((interest) => matchesInterest(entry, interest))
      );
      if (uncovered.length > 0 && serveNothing.length > 0) {
        notes.push(
          `${variant} day ${dayNumber}: ${serveNothing.map((e) => e.name).join(', ')} serve none of the chips ` +
            `while the day has no "${uncovered.join('" or "')}"`
        );
      }
    }
  }

  // Blocking, unlike the per-day cap above. Akber asked for this one twice and
  // in plain words: one shrine per itinerary when that chip is picked. It is a
  // cap of one across a whole plan rather than a balance target, so a draft that
  // breaks it is not a partial improvement worth keeping (Akber, 8 Sep 2026).
  for (const variant of ['packed', 'slow']) {
    for (const [interest, cap] of Object.entries(MAX_STOPS_PER_INTEREST_PER_PLAN)) {
      if (!wantedInterests.includes(interest)) continue;
      const serving = seenInterestText[variant].filter(
        (entry) => entry.isActivity && matchesInterest(entry, interest)
      );
      if (serving.length > cap) {
        problems.push(
          `${variant}: ${serving.length} stops are "${interest}" (${serving.map((e) => e.name).join(', ')}) ` +
            `- the cap is ${cap} for the whole plan`
        );
      }
    }
  }

  for (const variant of ['packed', 'slow']) {
    for (const interest of wantedInterests) {
      const delivered = seenInterestText[variant].some((entry) => matchesInterest(entry, interest));
      if (!delivered) {
        // Advisory, not blocking, and that is a deliberate retreat.
        //
        // Requiring all four chips in BOTH plans, on top of the balance cap, the
        // prominence bar, the route check and the hours check, made the audit
        // effectively unsatisfiable: fifteen generations in a row were rejected,
        // most of them on this line. Each rule is right on its own and the
        // combination was not achievable on a two-day trip with four interests
        // and five activity slots a day.
        //
        // Coverage across the trip stays blocking, below. A plan missing one
        // chip while its partner carries it is worth seeing in the output and
        // not worth another EUR 1.43 (Akber, 8 Sep 2026).
        // Blocking only when the plan had a slot to spare: a stop serving none
        // of the four chips is a slot the missing chip could have had. A plan
        // with every stop already earning its place and one chip still missing
        // is a real constraint and stays advisory; a plan that spent a slot on
        // nothing and still missed a chip is a defect (Akber, 8 Sep 2026).
        const wasted = seenInterestText[variant].filter(
          (entry) => entry.isActivity && !wantedInterests.some((other) => matchesInterest(entry, other))
        );
        if (wasted.length > 0) {
          problems.push(
            `${variant}: nothing delivers "${interest}" while ${wasted.map((e) => e.name).join(', ')} ` +
              `serve none of the chips - a slot went spare`
          );
        } else {
          notes.push(`${variant}: nothing in this plan delivers "${interest}", the other plan may carry it`);
        }
      }
    }
  }

  // Coverage across the whole trip, which stays blocking: a chip the traveller
  // picked appearing in neither plan is a promise broken outright.
  for (const interest of wantedInterests) {
    const anywhere = ['packed', 'slow'].some((variant) =>
      seenInterestText[variant].some((entry) => matchesInterest(entry, interest))
    );
    if (!anywhere) {
      problems.push(`interest "${interest}" appears nowhere in either plan`);
    }
  }

  return { problems, notes };
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

  // The draft is not deterministic and the audit is strict, so a single attempt
  // is a coin flip. Three separate re-seeds were spent discovering that by hand,
  // each one a full generation, a message and a wait, and two of the three
  // failed on a check the previous attempt had passed. Retrying in here costs
  // exactly what re-running by hand costs and removes the babysitting.
  //
  // Every attempt is audited and the first clean one wins. Nothing is written
  // unless one comes back clean, which is the rule this script existed for -
  // the demo is the first thing a visitor sees and a weak draft must never
  // silently replace a good one. Override with ATTEMPTS=1 to get the old
  // behaviour back for debugging (Akber, 8 Sep 2026).
  const MAX_ATTEMPTS = Number(process.env.ATTEMPTS || 3);
  const dumpPath = path.join(process.cwd(), '.roam-last-generation.json');

  let itinerary = null;
  let lastProblems = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(
      `\nGenerating Tokyo demo via ${BASE_URL} (attempt ${attempt} of ${MAX_ATTEMPTS}) ...`
    );
    const response = await fetch(`${BASE_URL}/api/generate-resolved-itinerary`, {
      method: 'POST',
      headers: requestHeaders({ 'Content-Type': 'application/json' }),
      // accommodation is the plain name string, exactly as Accommodation.jsx
      // sends it. generateRawItinerary needs it so Claude drafts a trip that
      // knows where the traveller is staying. It used to come from TRIP as a
      // hardcoded HOTEL_NAME, which is precisely how it could disagree with the
      // hotel actually looked up above; taking it from the resolved hotel makes
      // that disagreement impossible.
      body: JSON.stringify({
        ...TRIP,
        accommodation: accommodationDetails.name,
        accommodationDetails,
      }),
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

    const candidate = await response.json();

    for (const variant of ['packed', 'slow']) {
      for (const day of candidate[variant]?.days || []) {
        const unresolved = day.items.filter((item) => !item.location);
        if (unresolved.length > 0) {
          console.warn(
            `  ! ${variant} day ${day.day}: ${unresolved.length} stop(s) with no location: ` +
              unresolved.map((item) => item.name).join(', ')
          );
        }
      }
    }

    // Always keep the raw generation, pass or fail. Every fix this session was
    // reverse-engineered from the four-line audit summary while the itinerary
    // that produced it was discarded, which meant guessing at the stops the
    // summary did not name - and guessing wrong repeatedly. A rejected draft
    // costs EUR 1.43; keeping it costs nothing (Akber, 7 Sep 2026).
    await writeFile(
      dumpPath,
      JSON.stringify({ trip: TRIP, accommodationDetails, itinerary: candidate }, null, 2)
    );
    console.log(`  full generation saved to ${dumpPath}`);

    const { problems, notes } = auditDemo(candidate);
    if (notes.length > 0) {
      console.warn('\n  Worth a look, but not blocking:\n');
      for (const note of notes) console.warn(`    ~ ${note}`);
    }
    if (problems.length === 0) {
      itinerary = candidate;
      console.log('\nAudit passed: every day has activities, a dinner, photos and its interests.');
      break;
    }

    lastProblems = problems;
    console.error(`\n  Attempt ${attempt} is not good enough to ship as the demo:\n`);
    for (const problem of problems) console.error(`    x ${problem}`);
    if (attempt < MAX_ATTEMPTS) console.error('\n  Trying again for a different draft ...');
  }

  if (!itinerary) {
    console.error(
      `\nNothing was written. ${MAX_ATTEMPTS} attempts all failed the audit, the last one on:\n`
    );
    for (const problem of lastProblems) console.error(`  x ${problem}`);
    console.error(
      '\nThe last draft is in .roam-last-generation.json. Failing the same check\n' +
        'every time is a pipeline problem, not bad luck; failing a different one\n' +
        'each time means raising ATTEMPTS is the cheaper answer.'
    );
    process.exit(1);
  }

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
