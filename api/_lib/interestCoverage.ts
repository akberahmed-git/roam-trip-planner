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
    // The retailers by name, because Google types them as plain stores and the
    // log showed Mandarake Shibuya swapped out for "serving nothing" and
    // replaced with Kotobukiya, another anime shop the matcher did not know.
    keywords: ['anime', 'manga', 'pokemon', 'pokémon', 'akihabara', 'otaku', 'cosplay', 'arcade', 'comic', 'game centre', 'game center', 'nintendo', 'ghibli', 'maid cafe', 'figure', 'mandarake', 'animate', 'kotobukiya', 'gamers', 'radio kaikan', 'super potato', 'nakano broadway', 'jump shop', 'kiddy land', 'gachapon', 'capcom', 'sanrio', 'one piece', 'gundam', 'kirby'],
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
  // A staple on every destination. Meals never count (see satisfiesInterest),
  // so this is for the food that is an activity: a market, a class, a tour.
  'cuisine': {
    types: ['food_court', 'market'],
    keywords: ['food market', 'food hall', 'cooking class', 'food tour', 'street food', 'tasting', 'cuisine', 'gastronom'],
  },
};

export function interestKey(interest) {
  return String(interest || '').trim().toLowerCase();
}

// Chips the app generates per destination ("Casino Gaming", "Yachting",
// "Formula 1") used to be invisible here: no entry in the table, so no stop
// ever satisfied them, so the one-per-day cap, the plan cap and the coverage
// check all ran and did nothing. A Monaco plan shipped three casinos in a day
// under a rule that says one (Akber, 9 Sep 2026).
//
// Two sources fill the gap. The interest-suggestion call now asks the model
// for place types and keywords alongside each chip, cached with the chips for
// a year, and the generation handler installs them here per request. Failing
// that, the chip's own words are the keywords: "casino gaming" reads as
// "casino" and "gaming", "yachting" also as "yacht".
const dynamicSignals: Record<string, { types: string[]; keywords: string[]; not?: string[]; ignoreDescription?: boolean; namesToo?: boolean }> = {};

// Types too broad to say what a place is. The model offered tourist_attraction
// for "Formula 1 Racing", which made the oceanographic museum a racing stop,
// put the chip at its plan cap, dropped the museum for it, and then rejected
// every replacement the fill found for being a tourist attraction too. A gap
// of 2h18m shipped under a rule that says gaps never ship (Akber, 9 Sep 2026).
const GENERIC_TYPES = new Set([
  'tourist_attraction', 'point_of_interest', 'establishment', 'store', 'restaurant', 'food', 'cafe',
  'shopping_mall', 'park', 'locality', 'neighborhood', 'route', 'premise', 'political', 'geocode',
  'landmark', 'historical_landmark', 'event_venue', 'cultural_landmark', 'plaza', 'street',
]);
// Words that describe every place in a city, not a kind of place.
const GENERIC_KEYWORDS = new Set([
  'luxury', 'famous', 'best', 'top', 'popular', 'local', 'tour', 'tours', 'visit', 'experience', 'experiences',
  'culture', 'scene', 'heritage', 'iconic', 'historic', 'historical', 'beautiful', 'stunning', 'must',
  'attraction', 'attractions', 'landmark', 'landmarks', 'sightseeing', 'place', 'places', 'spot', 'spots',
]);

export function getDynamicInterestSignals() {
  return { ...dynamicSignals };
}

export function setDynamicInterestSignals(signals, destination = '') {
  for (const key of Object.keys(dynamicSignals)) delete dynamicSignals[key];
  if (!signals || typeof signals !== 'object') return;
  const destinationWords = new Set(plain(destination).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  for (const [label, value] of Object.entries(signals)) {
    const v: any = value || {};
    const types = Array.isArray(v.types)
      ? v.types.filter((t) => typeof t === 'string' && /^[a-z_]{3,40}$/.test(t) && !GENERIC_TYPES.has(t)).slice(0, 8)
      : [];
    const keywords = Array.isArray(v.keywords)
      ? v.keywords
          .map((k) => plain(k).trim())
          .filter((k) => (k.length >= 4 || /\d/.test(k)) && k.length <= 40)
          .filter((k) => !GENERIC_KEYWORDS.has(k) && !destinationWords.has(k))
          // "monaco grand prix" is fine; "monaco" alone is every place in town.
          .filter((k) => !k.split(' ').every((w) => destinationWords.has(w) || GENERIC_KEYWORDS.has(w)))
          .slice(0, 10)
      : [];
    if (types.length === 0 && keywords.length === 0) continue;
    // Names and category tags only: prose about a place is not evidence of what
    // it is, the same call the static table makes for modern architecture.
    dynamicSignals[interestKey(label)] = { types, keywords, ignoreDescription: true, namesToo: true };
  }
}

const DERIVE_STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'local', 'culture', 'scene', 'experiences', 'experience', 'life', 'spots', 'tours', 'tour']);

// Keywords straight from the chip label, for a chip nothing else describes.
function derivedSignals(key) {
  const words = key.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !DERIVE_STOP_WORDS.has(w));
  const keywords = new Set<string>();
  for (const word of words) {
    keywords.add(word);
    if (word.endsWith('ing') && word.length >= 8) keywords.add(word.slice(0, -3));  // yachting -> yacht
    if (word.endsWith('ies') && word.length >= 6) keywords.add(word.slice(0, -3) + 'y'); // wineries -> winery
    else if (word.endsWith('s') && word.length >= 5) keywords.add(word.slice(0, -1));  // casinos -> casino
  }
  if (words.length > 1) keywords.add(words.join(' '));
  return { types: [], keywords: [...keywords], ignoreDescription: true, namesToo: true };
}

function signalsFor(interest) {
  const key = interestKey(interest);
  return INTEREST_SIGNALS[key] || dynamicSignals[key] || (key ? derivedSignals(key) : null);
}

// Meals are excluded on purpose. A trip always has restaurants, and letting one
// count would mean "Shopping" was satisfied by a mall's food court, or Nightlife
// by an izakaya dinner - which is exactly the false pass that let a Tokyo trip
// ship with no night venue in it.
export function satisfiesInterest(item, interest) {
  if (!item || item.type === 'accommodation' || item.mealType) return false;

  const signals = signalsFor(interest);
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
  //
  // That holds for the static table, whose types were chosen by hand. The
  // model's types for a city's own chips are guesses ("stadium" for Formula 1
  // Racing), so for those, and for signals derived from a chip's own words, the
  // name and category tag still count: Monaco Circuit is a racing stop whatever
  // Google files it under (Akber, 9 Sep 2026).
  if (signals.types.length > 0 && types.length > 0 && !signals.namesToo) return false;

  // Whole words, so "Akihabara" is not read as a bar and "Barcelona" is not
  // read as one either.
  const name = plain(item.name);
  if ((signals.not || []).some((phrase) => name.includes(plain(phrase)))) return false;

  // Some interests may not be read off the description. See the note on modern
  // architecture: prose about a place is not evidence of what it is.
  const text = signals.ignoreDescription
    ? plain(`${item.name || ''} ${item.categoryTag || ''}`)
    : plain(`${item.name || ''} ${item.categoryTag || ''} ${item.description || ''}`);

  const words = new Set(text.split(/[^a-z0-9]+/));
  return signals.keywords.some((keyword) => {
    const word = plain(keyword);
    return word.includes(' ') ? text.includes(word) : words.has(word);
  });
}

// Lowercased with the accents taken off, so "Pokémon Center Mega Tokyo" is
// read as pokemon and not split into "pok" and "mon" by the word tokeniser.
// The audit reported that stop as serving none of the chips and blocked a
// draft on it, and the pipeline's own serves-nothing swap would have treated
// the Pokémon Center as expendable for the same reason (Akber, 8 Sep 2026).
function plain(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// The interests no stop anywhere in the itinerary delivers. Coverage is judged
// across the whole trip rather than per day, matching what the prompt asks for:
// a two-day trip cannot reasonably fit five interests into both days.
export function uncoveredInterests(days, interests) {
  const wanted = (Array.isArray(interests) ? interests : []).filter((interest) => signalsFor(interest));

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
