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

function qualityScore(place) {
  const rating = place.rating || 0;
  const count = place.userRatingCount || 0;
  return rating * Math.log(count + 1);
}

function typeLabelFor(place) {
  const types = place.types || [];
  if (types.includes('resort_hotel')) return 'Resort';
  if (types.includes('bed_and_breakfast')) return 'Guesthouse';
  if (types.includes('extended_stay_hotel') || types.includes('apartment_hotel')) return 'Apart-hotel';
  return 'Hotel';
}

function neighborhoodFrom(address) {
  if (!address) return null;
  // formattedAddress is "Street, Neighborhood/City, Country" - the first
  // segment is usually the street, so prefer the second if present.
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  return parts[1] || parts[0] || null;
}

function categoryTagFor(place) {
  const typeLabel = typeLabelFor(place);
  const area = neighborhoodFrom(place.formattedAddress);
  return area ? `${typeLabel} · ${area}` : typeLabel;
}

function photoUrlFor(place) {
  const photos = place.photos;
  if (!photos || photos.length === 0) return null;
  return '/api/place-photo?ref=' + encodeURIComponent(photos[0].name);
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

async function searchTier(destination, tierQuery) {
  const textQuery = tierQuery + ' ' + destination;
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.rating,places.userRatingCount,places.photos,places.priceLevel,places.priceRange,places.types,places.location',
    },
    body: JSON.stringify({ textQuery, includedType: 'lodging' }),
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
  return Boolean(place.displayName?.text && place.rating && place.userRatingCount);
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
  const resultsByTier = await Promise.all(
    TIERS.map((tier) => searchTier(destination, TIER_QUERY_PREFIX[tier]))
  );

  // Tier placement: Google's own priceLevel first, falling back to which
  // biased query surfaced the hotel. A hotel found by multiple queries keeps
  // whichever tier assignment it got first (iteration order below).
  const byPlaceId = new Map();
  TIERS.forEach((tier, index) => {
    const usable = resultsByTier[index]
      .filter(isUsablePlace)
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

  // Widen once for any tier that came up completely empty - a destination
  // with real inventory can still leave one tier at zero purely because the
  // biased query phrasing didn't match local listings.
  const emptyTiers = TIERS.filter((tier) => buckets[tier].length === 0);
  if (emptyTiers.length > 0) {
    const widenedPlaces = (await searchTier(destination, WIDEN_QUERY))
      .filter((place) => isUsablePlace(place) && !byPlaceId.has(place.id));
    for (const place of widenedPlaces) {
      // Neutral query has no query-tier bias of its own, so default the
      // fallback (when Places has no priceLevel either) to Standard.
      const tier = tierFor(place, 'Standard');
      if (!emptyTiers.includes(tier)) continue;
      byPlaceId.set(place.id, { place, tier });
      buckets[tier].push(place);
    }
  }

  const options = {};
  const priceRangeByTier = {};
  const shownPlaces = [];

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
