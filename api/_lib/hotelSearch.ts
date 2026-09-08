import { neighbourhoodOf } from './placeAddress.js';
// Real, Places-verified accommodation search. Every hotel shown here is a
// real business with a real photo, rating and address, consistent with the
// "every place shown is real" rule used for itinerary stops.
//
// Pricing model (changed 7 Jul 2026, three times):
// 1st pass: confirmed a real Xotelo price for every pooled candidate (up to
// ~30) before it could even decide which tier a hotel belonged in - up to
// ~120 Xotelo requests per page load, burned a 1000/month free quota in a
// few hours, and meant any Xotelo hiccup dropped every hotel from every tier
// (a single-developer API with no published SLA - see hotelPricing.js).
// 2nd pass: dropped Xotelo entirely for accommodation pricing in favor of
// Google's own `priceRange` field (Money startPrice/endPrice), pulled in the
// same Places Text Search call already being made for rating/priceLevel -
// free, since that call is already Enterprise-tier billing. Confirmed
// empirically this field is simply never populated for the lodging category
// (null across every hotel tested, including flagship properties like The
// Plaza and Mandarin Oriental New York), so this alone left every tier
// showing "Not available".
// 3rd pass (this version): when Places has no priceRange, fall back to a
// Claude-generated estimate (estimatePriceRange.js), grounded in the actual
// hotel names shown. Always tagged `estimated: true` and shown with a
// visible "Estimated" badge in the UI - the one deliberate exception to
// "never fabricate" elsewhere in this app, made acceptable by never hiding
// that it's a guess.
import { estimatePriceRanges } from './estimatePriceRange.js';
import { cached } from './kvCache.js';
import { geocodeDestination } from './verifyPlace.js';
import { haversineMeters } from './routeShape.js';

const TIER_QUERY_PREFIX = {
  Economy: 'budget hotel in',
  Standard: 'hotel in',
  Luxury: 'luxury hotel in',
};

const TIERS = ['Economy', 'Standard', 'Luxury'];

// How many top-quality hotels are actually shown per tier.
const SHOWN_PER_TIER = 3;

// Static ISO 3166-1 alpha-2 country -> ISO 4217 currency map. This is what
// the Currency selector defaults to - deliberately NOT derived solely from
// priceRange, because priceRange coverage is a real per-property data gap
// (confirmed: Newcastle came back with zero priceRange hits across all 9
// sampled hotels) and that used to leave the whole currency selector empty
// with nothing to fall back to. Country->currency is close to static
// reference data, not a live API call, so there's no coverage risk here.
//
// Extended 9 Jul 2026 to cover every UN member state plus the handful of
// non-UN territories real trip searches actually hit (Bermuda, Puerto Rico,
// Greenland, the Channel Islands, etc.) - the original ~90-country list was
// missing Lebanon, Iran, Iraq and Afghanistan among others, which meant
// destinationCurrency came back null for them. That's a hard blocker further
// down: the Claude-estimate price-range fallback (see the comment at the top
// of this file) only runs once a currency is already known, so a missing
// country here doesn't just show the wrong currency, it silently skips the
// price estimate entirely and both the price range and the currency
// selector end up empty even though the hotel results themselves load fine.
const CURRENCY_BY_COUNTRY = {
  GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IE: 'EUR',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', PT: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', GR: 'EUR', FI: 'EUR', LU: 'EUR', MT: 'EUR',
  CY: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', HR: 'EUR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK', PL: 'PLN',
  CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', AL: 'ALL', RS: 'RSD',
  ME: 'EUR', MK: 'MKD', BA: 'BAM', TR: 'TRY', UA: 'UAH', RU: 'RUB',
  CN: 'CNY', JP: 'JPY', KR: 'KRW', HK: 'HKD', TW: 'TWD', SG: 'SGD',
  MY: 'MYR', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP', IN: 'INR',
  PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', AE: 'AED', SA: 'SAR',
  QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', IL: 'ILS', JO: 'JOD',
  EG: 'EGP', MA: 'MAD', TN: 'TND', ZA: 'ZAR', KE: 'KES', NG: 'NGN',
  GH: 'GHS', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP',
  PE: 'PEN', UY: 'UYU', CR: 'CRC', PA: 'PAB', DO: 'DOP', JM: 'JMD',
  BS: 'BSD', BB: 'BBD', TT: 'TTD', FJ: 'FJD', GE: 'GEL', AM: 'AMD',
  AZ: 'AZN', KZ: 'KZT', UZ: 'UZS', MN: 'MNT', MV: 'MVR', KH: 'KHR',
  LA: 'LAK', MM: 'MMK', BN: 'BND', MO: 'MOP',

  // Middle East
  LB: 'LBP', IR: 'IRR', IQ: 'IQD', AF: 'AFN', SY: 'SYP', YE: 'YER', PS: 'ILS',

  // Central Asia (KZ, UZ, MN already listed above)
  KG: 'KGS', TJ: 'TJS', TM: 'TMT',

  // South / East Asia
  BT: 'BTN', KP: 'KPW', TL: 'USD',

  // Europe - remaining microstates and non-EU territories
  AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR', LI: 'CHF', MD: 'MDL', BY: 'BYN',
  XK: 'EUR', GI: 'GIP', IM: 'GBP', JE: 'GBP', GG: 'GBP',

  // Africa - the original list only covered EG, MA, TN, ZA, KE, NG, GH
  DZ: 'DZD', LY: 'LYD', SD: 'SDG', SS: 'SSP', ET: 'ETB', ER: 'ERN', DJ: 'DJF',
  SO: 'SOS', UG: 'UGX', TZ: 'TZS', RW: 'RWF', BI: 'BIF', CD: 'CDF', CG: 'XAF',
  CM: 'XAF', CF: 'XAF', TD: 'XAF', GA: 'XAF', GQ: 'XAF', AO: 'AOA', ZM: 'ZMW',
  // ZWG is Zimbabwe's Gold-backed currency (adopted April 2024), replacing
  // the hyperinflated ZWL.
  ZW: 'ZWG', MZ: 'MZN', MW: 'MWK', NA: 'NAD', BW: 'BWP', SZ: 'SZL', LS: 'LSL',
  MG: 'MGA', MU: 'MUR', SC: 'SCR', KM: 'KMF', CV: 'CVE', ST: 'STN', GW: 'XOF',
  GN: 'GNF',
  // SLE is Sierra Leone's redenominated Leone (2022), replacing SLL.
  SL: 'SLE',
  LR: 'LRD', CI: 'XOF', BF: 'XOF', ML: 'XOF', NE: 'XOF', SN: 'XOF', TG: 'XOF',
  BJ: 'XOF', MR: 'MRU', GM: 'GMD',
  // Western Sahara - disputed territory, Moroccan-administered majority uses MAD.
  EH: 'MAD',

  // Americas - remaining Central/South America and the Caribbean
  GT: 'GTQ', HN: 'HNL', SV: 'USD', NI: 'NIO', BZ: 'BZD', CU: 'CUP', HT: 'HTG',
  GY: 'GYD', SR: 'SRD', PY: 'PYG', BO: 'BOB', EC: 'USD', VE: 'VES',
  AG: 'XCD', DM: 'XCD', GD: 'XCD', KN: 'XCD', LC: 'XCD', VC: 'XCD', AI: 'XCD',
  MS: 'XCD',
  PR: 'USD', GU: 'USD', VI: 'USD', VG: 'USD', KY: 'KYD', BM: 'BMD', AW: 'AWG',
  CW: 'ANG', SX: 'ANG', TC: 'USD',

  // Pacific
  PG: 'PGK', SB: 'SBD', VU: 'VUV', WS: 'WST', TO: 'TOP',
  // Kiribati, Tuvalu and Nauru have no circulating central-bank currency of
  // their own and use AUD in practice.
  KI: 'AUD', TV: 'AUD', NR: 'AUD',
  FM: 'USD', MH: 'USD', PW: 'USD', PF: 'XPF', NC: 'XPF',

  // Danish territories
  GL: 'DKK', FO: 'DKK',
};

function countryCodeFrom(place) {
  const country = (place.addressComponents || []).find((component) =>
    (component.types || []).includes('country')
  );
  return country?.shortText || null;
}

function currencyForPlace(place) {
  const countryCode = countryCodeFrom(place);
  return countryCode ? CURRENCY_BY_COUNTRY[countryCode] || null : null;
}

const PRICE_LEVEL_LABELS = {
  PRICE_LEVEL_FREE: 'Budget-friendly',
  PRICE_LEVEL_INEXPENSIVE: 'Budget-friendly',
  PRICE_LEVEL_MODERATE: 'Moderate',
  PRICE_LEVEL_EXPENSIVE: 'Upscale',
  PRICE_LEVEL_VERY_EXPENSIVE: 'Luxury',
};

// Google's priceLevel is a free, already-fetched signal for which tier a
// hotel actually belongs in - used now instead of a confirmed real price,
// since we no longer price every candidate. Falls back to whichever
// tier-biased query surfaced the hotel when Places doesn't return a
// priceLevel at all (common for smaller properties).
const PRICE_LEVEL_TIER = {
  PRICE_LEVEL_FREE: 'Economy',
  PRICE_LEVEL_INEXPENSIVE: 'Economy',
  PRICE_LEVEL_MODERATE: 'Standard',
  PRICE_LEVEL_EXPENSIVE: 'Luxury',
  PRICE_LEVEL_VERY_EXPENSIVE: 'Luxury',
};

function tierFor(place, queryTier) {
  return PRICE_LEVEL_TIER[place.priceLevel] || queryTier;
}

// Restored 8 Sep 2026 to what it originally was: rating weighted by how many
// people left one. The photo-count version that sat here in between was written
// only because rating and userRatingCount had been cut from the mask as
// Enterprise-tier fields, and it did not work. Every real hotel has ten or more
// photos, so nearly all of them tied at the cap and both sorts below degenerated
// into "whatever order Google returned". That is how the Tokyo demo ended up in
// a hotel 10km from everything it then visited: it was not chosen, it was simply
// first. Aman Tokyo surviving a cut of the Standard tier was the same no-op.
//
// The log is what stops a 40,000-review chain outranking a 4.8-rated boutique on
// volume alone, while still separating somewhere people actually stay from
// somewhere with nine reviews and a 5.0. Photo count survives as the tiebreak,
// which is all it was ever good for.
function qualityScore(place) {
  const rating = typeof place.rating === 'number' ? place.rating : 0;
  const reviews = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;
  const popularity = rating * Math.log(reviews + 1);
  return popularity + Math.min((place.photos || []).length, 12) / 100;
}

// A hotel further out than this makes every day of the trip a commute, however
// well rated it is, because the itinerary bookends each day at the
// accommodation. Hotel Villa Fontaine Grand Haneda Airport is the case that
// forced this: genuinely a real, well-reviewed Tokyo hotel, and about 15km from
// everything a two-day Tokyo trip visits. Applied before the thin-tier widen
// below, so dropping an outlier gives the neutral query a chance to replace it
// rather than leaving a hole. Skipped entirely when the geocode failed - no
// centre means no honest opinion about distance, and failing open is better
// than emptying every tier.
const MAX_HOTEL_DISTANCE_METERS = 12000;

function withinCityRadius(place, centre) {
  if (!centre) return true;
  const location = locationOf(place);
  if (!location) return true;
  return haversineMeters(centre, location) <= MAX_HOTEL_DISTANCE_METERS;
}

function typeLabelFor(place) {
  const types = place.types || [];
  if (types.includes('resort_hotel')) return 'Resort';
  if (types.includes('bed_and_breakfast')) return 'Guesthouse';
  if (types.includes('extended_stay_hotel') || types.includes('apartment_hotel')) return 'Apart-hotel';
  return 'Hotel';
}

// Last resort only, for a place Google returned with no addressComponents at
// all. Kept deliberately crude: it takes the segment most likely to be an area
// name while skipping anything that is purely a street number, which is the
// specific failure the structured lookup exists to avoid.
function neighborhoodFromAddress(address) {
  if (!address) return null;
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d+[a-z]?$/i.test(part));
  return parts[1] || parts[0] || null;
}

function categoryTagFor(place) {
  const typeLabel = typeLabelFor(place);
  // Structured components first - see placeAddress.js for why the old
  // comma-split produced "Hotel · 32" on Spanish addresses.
  const area = neighbourhoodOf(place) || neighborhoodFromAddress(place.formattedAddress);
  return area ? `${typeLabel} · ${area}` : typeLabel;
}

// Google returns a place's photos most-liked first, and for a hotel that is
// usually the view OUT of it rather than the building. Every Tokyo option on the
// accommodation screen showed the Skytree at dusk; not one showed a hotel.
//
// There is no category on a Places photo, but there is an author. A photo the
// business uploaded is attributed to the business, a guest's is attributed to a
// person, so the hotel's own pictures can be preferred without guessing at
// content. Falls back to the first photo when the business has uploaded none,
// which is no worse than before (Akber, 8 Sep 2026).
function normalisedName(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function ownersOwnPhoto(place) {
  const owner = normalisedName(place.displayName?.text);
  if (owner.length < 4) return null;
  return (place.photos || []).find((photo) =>
    (photo.authorAttributions || []).some((author) => {
      const attributed = normalisedName(author.displayName);
      return attributed.length >= 4 && (attributed.includes(owner) || owner.includes(attributed));
    })
  ) || null;
}

function photoUrlFor(place) {
  const photos = place.photos;
  if (!photos || photos.length === 0) return null;
  const photo = ownersOwnPhoto(place) || photos[0];
  return '/api/place-photo?ref=' + encodeURIComponent(photo.name);
}

// Money is { currencyCode, units (int64 as string), nanos } - see
// https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#Money
function moneyToNumber(money) {
  if (!money) return null;
  const units = Number(money.units || 0);
  const nanos = Number(money.nanos || 0);
  return Math.round(units + nanos / 1e9);
}

// Places' general listed range for the property (not date-specific - see
// module header). endPrice can be legitimately unset ("more than X"), in
// which case there's no honest upper bound to show.
function priceRangeFromPlace(place) {
  const range = place.priceRange;
  if (!range?.startPrice) return null;
  const min = moneyToNumber(range.startPrice);
  const max = range.endPrice ? moneyToNumber(range.endPrice) : null;
  if (min == null) return null;
  return { min, max, currencyCode: range.startPrice.currencyCode };
}

// Cache each tier's hotel search keyed on the tier query + destination. The set
// of real hotels for "luxury hotel in Lisbon" is stable enough to reuse within
// the 30-day TTL, so a repeat visit to the Accommodation screen for the same
// destination is served from cache instead of re-billing three Text Search
// calls every time. Only a non-empty result is cached — an empty list (thin
// destination, or a transient miss) is left uncached so the widen-query
// fallback and future loads still get a real chance. Falls back to L1-only when
// KV is off. A non-OK response still throws from the fetcher and is not cached.
async function searchTier(destination, tierQuery, centre) {
  // v2 on purpose. The key used to be unversioned, and the entries under it
  // were written while the mask was cut back to Pro tier, so they carry no
  // rating, no userRatingCount and no priceLevel. Left unversioned, every
  // destination anyone had already looked up would keep serving those for the
  // rest of the 30-day TTL and none of the fixes above would appear. Same trap
  // as places:search:v2 in verifyPlace.js. Bump this whenever the field mask
  // or the location bias changes.
  return cached(
    'hotels',
    'v2|' + tierQuery + '|' + destination,
    () => fetchTier(destination, tierQuery, centre),
    { shouldCache: (r) => Array.isArray(r) && r.length > 0 }
  );
}

// The destination's own centre, used to bias all three tier searches toward it.
// A city centre does not move, so this is cached for a year; it is an
// Essentials-tier lookup (places.location only) either way. Failure is not
// fatal anywhere downstream - a null centre just means no bias and no distance
// filter, which is exactly how this file behaved before.
const CENTRE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 365;

async function centreOf(destination) {
  try {
    return await cached(
      'destination-centre',
      destination,
      () => geocodeDestination(destination),
      { ttl: CENTRE_CACHE_TTL_SECONDS }
    );
  } catch {
    return null;
  }
}

async function fetchTier(destination, tierQuery, centre) {
  const textQuery = tierQuery + ' ' + destination;
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY ?? '',
      // priceRange stays out. It is the one Enterprise field confirmed to always
      // return null for lodging (see module header, 2nd pass comment), so it costs
      // the same as the three below and returns nothing. priceRangeFromPlace()
      // still exists and still always returns null; the Claude estimate fallback
      // in estimatePriceRange.js is what actually fills the range.
      'X-Goog-FieldMask':
        // rating, userRatingCount and priceLevel restored 8 Sep 2026. All three are
        // Enterprise-tier, so asking for one costs the same as asking for all three
        // (~$0.025 a call, three calls per destination, cached 30 days). Without
        // priceLevel, tierFor() had nothing to read and fell back to whichever
        // biased query found the hotel first, which put Aman Tokyo in the Standard
        // tier. Without rating and userRatingCount, qualityScore could not rank.
        'places.id,places.displayName,places.formattedAddress,places.addressComponents,' +
        'places.photos,places.types,places.location,places.rating,places.userRatingCount,' +
        'places.priceLevel',
    },
    body: JSON.stringify({
      textQuery,
      includedType: 'lodging',
      languageCode: 'en',
      // Biases results toward the city centre rather than anywhere inside the
      // administrative boundary. "hotel in Tokyo" is a perfectly true description
      // of an airport hotel 15km out, and Google was returning one. Same circle
      // shape verifyPlace.js already uses for stops. A bias, not a restriction:
      // somewhere further out still surfaces when nothing closer matches.
      ...(centre
        ? {
            locationBias: {
              circle: {
                center: { latitude: centre.lat, longitude: centre.lng },
                radius: MAX_HOTEL_DISTANCE_METERS,
              },
            },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error('Places search failed with status ' + response.status);
  }

  const data = await response.json();
  return data.places || [];
}

// A tier-neutral fallback query, tried only when a tier comes up empty
// (small/less-touristy destinations, where "budget hotel in X" and "luxury
// hotel in X" mostly just match the same handful of real businesses anyway -
// the bias terms don't multiply real supply). Dropping the bias wording can
// surface listings Places didn't match against the biased phrasing but are
// still real, bookable lodging.
const WIDEN_QUERY = 'places to stay in';

function isUsablePlace(place) {
  // Name and location only. Rating is fetched again as of 8 Sep 2026 but is
  // deliberately not required here: a real hotel with no reviews yet is still a
  // real hotel, and qualityScore already ranks it last on its own.
  return Boolean(place.displayName?.text && place.location);
}

// Same Places location shape -> {lat, lng} conversion verifyPlace.js's own
// locationOf() uses - kept local rather than imported since this is the only
// place in this file that needs it, and importing across the two modules
// just for a three-line conversion isn't worth the coupling.
function locationOf(place) {
  if (!place.location) {
    return null;
  }
  return { lat: place.location.latitude, lng: place.location.longitude };
}

function toOption(place) {
  return {
    placeId: place.id,
    name: place.displayName.text,
    categoryTag: categoryTagFor(place),
    address: place.formattedAddress || null,
    rating: place.rating,
    ratingCount: place.userRatingCount,
    priceLevelLabel: PRICE_LEVEL_LABELS[place.priceLevel] || null,
    photoUrl: photoUrlFor(place),
    // Real coordinates for the selected hotel - added 9 Jul 2026 so the
    // itinerary generation pipeline can use the accommodation as a genuine
    // routing anchor (bookending every day's schedule) instead of just a
    // name string with no way to compute real travel time to/from it.
    location: locationOf(place),
  };
}

// Real min-max range for a tier, derived from Places' own priceRange on the
// hotels actually shown for it (not every pooled candidate, though there's
// no extra cost either way now - see module header). Returns null if none
// of the shown hotels have a priceRange - which, confirmed empirically, is
// currently ALWAYS the case for lodging (see estimatePriceRange.js for the
// visibly-labeled fallback this feeds into).
function priceRangeForShown(places) {
  const ranges = places.map(priceRangeFromPlace).filter(Boolean);
  if (ranges.length === 0) return null;
  const mins = ranges.map((r) => r.min);
  const maxes = ranges.filter((r) => r.max != null).map((r) => r.max);
  return {
    min: Math.min(...mins),
    // Fall back to the largest known min if every range was open-ended
    // ("more than X") - still an honest, non-fabricated number.
    max: maxes.length > 0 ? Math.max(...maxes) : Math.max(...mins),
    currencyCode: ranges[0].currencyCode,
    estimated: false,
  };
}

export async function searchAccommodations({ destination, checkInDate, checkOutDate }) {
  // Run all three tier-biased searches to get a diverse candidate pool (a
  // "luxury hotel in X" query surfaces genuinely upscale properties a
  // neutral search wouldn't rank highly).
  const centre = await centreOf(destination);
  const resultsByTier = await Promise.all(
    TIERS.map((tier) => searchTier(destination, TIER_QUERY_PREFIX[tier], centre))
  );

  // Tier placement: Google's own priceLevel first, falling back to which
  // biased query surfaced the hotel. A hotel found by multiple queries keeps
  // whichever tier assignment it got first (iteration order below).
  const byPlaceId = new Map();
  TIERS.forEach((tier, index) => {
    const usable = resultsByTier[index]
      .filter((place) => isUsablePlace(place) && withinCityRadius(place, centre))
      .sort((a, b) => qualityScore(b) - qualityScore(a));
    for (const place of usable) {
      if (byPlaceId.has(place.id)) continue;
      byPlaceId.set(place.id, { place, tier: tierFor(place, tier) });
    }
  });

  const buckets = { Economy: [], Standard: [], Luxury: [] };
  for (const { place, tier } of byPlaceId.values()) {
    buckets[tier].push(place);
  }

  // Widen for any tier that has fewer than SHOWN_PER_TIER results - covers
  // both completely empty tiers and "thin" tiers (e.g. only 1-2 hotels
  // returned by the biased query). A destination with real inventory can
  // still come up thin because the biased phrasing didn't match local
  // listings; a neutral query often surfaces what the biased one missed.
  const thinTiers = TIERS.filter((tier) => buckets[tier].length < SHOWN_PER_TIER);
  if (thinTiers.length > 0) {
    const widenedPlaces = (await searchTier(destination, WIDEN_QUERY, centre))
      .filter(
        (place) =>
          isUsablePlace(place) && withinCityRadius(place, centre) && !byPlaceId.has(place.id)
      )
      .sort((a, b) => qualityScore(b) - qualityScore(a));
    for (const place of widenedPlaces) {
      // Neutral query has no query-tier bias of its own, so default the
      // fallback (when Places has no priceLevel either) to Standard.
      const tier = tierFor(place, 'Standard');
      if (!thinTiers.includes(tier)) continue;
      // Only fill up to SHOWN_PER_TIER slots per tier - don't overfill a
      // tier that already had some results just because the widen query
      // happened to return more of the same tier.
      if (buckets[tier].length >= SHOWN_PER_TIER) continue;
      byPlaceId.set(place.id, { place, tier });
      buckets[tier].push(place);
    }
  }

  const options = {};
  const priceRangeByTier = {};
  const shownPlaces: any[] = [];

  for (const tier of TIERS) {
    buckets[tier].sort((a, b) => qualityScore(b) - qualityScore(a));
    const shown = buckets[tier].slice(0, SHOWN_PER_TIER);
    options[tier] = shown.map(toOption);
    priceRangeByTier[tier] = priceRangeForShown(shown);
    shownPlaces.push(...shown);
  }

  // Destination's local currency - tried from the country of the shown
  // hotels first (always available, static lookup), falling back to
  // whatever currency a priceRange happened to report if the country
  // lookup somehow comes up empty (unrecognized/missing country code).
  const destinationCurrency =
    shownPlaces.map(currencyForPlace).find(Boolean) ||
    TIERS.map((tier) => priceRangeByTier[tier]?.currencyCode).find(Boolean) ||
    null;

  // Claude-estimated fallback for any tier Places didn't give a real range
  // for (in practice: every tier, every time - see module header). Skipped
  // entirely if we don't even know the destination's currency, since there'd
  // be nothing honest to label the numbers with. Never lets a failure here
  // affect the hotels themselves - a missing estimate just leaves that tier
  // at null ("Not available"), same as before this pass existed.
  const missingTiers = TIERS.filter((tier) => !priceRangeByTier[tier] && options[tier]?.length > 0);
  if (missingTiers.length > 0 && destinationCurrency) {
    try {
      const estimates = await estimatePriceRanges({
        destination,
        currencyCode: destinationCurrency,
        hotelsByTier: Object.fromEntries(missingTiers.map((tier) => [tier, options[tier]])),
      });
      for (const tier of missingTiers) {
        const estimate = estimates?.[tier];
        if (typeof estimate?.min === 'number' && typeof estimate?.max === 'number') {
          priceRangeByTier[tier] = {
            min: Math.round(estimate.min),
            max: Math.round(estimate.max),
            currencyCode: destinationCurrency,
            estimated: true,
          };
        }
      }
    } catch (error) {
      console.error('[hotelSearch] price estimate failed:', error);
    }
  }

  return { options, priceRangeByTier, destinationCurrency };
}
