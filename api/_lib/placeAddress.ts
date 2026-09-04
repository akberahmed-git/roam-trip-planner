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
//
// Bare 'sublocality' is deliberately NOT in this list. Japan tags block numbers
// as sublocality_level_3 and _4 AND as plain 'sublocality', so matching the
// generic type picked up "1", "15", "36" and produced "Landmark · 1" - the
// exact street-number bug this module exists to remove, just in a different
// country. Only the levels that carry a real area name are listed.
const AREA_COMPONENT_TYPES = [
  'sublocality_level_1',
  'sublocality_level_2',
  'neighborhood',
  'postal_town',
  'locality',
  'administrative_area_level_2',
];

// A component only counts as an area name if it reads like one. Guards against
// anything numeric slipping through from a country whose address format we
// haven't seen: bare numbers, "1-chōme", "2F". Requires at least one letter and
// rejects a value that starts with a digit, which no real district name does.
function looksLikeAreaName(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  if (/^\d/.test(trimmed)) return false;
  return /\p{L}/u.test(trimmed);
}

export function neighbourhoodOf(place) {
  const components = place?.addressComponents;
  if (!Array.isArray(components)) return null;

  for (const wanted of AREA_COMPONENT_TYPES) {
    for (const component of components) {
      if (!Array.isArray(component.types) || !component.types.includes(wanted)) continue;
      const name = component.longText || component.shortText;
      if (looksLikeAreaName(name)) return name;
    }
  }
  return null;
}
