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

const { isOpenAt, weekdayForDay } = await import('../api/_lib/openingHours.ts');

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
const TRIP = {
  destination: 'Tokyo',
  days: 2,
  budget: 'Standard',
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
const MAX_PLAUSIBLE_STAY_MINUTES = 200;

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
      const noPhoto = items.filter((i) => !i.photoUrl);
      if (noPhoto.length > 0) {
        problems.push(`${label}: ${noPhoto.length} stop(s) with no photo: ${noPhoto.map((i) => i.name).join(', ')}`);
      }

      for (const item of items) {
        // Per stop and per variant, not one merged blob for the whole trip.
        // Merged, a single incidental word anywhere cleared an interest for
        // both plans at once.
        seenInterestText[variant].push(
          `${item.name} ${item.categoryTag || ''} ${item.description || ''}`.toLowerCase()
        );
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
      if (activities.length > 0 && known.length < MIN_WELL_KNOWN_PER_DAY) {
        problems.push(
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
  const INTEREST_EVIDENCE = {
    'temples & shrines': ['temple', 'shrine', 'jinja', 'jingu', 'taisha', 'sensō', 'senso-ji', 'zōjō', 'zojo', 'buddhist', 'shinto', 'pagoda'],
    'anime & pop culture': ['anime', 'manga', 'ghibli', 'akihabara', 'nakano broadway', 'pokemon', 'nintendo', 'gundam', 'otaku', 'cosplay', 'arcade', 'figure', 'pop culture', 'kawaii', 'game centre', 'game center', 'character cafe'],
    nightlife: ['bar', 'club', 'nightlife', 'izakaya', 'golden gai', 'yokocho', 'live music', 'jazz', 'lounge', 'rooftop', 'kabukich', 'night'],
    'modern architecture': ['architecture', 'tower', 'skytree', 'observation', 'observatory', 'hills', 'midtown', 'forum', 'teamlab', 'skyscraper', 'building', 'deck', 'city view'],
  };

  // Whole words. Substring matching is what put "bar" inside Barbecue.
  const mentions = (text, word) =>
    new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);

  for (const variant of ['packed', 'slow']) {
    for (const interest of wantedInterests) {
      const evidence = INTEREST_EVIDENCE[interest];
      if (!evidence) continue;
      const delivered = seenInterestText[variant].some((text) =>
        evidence.some((word) => mentions(text, word))
      );
      if (!delivered) {
        problems.push(`${variant}: nothing in this plan delivers "${interest}"`);
      }
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
