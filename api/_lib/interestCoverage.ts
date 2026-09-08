// Whether a finished itinerary actually delivers the interests the traveller
// chose.
//
// The prompt has asked for this since 4 Sep and calls it "strictly enforced",
// which was aspirational: nothing ever checked. A Tokyo trip with Nightlife
// selected came back with no night venue at all in either variant, and the demo
// audit passed it because the word "Club" appeared in a restaurant's name
// (Akber, 7 Sep 2026).
//
// Matching is on Google's own place types first, because they are the only
// signal that survives contact with a real place. The category tag cannot do it:
// it maps church, place_of_worship, historical_landmark and tourist_attraction
// all onto "Landmark", so a temple and a war memorial come out identical.
//
// Keywords are the fallback, and they exist because two of these interests have
// no type of their own. Google has no "anime shop" and no "modern architecture";
// those are cultural categories, not place categories, so a name and description
// are the only evidence available.

const INTEREST_SIGNALS = {
  'temples & shrines': {
    types: ['place_of_worship', 'church', 'hindu_temple', 'mosque', 'synagogue', 'shinto_shrine', 'buddhist_temple'],
    keywords: ['temple', 'shrine', 'jinja', 'jingu', 'basilica', 'cathedral', 'monastery', 'pagoda'],
  },
  // harajuku and takeshita are gone: they are neighbourhoods, and a ramen shop
  // called AFURI Harajuku was satisfying a traveller's anime interest.
  'anime & pop culture': {
    types: [],
    keywords: ['anime', 'manga', 'pokemon', 'pokémon', 'akihabara', 'otaku', 'cosplay', 'arcade', 'comic', 'game centre', 'game center', 'nintendo', 'ghibli', 'maid cafe', 'figure'],
  },
  // No types, deliberately. Google has no "modern architecture" category, and
  // the nearest thing, observation_deck, is narrower than the interest: the
  // Metropolitan Government Building is typed a plain tourist_attraction and is
  // the most obvious piece of modern architecture in Tokyo.
  // ignoreDescription, because the description is the one field that lies about
  // this interest. Prose mentions buildings constantly: Zojo-ji, a temple from
  // 1393, satisfied Modern Architecture because its description said "offering
  // traditional architecture", and a shopping mall satisfied it with
  // "architectural detail". The pipeline therefore believed the interest was
  // covered and never went looking, while the demo audit - which had its own
  // stricter copy of this list - correctly said nothing delivered it. Five
  // re-seeds in a row failed on that disagreement (Akber, 8 Sep 2026).
  //
  // 'tower' is out for the same reason it left the audit's list: it was matching
  // an anime figure shop that happens to occupy one, and Tokyo Tower, which is a
  // 1958 broadcast mast rather than contemporary design.
  'modern architecture': {
    types: [],
    ignoreDescription: true,
    not: ['tokyo tower'],
    keywords: ['skyscraper', 'observation deck', 'observatory', 'architecture', 'architectural', 'design sight', 'design museum', 'midtown', 'skytree', 'modernist', 'contemporary', 'teamlab', 'hills', 'forum', 'building', 'cocoon', 'city view'],
  },
  'art galleries': { types: ['art_gallery'], keywords: ['gallery', 'art centre', 'art center'] },
  'museums': { types: ['museum'], keywords: ['museum'] },
  'nature': {
    types: ['park', 'national_park', 'garden', 'botanical_garden', 'hiking_area', 'state_park'],
    keywords: ['park', 'garden', 'forest', 'lake', 'trail', 'nature'],
  },
  'beaches': { types: ['beach'], keywords: ['beach', 'praia', 'playa'] },
  'landmarks': {
    types: ['tourist_attraction', 'historical_landmark', 'historical_place', 'monument'],
    keywords: ['landmark', 'monument', 'castle', 'palace', 'fort'],
  },
  'shopping': {
    types: ['shopping_mall', 'department_store', 'market', 'store'],
    keywords: ['shopping', 'market', 'mall', 'boutique', 'street'],
  },
  'nightlife': {
    types: ['night_club', 'bar'],
    keywords: ['nightclub', 'night club', 'cocktail', 'club', 'lounge', 'live music', 'jazz', 'karaoke'],
  },
};

export function interestKey(interest) {
  return String(interest || '').trim().toLowerCase();
}

// Meals are excluded on purpose. A trip always has restaurants, and letting one
// count would mean "Shopping" was satisfied by a mall's food court, or Nightlife
// by an izakaya dinner - which is exactly the false pass that let a Tokyo trip
// ship with no night venue in it.
export function satisfiesInterest(item, interest) {
  if (!item || item.type === 'accommodation' || item.mealType) return false;

  const signals = INTEREST_SIGNALS[interestKey(interest)];
  if (!signals) return false;

  const types = Array.isArray(item.placeTypes) ? item.placeTypes : [];
  if (signals.types.some((type) => types.includes(type))) return true;

  // Where an interest has types of its own and Google has told us what this
  // place is, the types decide and the name is not allowed a second opinion.
  // Otherwise "Roppongi Hills Club", a restaurant, counts as nightlife because
  // its name contains "club" - which is precisely the false pass that let a
  // trip ship with no night venue while the audit reported the interest covered
  // (Akber, 7 Sep 2026).
  //
  // Two interests have no types because Google has no category for them: anime
  // and pop culture, and modern architecture. Those are cultural ideas rather
  // than place kinds, so for them the name and description are the only evidence
  // there is.
  if (signals.types.length > 0 && types.length > 0) return false;

  // Whole words, so "Akihabara" is not read as a bar and "Barcelona" is not
  // read as one either.
  const name = `${item.name || ''}`.toLowerCase();
  if ((signals.not || []).some((phrase) => name.includes(phrase))) return false;

  // Some interests may not be read off the description. See the note on modern
  // architecture: prose about a place is not evidence of what it is.
  const text = signals.ignoreDescription
    ? `${item.name || ''} ${item.categoryTag || ''}`.toLowerCase()
    : `${item.name || ''} ${item.categoryTag || ''} ${item.description || ''}`.toLowerCase();

  return signals.keywords.some((word) =>
    word.includes(' ') ? text.includes(word) : new Set(text.split(/[^a-z]+/)).has(word)
  );
}

// The interests no stop anywhere in the itinerary delivers. Coverage is judged
// across the whole trip rather than per day, matching what the prompt asks for:
// a two-day trip cannot reasonably fit five interests into both days.
export function uncoveredInterests(days, interests) {
  const wanted = (Array.isArray(interests) ? interests : []).filter((interest) =>
    INTEREST_SIGNALS[interestKey(interest)]
  );

  return wanted.filter(
    (interest) => !days.some((day) => day.items.some((item) => satisfiesInterest(item, interest)))
  );
}

// Nightlife is the one interest with a place in the day as well as a subject: a
// bar in the afternoon is not nightlife, it is a mistake, and the scheduler will
// drop it on sight. So a stop added for it has to go after dinner.
export function isEveningInterest(interest) {
  return interestKey(interest) === 'nightlife';
}
