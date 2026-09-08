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
