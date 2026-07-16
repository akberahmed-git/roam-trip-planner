// Shared two-level lookup cache (L1 in-memory + L2 Vercel KV / Upstash),
// extracted so hotelSearch.js and travelTime.js can reuse the exact same
// caching verifyPlace.js already uses for itinerary place lookups. Each caller
// passes its own namespace so keys never collide across search types.
//
// L1 is a per-namespace in-memory Map that lives for the life of a warm
// serverless instance (dedupes within a single generation). L2 is the
// persistent Upstash store, active only when KV_REST_API_URL +
// KV_REST_API_TOKEN are set; without them it transparently falls back to
// L1-only, exactly as before. A cache read or write must never break a
// request, and results the caller deems unworthy (failures, empty results)
// are never stored, so a transient error still retries next time.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);
export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const L1_MAX = 200;
const l1ByNamespace = new Map();

function l1For(namespace) {
  let map = l1ByNamespace.get(namespace);
  if (!map) {
    map = new Map();
    l1ByNamespace.set(namespace, map);
  }
  return map;
}

async function kvCommand(command) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error('KV HTTP ' + res.status);
  return res.json();
}

async function kvGet(key) {
  if (!KV_ENABLED) return null;
  try {
    const data = await kvCommand(['GET', key]);
    return data && data.result != null ? JSON.parse(data.result) : null;
  } catch {
    return null; // A cache read must never break a request.
  }
}

async function kvSet(key, value, ttl) {
  if (!KV_ENABLED) return;
  try {
    await kvCommand(['SET', key, JSON.stringify(value), 'EX', ttl]);
  } catch {
    // A cache write must never break a request.
  }
}

// cached(namespace, key, fetcher, opts)
//   namespace  logical cache bucket, also the L2 key prefix
//   key        stable string identifying this lookup within the namespace
//   fetcher    async () => result, only called on a miss (its throw propagates,
//              and nothing is cached, so an API error still surfaces/retries)
//   opts.ttl          L2 expiry in seconds (default 30 days)
//   opts.shouldCache  (result) => whether the result is worth storing (default:
//                     any non-null). Failures/empties should return false so
//                     they retry rather than being pinned as a stale answer.
export async function cached(namespace, key, fetcher, opts = {}) {
  const { ttl = DEFAULT_TTL_SECONDS, shouldCache = (r) => r != null } = opts;
  const l1 = l1For(namespace);
  if (l1.has(key)) return l1.get(key);

  const kvKey = namespace + ':' + key;
  const stored = await kvGet(kvKey);
  if (stored != null) {
    l1.set(key, stored);
    return stored;
  }

  const result = await fetcher();
  if (shouldCache(result)) {
    if (l1.size >= L1_MAX) {
      l1.delete(l1.keys().next().value); // evict oldest (Map keeps insertion order)
    }
    l1.set(key, result);
    await kvSet(kvKey, result, ttl);
  }
  return result;
}
