// Server-side proxy for Google Places Autocomplete (New). Keeps the API key
// off the client, same pattern as verifyPlace.js and trendingLocations.js.
//
// We restrict to city/region-level results only — countries are excluded so
// the user must pick a specific place, not just "France" or "Japan".
// When the input matches a country name, we inject that country's most popular
// destination and capital at the top of the list before Google's results.

// Country name → [most popular destination, capital (if different)]
// Covers the most commonly searched travel destinations.
const COUNTRY_CITIES = {
  france: ['Paris, France', 'Nice, France', 'Lyon, France'],
  japan: ['Tokyo, Japan', 'Kyoto, Japan', 'Osaka, Japan'],
  italy: ['Rome, Italy', 'Florence, Italy', 'Venice, Italy', 'Milan, Italy'],
  spain: ['Barcelona, Spain', 'Madrid, Spain', 'Seville, Spain'],
  thailand: ['Bangkok, Thailand', 'Chiang Mai, Thailand', 'Phuket, Thailand'],
  greece: ['Athens, Greece', 'Santorini, Greece', 'Mykonos, Greece'],
  portugal: ['Lisbon, Portugal', 'Porto, Portugal', 'Algarve, Portugal'],
  germany: ['Berlin, Germany', 'Munich, Germany', 'Hamburg, Germany'],
  'united kingdom': ['London, United Kingdom', 'Edinburgh, United Kingdom', 'Manchester, United Kingdom'],
  uk: ['London, United Kingdom', 'Edinburgh, United Kingdom', 'Manchester, United Kingdom'],
  england: ['London, England', 'Manchester, England', 'Birmingham, England'],
  usa: ['New York, USA', 'Los Angeles, USA', 'Miami, USA'],
  'united states': ['New York, USA', 'Los Angeles, USA', 'Miami, USA'],
  america: ['New York, USA', 'Los Angeles, USA', 'Miami, USA'],
  india: ['Mumbai, India', 'Delhi, India', 'Goa, India', 'Jaipur, India'],
  indonesia: ['Bali, Indonesia', 'Jakarta, Indonesia', 'Yogyakarta, Indonesia'],
  bali: ['Bali, Indonesia'],
  vietnam: ['Hanoi, Vietnam', 'Ho Chi Minh City, Vietnam', 'Hoi An, Vietnam'],
  cambodia: ['Siem Reap, Cambodia', 'Phnom Penh, Cambodia'],
  morocco: ['Marrakech, Morocco', 'Fes, Morocco', 'Casablanca, Morocco'],
  turkey: ['Istanbul, Turkey', 'Cappadocia, Turkey', 'Bodrum, Turkey'],
  mexico: ['Mexico City, Mexico', 'Cancún, Mexico', 'Oaxaca, Mexico'],
  brazil: ['Rio de Janeiro, Brazil', 'São Paulo, Brazil', 'Salvador, Brazil'],
  australia: ['Sydney, Australia', 'Melbourne, Australia', 'Brisbane, Australia'],
  'new zealand': ['Auckland, New Zealand', 'Queenstown, New Zealand', 'Wellington, New Zealand'],
  netherlands: ['Amsterdam, Netherlands', 'Rotterdam, Netherlands'],
  austria: ['Vienna, Austria', 'Salzburg, Austria', 'Innsbruck, Austria'],
  switzerland: ['Zurich, Switzerland', 'Geneva, Switzerland', 'Lucerne, Switzerland'],
  croatia: ['Dubrovnik, Croatia', 'Split, Croatia', 'Zagreb, Croatia'],
  maldives: ['Malé, Maldives', 'Maafushi, Maldives'],
  uae: ['Dubai, UAE', 'Abu Dhabi, UAE'],
  'united arab emirates': ['Dubai, UAE', 'Abu Dhabi, UAE'],
  egypt: ['Cairo, Egypt', 'Luxor, Egypt', 'Hurghada, Egypt'],
  kenya: ['Nairobi, Kenya', 'Mombasa, Kenya', 'Maasai Mara, Kenya'],
  south africa: ['Cape Town, South Africa', 'Johannesburg, South Africa', 'Durban, South Africa'],
  argentina: ['Buenos Aires, Argentina', 'Mendoza, Argentina', 'Patagonia, Argentina'],
  peru: ['Lima, Peru', 'Cusco, Peru', 'Machu Picchu, Peru'],
  colombia: ['Bogotá, Colombia', 'Medellín, Colombia', 'Cartagena, Colombia'],
  iceland: ['Reykjavik, Iceland', 'Akureyri, Iceland'],
  norway: ['Oslo, Norway', 'Bergen, Norway', 'Tromsø, Norway'],
  sweden: ['Stockholm, Sweden', 'Gothenburg, Sweden', 'Malmö, Sweden'],
  denmark: ['Copenhagen, Denmark', 'Aarhus, Denmark'],
  poland: ['Kraków, Poland', 'Warsaw, Poland', 'Gdańsk, Poland'],
  czechia: ['Prague, Czechia', 'Brno, Czechia'],
  'czech republic': ['Prague, Czech Republic', 'Brno, Czech Republic'],
  hungary: ['Budapest, Hungary', 'Debrecen, Hungary'],
  singapore: ['Singapore'],
  china: ['Beijing, China', 'Shanghai, China', 'Hong Kong', 'Chengdu, China'],
  'hong kong': ['Hong Kong'],
  'south korea': ['Seoul, South Korea', 'Busan, South Korea', 'Jeju, South Korea'],
  korea: ['Seoul, South Korea', 'Busan, South Korea'],
  taiwan: ['Taipei, Taiwan', 'Tainan, Taiwan'],
  malaysia: ['Kuala Lumpur, Malaysia', 'Penang, Malaysia', 'Langkawi, Malaysia'],
  sri lanka: ['Colombo, Sri Lanka', 'Galle, Sri Lanka', 'Kandy, Sri Lanka'],
  nepal: ['Kathmandu, Nepal', 'Pokhara, Nepal'],
  pakistan: ['Lahore, Pakistan', 'Islamabad, Pakistan', 'Karachi, Pakistan'],
  albania: ['Tirana, Albania', 'Ksamil, Albania', 'Saranda, Albania', 'Berat, Albania'],
  georgia: ['Tbilisi, Georgia', 'Batumi, Georgia', 'Kutaisi, Georgia'],
  armenia: ['Yerevan, Armenia', 'Gyumri, Armenia'],
  azerbaijan: ['Baku, Azerbaijan', 'Sheki, Azerbaijan'],
  jordan: ['Amman, Jordan', 'Petra, Jordan', 'Aqaba, Jordan'],
  israel: ['Tel Aviv, Israel', 'Jerusalem, Israel', 'Haifa, Israel'],
  iran: ['Tehran, Iran', 'Isfahan, Iran', 'Shiraz, Iran'],
  russia: ['Moscow, Russia', 'St. Petersburg, Russia'],
  ukraine: ['Kyiv, Ukraine', 'Lviv, Ukraine'],
  canada: ['Toronto, Canada', 'Vancouver, Canada', 'Montreal, Canada'],
  cuba: ['Havana, Cuba', 'Trinidad, Cuba'],
  costa rica: ['San José, Costa Rica', 'Tamarindo, Costa Rica', 'Manuel Antonio, Costa Rica'],
  chile: ['Santiago, Chile', 'Valparaíso, Chile', 'Patagonia, Chile'],
}

async function googleAutocomplete(input) {
  const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify({
      input,
      // 'country' intentionally excluded — users must pick a specific city/region
      includedPrimaryTypes: ['locality', 'administrative_area_level_1', 'sublocality'],
    }),
  })

  if (!response.ok) {
    throw new Error('Autocomplete request failed with status ' + response.status)
  }

  const data = await response.json()
  return (data.suggestions || [])
    .map((entry) => entry.placePrediction)
    .filter(Boolean)
    .map((prediction) => ({
      placeId: prediction.placeId,
      text: prediction.text?.text || '',
      matches: prediction.text?.matches || [],
    }))
}

export async function fetchDestinationSuggestions(input) {
  const normalised = input.trim().toLowerCase()

  // Check if the input matches a country name exactly (or close to it)
  const countryCities = COUNTRY_CITIES[normalised] || null

  if (countryCities) {
    // Input is a country name — return the curated city list only.
    // Don't call Google with the country name as it won't return useful cities.
    return countryCities.map((city) => ({
      placeId: null,
      text: city,
      matches: [{ startOffset: 0, endOffset: 0 }],
    }))
  }

  // Normal input — call Google and filter out any country-level results that
  // sneak through (safety net in case Google ignores our type filter).
  const results = await googleAutocomplete(input)
  return results.filter((r) => {
    // Drop results that are just a country name with no city component
    // e.g. "France" but keep "Paris, France"
    return r.text.includes(',') || !Object.keys(COUNTRY_CITIES).some(
      (country) => r.text.toLowerCase() === country
    )
  })
}
