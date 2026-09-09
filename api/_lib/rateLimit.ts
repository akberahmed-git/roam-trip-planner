import { kvIncrementWithTtl, kvReadCount, KV_ENABLED } from './kvCache.js';

// Spend guard for the two endpoints that actually cost money per call.
//
// Nothing in front of these endpoints limited anything before this: Vercel's
// firewall covers DDoS and bandwidth, but a completely legitimate visitor
// generating one trip still bills Google Places + Routes + Anthropic. With the
// app about to be linked publicly, the failure mode that matters isn't a big
// invoice, it's the credits running dry mid-week and the link going dead while
// people are clicking it.
//
// Two independent ceilings per bucket:
//   perIp   - stops one person (or one script) burning the day's budget alone
//   global  - the actual spend ceiling, regardless of how many people show up
// Both are counted, then checked, so the numbers stay accurate for whichever
// one trips first.
//
// Counters are plain daily KV keys (INCR + a 24h TTL on first write) rather
// than a sliding window - a rolling window needs a sorted set per visitor and
// this only has to answer "has today's budget gone", which a date-suffixed
// key answers exactly, expires by itself, and costs one KV op.

const DAY_SECONDS = 60 * 60 * 24;

// Tuned against the real cost per call, not guessed. A fresh generation is
// roughly EUR 1.43 of Places + Routes + Anthropic (a cached repeat ~EUR 0.50),
// so 150/day is a worst case near EUR 215/day and a realistic case far lower
// once the place cache warms on popular destinations. Accommodation search is
// cheaper per call but far from free, and it runs before every generation, so
// it gets its own looser ceiling.
//
// perIp is disabled (null). It was tuned for a stranger and kept catching the
// person who owns the project: an honest user planning a trip, disliking the
// pacing and changing the dates is three generations without doing anything
// unusual, and a household, office or phone on CGNAT all present as a single
// address. Set it to a number to turn it back on.
//
// The global cap is sized against Google, not Anthropic, because Google is the
// binding constraint and the one with no hard stop. A fresh generation costs
// roughly EUR 1.43 in Places and Routes (about EUR 0.50 when the destination's
// places are already cached, which a public link mostly will not be), against a
// EUR 40/month Google budget that only sends alerts - it does not halt billing.
// Anthropic is gentler: prepaid, auto-reload off, so it simply stops.
//
// 20/day is therefore about EUR 29/day worst case, and makes the Anthropic
// balance last roughly a fortnight. The earlier 150 would have spent the whole
// month's Google budget before lunch on day one.
//
// Turning someone away is cheap here: the 429 renders as an example trip, not
// an error, so a visitor past the cap still sees the product working.
//
// Both ceilings can be raised from the environment without touching this file.
// The reason is a real one: an afternoon of re-seeding the demo spent the whole
// day's twenty generations and locked the live link for everyone, because
// maintenance and visitors draw on the same budget. Raising the number in code
// meant a commit to raise it and a second commit to put it back, with the
// obvious failure mode of forgetting the second one and leaving production
// uncapped in a way nobody would notice until the bill.
//
// So the safe value lives here as the default and the override lives in Vercel,
// where it can be deleted again in one action. Anything missing, unparseable or
// not positive falls back to the default rather than to no limit, because a
// typo in an environment variable must not be the thing that removes the only
// spend ceiling this app has (Akber, 8 Sep 2026).
function dailyLimit(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// Every endpoint that can bill something has a bucket here, sized so that the
// day's worst case on each is a few euros at most. The generation cap does the
// real work (a plan is ~EUR 2.30 cold, measured 9 Sep 2026); the rest exist
// because a link on LinkedIn brings people who never press Generate, and each
// of these fires before that button:
//
//   hotel         3 Enterprise searches per new city, ~EUR 0.10, cached after
//   autocomplete  one Google Autocomplete request per keystroke burst,
//                 ~EUR 0.003, cached per input after this change
//   swap          one Enterprise search + a model call per "Swap places"
//   interests     one Haiku call per never-seen destination (cached a year)
//   travel        Routes calls after a swap or reorder, cached per pair
//
// Past a bucket's ceiling the client degrades rather than breaks: autocomplete
// goes quiet and you type the city yourself, interests fall back to the
// staple chips, swap shows its retry state, travel times keep the last number
// (Akber, 9 Sep 2026).
export const LIMITS = {
  trip: { perIp: null, global: dailyLimit('TRIP_DAILY_LIMIT', 20) },
  hotel: { perIp: null, global: dailyLimit('HOTEL_DAILY_LIMIT', 100) },
  autocomplete: { perIp: null, global: dailyLimit('AUTOCOMPLETE_DAILY_LIMIT', 2000) },
  swap: { perIp: null, global: dailyLimit('SWAP_DAILY_LIMIT', 200) },
  interests: { perIp: null, global: dailyLimit('INTERESTS_DAILY_LIMIT', 300) },
  travel: { perIp: null, global: dailyLimit('TRAVEL_DAILY_LIMIT', 500) },
};

// Vercel puts the real client address at the front of x-forwarded-for; the
// rest of the chain is proxies. x-real-ip is the fallback for local/other
// runtimes. An unidentifiable caller is bucketed under a shared 'unknown'
// key rather than being waved through, so a request with no usable address
// still counts against something.
export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  const real = req.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) {
    return real.trim();
  }
  return 'unknown';
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

// Returns { allowed, scope, count, limit }.
//
// scope is 'ip' or 'global' when a ceiling was hit, null otherwise, so the
// handler can say which one it was - "you've done three today" and "Roam has
// done its lot for today" are different messages and lead to different next
// steps for the visitor.
//
// Fails OPEN, on purpose. kvIncrementWithTtl returns null when Upstash isn't
// configured (local dev) or when a KV call fails. Treating that as "blocked"
// would mean a KV blip takes the whole product offline; treating it as "no
// data" means the worst case is a short window of uncapped spend, which the
// Google Cloud budget alert still catches.
export async function checkRateLimit(bucket, req) {
  const limits = LIMITS[bucket];
  if (!limits) {
    throw new Error(`Unknown rate limit bucket: ${bucket}`);
  }

  if (!KV_ENABLED) {
    return { allowed: true, scope: null, count: null, limit: null, bucket };
  }

  const stamp = todayStamp();

  // The per-address counter is only incremented when it is actually enforced -
  // counting something nothing reads would be a KV write per request for no
  // reason.
  const perIpEnabled = typeof limits.perIp === 'number';
  const ip = perIpEnabled ? clientIp(req) : null;

  const [ipCount, globalCount] = await Promise.all([
    perIpEnabled
      ? kvIncrementWithTtl(`ratelimit:${bucket}:ip:${ip}:${stamp}`, DAY_SECONDS)
      : Promise.resolve(null),
    kvIncrementWithTtl(`ratelimit:${bucket}:global:${stamp}`, DAY_SECONDS),
  ]);

  if (globalCount !== null && globalCount > limits.global) {
    return { allowed: false, scope: 'global', count: globalCount, limit: limits.global, bucket };
  }
  if (perIpEnabled && ipCount !== null && ipCount > limits.perIp) {
    return { allowed: false, scope: 'ip', count: ipCount, limit: limits.perIp, bucket };
  }

  return { allowed: true, scope: null, count: globalCount, limit: limits.global, bucket };
}

// The same question checkRateLimit answers, without spending anything to ask.
//
// Exists so the app can tell someone the day's planning is gone BEFORE they
// fill in a destination, pick dates and choose a hotel. Previously the cap was
// only discovered at the generation step, which meant a visitor did all that
// work, burned a real hotel search, and only then hit the wall - the most
// annoying possible order.
//
// Reads only, so calling it on every page load costs a KV GET and nothing else.
// Unknown (KV off, read failed) reports as available: better to let someone
// start and hit the real check than to turn away a visitor over a cache blip.
export async function peekRateLimit(bucket) {
  const limits = LIMITS[bucket];
  if (!limits || !KV_ENABLED) {
    return { available: true, scope: null };
  }

  const count = await kvReadCount(`ratelimit:${bucket}:global:${todayStamp()}`);
  if (count === null) {
    return { available: true, scope: null };
  }

  return count >= limits.global
    ? { available: false, scope: 'global' }
    : { available: true, scope: null };
}

// One place to build the 429 body so both endpoints answer identically and the
// frontend only has to recognise a single shape. code is what the client
// branches on; error is shown to the person if the client has nothing better.
export function rateLimitResponse(res, result) {
  // Only the planning buckets talk about "an example trip"; the client for a
  // small feature (autocomplete, swap) ignores the body and degrades quietly,
  // but if a message ever does surface it should describe that feature.
  const planning = result.bucket == null || result.bucket === 'trip' || result.bucket === 'hotel';
  const message = !planning
    ? "Roam has hit today's limit for this feature. It resets tomorrow."
    : result.scope === 'global'
      ? "Roam has hit today's shared planning limit. Here's an example trip in the meantime, and full planning is back tomorrow."
      : "You've reached today's limit of planned trips. Here's an example trip in the meantime, and your limit resets tomorrow.";

  return res.status(429).json({
    error: message,
    code: 'RATE_LIMITED',
    scope: result.scope,
  });
}

// Recognises the upstream failures that mean "no budget left", as opposed to a
// bug. The Anthropic account this runs on is prepaid with auto-reload off, so
// running dry is not a hypothetical - it is the expected end state of a busy
// week, and the difference between handling it and not is whether a visitor
// arriving from a link sees a working product or a red error screen.
//
// Matching is deliberately broad and message-based. The SDK reports a spent
// balance as a 400 with "credit balance is too low" rather than a distinct
// error type, and the exact wording is not part of any contract, so a narrow
// match would silently stop working after an upstream copy change. A false
// positive here costs a friendlier error message than the truth; a false
// negative costs the red screen, which is the worse trade.
const CAPACITY_PATTERNS = [
  /credit balance/i,
  /insufficient (?:credit|funds|quota|balance)/i,
  /quota (?:exceeded|exhausted)/i,
  /billing/i,
  /rate limit/i,
  /overloaded/i,
];

export function isCapacityError(error) {
  if (!error) return false;
  const status = error.status ?? error.statusCode;
  if (status === 429) return true;
  const message = String(error.message || '');
  return CAPACITY_PATTERNS.some((pattern) => pattern.test(message));
}
