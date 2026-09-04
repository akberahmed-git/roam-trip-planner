// Where a place is, in words a person would use, taken from Google's structured
// addressComponents rather than parsed out of the formatted address string.
//
// Shared by verifyPlace.js (itinerary stops) and hotelSearch.js (accommodation
// cards) so both compose the same "Type · Area" line the same way.
//
// The bug this replaces: hotelSearch's neighborhoodFrom() split
// formattedAddress on commas and took the second segment, on the assumption
// that an address reads "Street, Neighbourhood, Country". Spanish addresses put
// the street number in its own segment, so
//
//   "Pg. de l'Albereda, 32, El Pla del Real, 46023 València, Valencia, Spain"
//
// yielded "32", and the card read "Hotel · 32". Three Valencia hotels out of
// three did this. Component order and count vary by country, so no fixed index
// is right everywhere - the component's own type is the only reliable signal.

// Narrowest first: a district reads better on a card than a city ("Hotel · El
// Pla del Real" over "Hotel · Valencia"), but a city still beats nothing.
const AREA_COMPONENT_TYPES = [
  'sublocality_level_1',
  'sublocality',
  'neighborhood',
  'postal_town',
  'locality',
  'administrative_area_level_2',
];

export function neighbourhoodOf(place) {
  const components = place?.addressComponents;
  if (!Array.isArray(components)) return null;

  for (const wanted of AREA_COMPONENT_TYPES) {
    const match = components.find(
      (component) => Array.isArray(component.types) && component.types.includes(wanted)
    );
    const name = match?.longText || match?.shortText;
    if (name) return name;
  }
  return null;
}
