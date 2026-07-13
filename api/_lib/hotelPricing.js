// Real hotel pricing via Xotelo (https://xotelo.com) - a free, public API with
// no signup or auth required. It indexes hotels by its own TripAdvisor-based
// `hotel_key`, unrelated to a Google Places `placeId`, so this module does its
// own name-based search + match rather than trying to reuse Places IDs.
//
// Xotelo is a single-developer project with no published SLA, not an
// enterprise partner. Consistent with the "never fabricate" rule used
// everywhere else in this app: any failed request, network error, or
// low-confidence match leaves pricePerNight/totalPrice as null so the caller
// falls back to the existing priceLevelLabel badge instead of showing a wrong
// or made-up number.

import { nameSimilarity } from './verifyPlace.js';

// The free, unauthenticated data.xotelo.com endpoint started returning
// "available only for RapidAPI" 401s (confirmed live, 8 Jul 2026), so this
// goes through RapidAPI's gateway instead. Same underlying Xotelo data and
// same /api/... paths, just a different host plus two auth headers.
const XOTELO_HOST = 'xotelo-hotel-prices.p.rapidapi.com';
const XOTELO_BASE = 'https://' + XOTELO_HOST + '/api';

// Same bar verifyPlace.js uses for trusting a Google Places name match.
const MATCH_THRESHOLD = 0.6;

const EMPTY_PRICE = { pricePerNight: null, totalPrice: null, currency: null, nights: null };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function xoteloGet(path, params, attempt = 1) {
  if (!process.env.XOTELO_RAPIDAPI_KEY) {
    throw new Error('XOTELO_RAPIDAPI_KEY is not set in .env');
  }

  const url = new URL(XOTELO_BASE + path);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': XOTELO_HOST,
      'x-rapidapi-key': process.env.XOTELO_RAPIDAPI_KEY,
    },
  });
  const rawBody = await response.text();
  console.log('[hotelPricing] GET %s -> %d: %s', url.toString(), response.status, rawBody.slice(0, 500));

  // Free-tier rate limit is a transient condition, not a real failure - wait
  // briefly and retry once before giving up and falling back to no price.
  if (response.status === 429 && attempt < 2) {
    await sleep(1500);
    return xoteloGet(path, params, attempt + 1);
  }

  if (!response.ok) {
    throw new Error('Xotelo request failed with status ' + response.status + ': ' + rawBody.slice(0, 200));
  }

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new Error('Xotelo response was not valid JSON: ' + rawBody.slice(0, 200));
  }

  if (data.error) {
    const message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    throw new Error('Xotelo returned an error: ' + message);
  }
  return data.result;
}

async function findHotelKey(name, destination) {
  const result = await xoteloGet('/search', { query: name + ' ' + destination });
  const list = result?.list || [];
  console.log('[hotelPricing] search for "%s" -> %d candidates', name, list.length);
  if (list.length === 0) return null;

  const scored = list
    .map((candidate) => ({ candidate, score: nameSimilarity(name, candidate.name || '') }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  console.log(
    '[hotelPricing] best match for "%s": "%s" score=%s (threshold=%s)',
    name, best?.candidate?.name, best?.score, MATCH_THRESHOLD
  );
  if (!best || best.score < MATCH_THRESHOLD) return null;

  return best.candidate.hotel_key;
}

function nightsBetween(checkInDate, checkOutDate) {
  const ms = new Date(checkOutDate) - new Date(checkInDate);
  const nights = Math.round(ms / (1000 * 60 * 60 * 24));
  return nights > 0 ? nights : null;
}

// Attaches a real nightly rate to a single hotel option (as already returned
// by hotelSearch.js). Never throws - any failure or low-confidence match just
// returns the empty shape so the caller's existing fallback applies.
export async function priceHotel({ name, destination, checkInDate, checkOutDate, currency = 'EUR' }) {
  const nights = nightsBetween(checkInDate, checkOutDate);
  if (!nights) {
    return EMPTY_PRICE;
  }

  try {
    const hotelKey = await findHotelKey(name, destination);
    if (!hotelKey) {
      return { ...EMPTY_PRICE, nights };
    }

    const result = await xoteloGet('/rates', {
      hotel_key: hotelKey,
      chk_in: checkInDate,
      chk_out: checkOutDate,
      currency,
    });

    const rates = result?.rates || [];
    console.log('[hotelPricing] rates for hotel_key=%s -> %d offers', hotelKey, rates.length);
    if (rates.length === 0) {
      return { ...EMPTY_PRICE, nights };
    }

    // Lowest currently-bookable rate across OTAs - what a user would actually
    // find clicking through, not an average or an estimate.
    const cheapest = rates.reduce((min, r) => (r.rate < min.rate ? r : min), rates[0]);
    const pricePerNight = Math.round(cheapest.rate);

    return {
      pricePerNight,
      totalPrice: pricePerNight * nights,
      currency,
      nights,
    };
  } catch (error) {
    // Network error, throttling, response-shape change, etc. Fail quiet to
    // the caller, but log so a real bug is visible in the vercel dev terminal.
    console.error('[hotelPricing] priceHotel failed for "%s":', name, error);
    return { ...EMPTY_PRICE, nights };
  }
}
