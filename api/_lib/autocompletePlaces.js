// Server-side proxy for Google Places Autocomplete (New). Keeps the API key
// off the client, same pattern as verifyPlace.js and trendingLocations.js.
//
// When the user types a country name we:
//   1. Detect it via the free RestCountries API (no key, covers all ~250 countries)
//   2. Run a Google Places Text Search for "popular cities in <country>"
//      which returns real, popularity-ranked city results automatically
// For all other input we run normal Google Places Autocomplete restricted to
// city/region types — 'country' is intentionally excluded so users must pick
// a specific place, not just "France" or "Japan".

// ── Country detection ────────────────────────────────────────────────────────
// Uses fullText=true so only an exact match (e.g. "France") triggers this
// path, not a partial like "Fra". Returns { name, capital } or null.
async function detectCountry(input) {
  try {
    const res = await fetch(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(input)}?fullText=true&fields=name,capital`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const country = data[0]
    return {
      name: country.name?.common || input,
      capital: country.capital?.[0] || null,
    }
  } catch {
    return null
  }
}

// ── Google Places Text Search ────────────────────────────────────────────────
// Returns the most popular cities in a country, ranked by Google's own
// relevance/popularity signals. Only fires when country input is detected.
async function searchCitiesInCountry(countryName) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.types',
    },
    body: JSON.stringify({
      textQuery: `popular cities in ${countryName}`,
      includedType: 'locality',
      pageSize: 5,
    }),
  })

  if (!res.ok) return []

  const data = await res.json()
  return (data.places || []).map((place) => ({
    placeId: place.id,
    text: place.displayName?.text
      ? `${place.displayName.text}, ${countryName}`
      : (place.formattedAddress || ''),
    matches: [],
  })).filter((s) => s.text)
}

// ── Google Places Autocomplete ───────────────────────────────────────────────
// Standard city/region autocomplete. 'country' type excluded intentionally.
async function googleAutocomplete(input) {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: ['locality', 'administrative_area_level_1', 'sublocality'],
    }),
  })

  if (!res.ok) throw new Error('Autocomplete request failed with status ' + res.status)

  const data = await res.json()
  return (data.suggestions || [])
    .map((entry) => entry.placePrediction)
    .filter(Boolean)
    .map((prediction) => ({
      placeId: prediction.placeId,
      text: prediction.text?.text || '',
      matches: prediction.text?.matches || [],
    }))
    .filter((s) => s.text)
}

// ── Main export ──────────────────────────────────────────────────────────────
export async function fetchDestinationSuggestions(input) {
  const trimmed = input.trim()

  // Run country detection and normal autocomplete in parallel so there's no
  // extra latency on the non-country path.
  const [country, googleResults] = await Promise.all([
    detectCountry(trimmed),
    googleAutocomplete(trimmed),
  ])

  if (country) {
    // Input is a country name — return Text Search results (most popular cities
    // first), falling back to Google Autocomplete results for that input if
    // the Text Search comes back empty.
    const cityResults = await searchCitiesInCountry(country.name)
    if (cityResults.length > 0) return cityResults

    // Fallback: filter Google results to drop any bare country-level result
    return googleResults.filter((r) => r.text.includes(','))
  }

  // Normal path — return Google Autocomplete results as-is.
  return googleResults
}
