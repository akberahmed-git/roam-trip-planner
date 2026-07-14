// Server-side proxy for Google Places Autocomplete (New). Keeps the API key
// off the client, same pattern as verifyPlace.js and trendingLocations.js.
//
// When the user types a country name we intercept and return real city results
// via Google Places Text Search instead of prefix-match noise. Country names
// are detected locally (no external API dependency).

// ── All country names (ISO 3166-1 + common aliases) ─────────────────────────
const COUNTRY_NAMES = new Set([
  'afghanistan','albania','algeria','andorra','angola','antigua and barbuda',
  'argentina','armenia','australia','austria','azerbaijan','bahamas','bahrain',
  'bangladesh','barbados','belarus','belgium','belize','benin','bhutan',
  'bolivia','bosnia and herzegovina','botswana','brazil','brunei','bulgaria',
  'burkina faso','burundi','cabo verde','cambodia','cameroon','canada',
  'central african republic','chad','chile','china','colombia','comoros',
  'congo','costa rica','croatia','cuba','cyprus','czechia','czech republic',
  'denmark','djibouti','dominica','dominican republic','ecuador','egypt',
  'el salvador','equatorial guinea','eritrea','estonia','eswatini','ethiopia',
  'fiji','finland','france','gabon','gambia','georgia','germany','ghana',
  'greece','grenada','guatemala','guinea','guinea-bissau','guyana','haiti',
  'honduras','hungary','iceland','india','indonesia','iran','iraq','ireland',
  'israel','italy','jamaica','japan','jordan','kazakhstan','kenya','kiribati',
  'kuwait','kyrgyzstan','laos','latvia','lebanon','lesotho','liberia','libya',
  'liechtenstein','lithuania','luxembourg','madagascar','malawi','malaysia',
  'maldives','mali','malta','marshall islands','mauritania','mauritius',
  'mexico','micronesia','moldova','monaco','mongolia','montenegro','morocco',
  'mozambique','myanmar','namibia','nauru','nepal','netherlands','new zealand',
  'nicaragua','niger','nigeria','north korea','north macedonia','norway',
  'oman','pakistan','palau','palestine','panama','papua new guinea','paraguay',
  'peru','philippines','poland','portugal','qatar','romania','russia','rwanda',
  'saint kitts and nevis','saint lucia','saint vincent and the grenadines',
  'samoa','san marino','sao tome and principe','saudi arabia','senegal',
  'serbia','seychelles','sierra leone','singapore','slovakia','slovenia',
  'solomon islands','somalia','south africa','south korea','south sudan',
  'spain','sri lanka','sudan','suriname','sweden','switzerland','syria',
  'taiwan','tajikistan','tanzania','thailand','timor-leste','togo','tonga',
  'trinidad and tobago','tunisia','turkey','turkmenistan','tuvalu','uganda',
  'ukraine','united arab emirates','united kingdom','united states',
  'uruguay','uzbekistan','vanuatu','venezuela','vietnam','yemen','zambia',
  'zimbabwe',
  // Common aliases
  'usa','us','uk','uae','england','scotland','wales','hong kong','macau',
  'ivory coast','bali','puerto rico','taiwan',
])

// Proper title-case for display (e.g. "united states" → "United States")
function toTitleCase(str) {
  const lowercase = ['and','of','the','in','de']
  return str
    .split(' ')
    .map((word, i) =>
      i === 0 || !lowercase.includes(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(' ')
}

function isCountryName(input) {
  return COUNTRY_NAMES.has(input.toLowerCase().trim())
}

// ── Google Places Text Search ────────────────────────────────────────────────
// Returns popularity-ranked cities using Google's own signals.
// No includedType filter — we post-filter by types to avoid over-restriction
// that causes wrong results in some countries.
async function searchCitiesInCountry(countryName) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName',
    },
    body: JSON.stringify({
      textQuery: `most visited cities in ${countryName}`,
      pageSize: 8,
    }),
  })

  if (!res.ok) return []

  const data = await res.json()
  const countryLower = countryName.toLowerCase()

  return (data.places || [])
    .filter((place) => {
      // Skip results whose display name matches the country itself (avoids "France, France")
      const nameL = (place.displayName?.text || '').toLowerCase()
      return nameL !== countryLower && nameL.length > 0
    })
    .map((place) => ({
      placeId: place.id,
      text: `${place.displayName.text}, ${countryName}`,
      matches: [],
    }))
    .slice(0, 5)
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

  if (isCountryName(trimmed)) {
    const countryName = toTitleCase(trimmed)
    const cityResults = await searchCitiesInCountry(countryName)
    // Only return results if we got meaningful cities — don't fall back to
    // autocomplete which would show noise like tiny villages.
    return cityResults
  }

  return googleAutocomplete(trimmed)
}
