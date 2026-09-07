// What the traveller's budget band means for the places a day is built from.
//
// The band used to be a single context line in the prompt - "Budget band:
// Economy" - with nothing telling the model what to do about it and nothing
// downstream checking. Accommodation was tiered properly by hotelSearch.ts;
// everything else in the trip ignored the answer, so a Luxury trip and an
// Economy trip could resolve to the same restaurants, and a substitution (which
// happens long after the model is gone) had no price signal at all.
//
// Google's priceLevel is the only price signal available. It is free with the
// Enterprise field mask the place search already pays for, and it exists on
// restaurants and bars far more often than on museums and parks, which suits the
// problem: dining is where a budget band actually shows up.

// Google returns these as strings on Places API (New).
const PRICE_LEVEL_VALUES: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// The bands overlap on purpose. A Standard trip in a neighbourhood that only has
// cheap places should take them; the job is to stop a Luxury trip eating at a
// chain and an Economy trip being sent somewhere with a tasting menu, not to
// enforce a price on every stop.
const BAND_LEVELS: Record<string, number[]> = {
  economy: [0, 1, 2],
  standard: [1, 2, 3],
  luxury: [3, 4],
};

export function levelsFor(budget) {
  const key = String(budget || '').trim().toLowerCase();
  return BAND_LEVELS[key] || null;
}

export function priceLevelOf(candidate) {
  const raw = candidate ? candidate.priceLevel : null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw in PRICE_LEVEL_VALUES) return PRICE_LEVEL_VALUES[raw];
  return null;
}

// Reorders, never filters. Silence is not evidence, the same rule the opening
// hours check follows: plenty of genuinely good small restaurants carry no
// priceLevel at all, and ranking those last would quietly rebuild the
// chain-branch problem this codebase already fixed once. So an unpriced place
// sits behind an on-band match and ahead of an off-band one, and if nothing is
// on band the list comes back in the order it arrived.
//
// Stable within each rank: candidates arrive sorted by qualityScore and that
// order is preserved, so this expresses a budget preference without throwing
// away the quality ranking underneath it.
export function sortByBudgetFit(candidates, budget) {
  const levels = levelsFor(budget);
  if (!levels || !Array.isArray(candidates)) return candidates || [];

  const rank = (candidate) => {
    const level = priceLevelOf(candidate);
    if (level === null) return 1;
    return levels.includes(level) ? 0 : 2;
  };

  return candidates
    .map((candidate, index) => ({ candidate, index, rank: rank(candidate) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.candidate);
}
