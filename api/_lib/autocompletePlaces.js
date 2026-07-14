// Server-side proxy for Google Places Autocomplete (New). Keeps the API key
// off the client, same pattern as verifyPlace.js and trendingLocations.js.
//
// When the user types a country name we intercept it and return real city
// results via Google Places Text Search instead — so "France" shows Paris,
// Nice, Lyon etc. rather than the country itself or prefix noise like
// "Francestown, NH". Country detection uses a local name list (no external
// API dependency) and Google handles all actual place data.

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
  'usa','us','uk','uae','ussr','south korea','north korea','ivory coast',
  'england','scotland','wales','northern ireland','hong kong','macau',
  'palestine','kosovo','taiwan','puerto rico','bali',
])

function isCountryName(input) {
  return COUNTRY_NAMES.has(input.toLowerCase().trim())
}

// ── Google Places Text Search ────────────────────────────────────────────────
// Returns popularity-ranked cities for a country using Google's own signals.
async function searchCitiesInCountry(countryName) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery: `popular cities in ${countryName}`,
      includedType: 'locality',
      pageSize: 5,
    }),
  })

  if (!res.ok) return []

  const data = await res.json()
  return (data.places || [])
    .map((place) => ({
      placeId: place.id,
      text: place.displayName?.text
        ? `${place.displayName.text}, ${countryName}`
        : (place.formattedAddress || ''),
      matches: [],
    }))
    .filter((s) => s.text)
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
    // Capitalise properly for the Google query and display text
    const displayName = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    const cityResults = await searchCitiesInCountry(displayName)
    if (cityResults.length > 0) return cityResults
    // Fallback to autocomplete if Text Search fails
    const fallback = await googleAutocomplete(trimmed)
    return fallback.filter((r) => r.text.includes(','))
  }

  return googleAutocomplete(trimmed)
}
