// Server-side proxy for Google Places Autocomplete (New). Keeps the API key
// off the client, same pattern as verifyPlace.js and trendingLocations.js.
//
// We restrict to geographic results (cities/regions/countries) since this
// powers the "Destination" field, not a general place search.
export async function fetchDestinationSuggestions(input) {
  const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: ['locality', 'administrative_area_level_1', 'country', 'sublocality'],
    }),
  });

  if (!response.ok) {
    throw new Error('Autocomplete request failed with status ' + response.status);
  }

  const data = await response.json();
  const suggestions = data.suggestions || [];

  return suggestions
    .map((entry) => entry.placePrediction)
    .filter(Boolean)
    .map((prediction) => ({
      placeId: prediction.placeId,
      text: prediction.text?.text || '',
      matches: prediction.text?.matches || [],
    }));
}
