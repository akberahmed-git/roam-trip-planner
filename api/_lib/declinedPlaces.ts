// Places the traveller has said no to, by name. Not the same thing as a place
// that fails a rule.
//
// Tokyo Tower shipped three times. Twice it was "fixed" by taking it out of the
// modern-architecture matcher, which only made it invisible to the balance
// rules: it still filled a slot, and on the third draft it survived because the
// day's one uncovered chip was already at its plan cap, so the swap had nothing
// to buy and left it where it was. Excluding a place from an interest is not
// banning it.
//
// Its own module, with no imports, because both readers need it and
// fixedSchedule.ts cannot import generate-resolved-itinerary.ts. A rule living
// in two files with one of them getting fixed is the single most expensive
// mistake in this codebase's history (Akber, 8 Sep 2026).
export const DECLINED_PLACE_PATTERNS = [/\btokyo tower\b/i];

export function isDeclinedPlace(name) {
  return DECLINED_PLACE_PATTERNS.some((pattern) => pattern.test(String(name || '')));
}

// A hotel is where the traveller sleeps, not somewhere to go. Two hotels shipped
// back to back on a Monaco afternoon because the model named them for their
// beach club and their hairpin, Google resolved them as lodging, and nothing
// asked. A place that is lodging AND something else (a hotel bar, a hotel
// restaurant, a casino inside a hotel) keeps its other identity and is fine;
// this rejects the ones that are only a place to stay (Akber, 9 Sep 2026).
const LODGING_TYPES = new Set([
  'hotel', 'lodging', 'resort_hotel', 'motel', 'hostel', 'guest_house', 'bed_and_breakfast',
  'extended_stay_hotel', 'inn', 'campground', 'rv_park', 'private_guest_room', 'cottage', 'japanese_inn', 'ryokan',
]);
const NOT_ONLY_LODGING_TYPES = new Set([
  'restaurant', 'bar', 'cafe', 'coffee_shop', 'night_club', 'casino', 'spa', 'museum', 'art_gallery',
  'tourist_attraction', 'historical_landmark', 'observation_deck', 'marina', 'beach', 'golf_course',
  'amusement_park', 'aquarium', 'zoo', 'wellness_center', 'rooftop_bar', 'wine_bar', 'fine_dining_restaurant',
]);

export function isLodgingOnly(types) {
  const list = Array.isArray(types) ? types : [];
  return list.some((t) => LODGING_TYPES.has(t)) && !list.some((t) => NOT_ONLY_LODGING_TYPES.has(t));
}
