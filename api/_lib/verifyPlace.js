const GENERIC_WORDS = new Set([
  'restaurant', 'restaurants', 'restorant', 'resto', 'bar', 'cafe',
  'taverna', 'tavern', 'bistro', 'grill', 'lounge', 'pub', 'hotel', 'house',
  'inn', 'resort', 'spa', 'club', 'kitchen', 'eatery', 'diner', 'snack',
  'bakery', 'beach', 'park', 'castle', 'museum', 'gallery', 'market',
  'shop', 'store', 'national', 'spring', 'springs', 'waterfall', 'viewpoint',
  'point', 'tour', 'tours', 'boutique', 'the', 'and'
]);

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function coreTokens(str) {
  return normalize(str).split(' ').filter(w => w && !GENERIC_WORDS.has(w));
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function similarityScore(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

export function nameSimilarity(queryName, resultName) {
  const a = normalize(queryName);
  const b = normalize(resultName);
  if (!a || !b) return 0;

  const fullScore = similarityScore(a, b);

  const coreA = coreTokens(queryName).join(' ');
  const coreB = coreTokens(resultName).join(' ');

  let coreScore = 0;
  if (coreA && coreB) {
    coreScore = coreA === coreB ? 0.95 : similarityScore(coreA, coreB);
  }

  return Math.max(fullScore, coreScore);
}

function qualityScore(place) {
  const rating = place.rating || 0;
  const count = place.userRatingCount || 0;
  return rating * Math.log(count + 1);
}

function hoursInfo(place) {
  const hours = place.regularOpeningHours;
  return {
    hasHours: !!(hours && hours.weekdayDescriptions && hours.weekdayDescriptions.length > 0),
    weekdayDescriptions: hours?.weekdayDescriptions || null
  };
}

function photoUrlFor(place) {
  const photos = place.photos;
  if (!photos || photos.length === 0) {
    return null;
  }
  const ref = photos[0].name;
  return '/api/place-photo?ref=' + encodeURIComponent(ref);
}

function locationOf(place) {
  if (!place.location) {
    return null;
  }
  return { lat: place.location.latitude, lng: place.location.longitude };
}

function toSuggestion(place) {
  return {
    placeId: place.id,
    name: place.displayName?.text,
    address: place.formattedAddress,
    rating: place.rating,
    ratingCount: place.userRatingCount,
    // photoUrl intentionally omitted for suggestions — these are fallback
    // candidates shown when the primary place can't be verified. Fetching
    // their photos would trigger a Place Details Photos charge for images the
    // user may never see. The swap/suggestion UI handles a null photoUrl gracefully.
    photoUrl: null,
    location: locationOf(place),
    ...hoursInfo(place)
  };
}

function buildApiErrorMessage(data) {
  if (data && data.error && data.error.message) {
    return data.error.message;
  }
  return 'Google Places API returned an error';
}

const MATCH_THRESHOLD = 0.6;

// Two-level cache for Text Search results so the same place is never billed
// twice. L1 is an in-memory Map that lives for the life of a warm serverless
// instance (dedupes within a single generation). L2 is a persistent Vercel KV /
// Upstash store, used only when KV_REST_API_URL + KV_REST_API_TOKEN are set, so
// results survive cold starts and are shared across every request and user.
// Without those env vars it transparently falls back to L1-only, exactly as
// before. Failed lookups are never cached, so a transient API error still retries.
const _searchCache = new Map();
const SEARCH_CACHE_MAX = 200;

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

async function kvSet(key, value) {
  if (!KV_ENABLED) return;
  try {
    await kvCommand(['SET', key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS]);
  } catch {
    // A cache write must never break a request.
  }
}

async function cachedSearch(textQuery, fetcher) {
  if (_searchCache.has(textQuery)) {
    return _searchCache.get(textQuery);
  }
  const kvKey = 'places:search:' + textQuery;
  const stored = await kvGet(kvKey);
  if (stored != null) {
    _searchCache.set(textQuery, stored);
    return stored;
  }
  const result = await fetcher();
  // Only cache real results, never a transient failure, or we'd serve a stale
  // error and skip the retry.
  if (result && result.status !== 'check_failed') {
    if (_searchCache.size >= SEARCH_CACHE_MAX) {
      // Evict oldest entry (Map preserves insertion order)
      _searchCache.delete(_searchCache.keys().next().value);
    }
    _searchCache.set(textQuery, result);
    await kvSet(kvKey, result);
  }
  return result;
}

async function runSearch(name, textQuery) {
  return cachedSearch(textQuery, () => _runSearch(name, textQuery));
}

async function _runSearch(name, textQuery) {
  let response;
  let data;

  try {
    response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        // rating, userRatingCount and regularOpeningHours all removed — each one is an
        // Enterprise-tier field (~$0.025/request). This mask is now Pro-tier only.
        // hoursInfo() returns hasHours: false for all places as a result.
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.photos,places.location'
      },
      body: JSON.stringify({ textQuery })
    });
    data = await response.json();
  } catch (error) {
    return {
      status: 'check_failed',
      reason: 'network_error',
      error: error.message
    };
  }

  if (!response.ok) {
    return {
      status: 'check_failed',
      reason: 'api_error',
      httpStatus: response.status,
      error: buildApiErrorMessage(data)
    };
  }

  const places = data.places || [];
  const place = places[0];

  if (!place) {
    return { status: 'not_found', nameMatchScore: 0, suggestions: [] };
  }

  const score = nameSimilarity(name, place.displayName?.text || '');

  if (score < MATCH_THRESHOLD) {
    const suggestions = [...places]
      .sort((a, b) => qualityScore(b) - qualityScore(a))
      .slice(0, 3)
      .map(toSuggestion);
    return {
      status: 'not_found',
      nameMatchScore: Math.round(score * 100) / 100,
      suggestions
    };
  }

  return {
    status: 'found',
    nameMatchScore: Math.round(score * 100) / 100,
    placeId: place.id,
    name: place.displayName?.text,
    address: place.formattedAddress,
    rating: place.rating,
    ratingCount: place.userRatingCount,
    photoUrl: photoUrlFor(place),
    location: locationOf(place),
    ...hoursInfo(place)
  };
}

function countryHint(destination) {
  const parts = destination.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : destination;
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Broad-search results (no town-level bias) are only trusted if they land within
// this radius of the destination's own geocoded center. A country-level text hint
// alone isn't tight enough, e.g. "Albania" still spans a multi-hour drive.
export const MAX_BROAD_DISTANCE_METERS = 50000;

// Outer sanity bound applied to the PRIMARY search result. The primary query
// already carries the full destination string, but Google treats that as a text
// hint, not a hard geographic constraint, so a strong name match on the wrong
// continent (a Lisbon stop resolving to North America - the transatlantic map
// pin) can still come back as "found". This radius is deliberately looser than
// MAX_BROAD_DISTANCE_METERS so a legitimately spread-out city or region isn't
// rejected, while anything wildly off - another country or continent - is. A
// primary result past this is not trusted; verifyPlace re-tries via the broad
// search and, failing that, returns not_found so the stop is left without a
// (wrong) location rather than pinned somewhere impossible.
export const MAX_PLAUSIBLE_DISTANCE_METERS = 150000;

// Used by generate-resolved-itinerary.js's drive-time backstop: when two
// consecutive verified stops turn out to be an unreasonable drive apart
// (almost always a real place that resolved to the wrong region - a
// same-named business elsewhere, or a substitute picked without checking
// where it actually is), this searches for a genuinely nearby alternative
// instead, biased hard to a small radius around the previous stop rather
// than just the destination as a whole.
export async function findNearbyCandidates(name, type, near, radiusMeters = 20000) {
  const textQuery = type ? name + ' ' + type : name;

  let response;
  let data;
  try {
    response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        // rating, userRatingCount and regularOpeningHours removed — all Enterprise-tier.
        // Pro-tier only now, same cost reason as runSearch.
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.photos,places.location'
      },
      body: JSON.stringify({
        textQuery,
        locationBias: {
          circle: {
            center: { latitude: near.lat, longitude: near.lng },
            radius: radiusMeters
          }
        }
      })
    });
    data = await response.json();
  } catch {
    return [];
  }

  if (!response.ok) {
    return [];
  }

  const places = data.places || [];
  return [...places]
    .sort((a, b) => qualityScore(b) - qualityScore(a))
    .map(toSuggestion);
}

export async function geocodeDestination(destination) {
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.location'
      },
      body: JSON.stringify({ textQuery: destination })
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const place = data.places?.[0];
    if (!place || !place.location) {
      return null;
    }
    return { lat: place.location.latitude, lng: place.location.longitude };
  } catch {
    return null;
  }
}

export async function verifyPlace(params) {
  const name = params.name;
  const destination = params.destination;
  const type = params.type;
  const anchor = params.anchor;

  const primaryQuery = type
    ? name + ' ' + type + ', ' + destination
    : name + ', ' + destination;

  const primary = await runSearch(name, primaryQuery);

  if (primary.status === 'check_failed') {
    return primary;
  }

  // A "found" primary is trusted only if it sits a plausible distance from the
  // destination. The destination in the query is just a text hint to Google,
  // not a hard geographic bound, so a strong name match on another continent
  // can come back as "found" (a Lisbon stop resolving to North America - the
  // transatlantic pin). Past the sanity radius it is rejected here and re-tried
  // via the broad search below.
  const primaryPlausible =
    !anchor || !primary.location ||
    haversineMeters(anchor, primary.location) <= MAX_PLAUSIBLE_DISTANCE_METERS;
  if (primary.status === 'found' && primaryPlausible) {
    return primary;
  }

  // Drop the specific town/area bias (some real landmarks sit outside it, e.g.
  // Butrint National Park is nearer Sarandë than Ksamil), but keep a country-level
  // hint so a strong name match on the other side of the world doesn't win, which
  // happened with a restaurant literally named after Berlin resolving to Germany.
  const hint = countryHint(destination);
  const broadQuery = type
    ? name + ' ' + type + ', ' + hint
    : name + ', ' + hint;

  const broad = await runSearch(name, broadQuery);

  if (broad.status === 'found') {
    if (anchor && broad.location) {
      const distance = haversineMeters(anchor, broad.location);
      if (distance <= MAX_BROAD_DISTANCE_METERS) {
        return broad;
      }
      // Right country, wrong region (e.g. matched somewhere hours away by car) -
      // fall through to suggestions rather than trusting it.
    } else {
      return broad;
    }
  }

  // Prefer surfacing nearby suggestions the traveller can accept over returning
  // a place we have just judged too far away.
  if (broad.status === 'not_found' && broad.suggestions && broad.suggestions.length > 0) {
    return broad;
  }
  if (primary.status === 'not_found' && primary.suggestions && primary.suggestions.length > 0) {
    return primary;
  }

  // Nothing trustworthy and near - including a "found" primary we just rejected
  // as implausibly far. Return a clean not_found so applyResolution leaves the
  // stop without a location (no map pin, keeps its name) rather than pinning it
  // on the wrong continent. A location-less stop draws no map line; the tight
  // MAX_BROAD_DISTANCE_METERS substitute guard still applies if a suggestion is
  // adopted later.
  return {
    status: 'not_found',
    nameMatchScore: primary.nameMatchScore || 0,
    suggestions: [],
  };
}
