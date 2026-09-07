import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function computePacing(itinerary, label) {
  itinerary.pacingLabel = label;
  itinerary.days.forEach((day) => {
    const stopCount = day.items.length;
    day.stopCount = stopCount;
    day.pacingLevel = Math.min(Math.round((stopCount / 8) * 100) / 100, 1);
  });
  return itinerary;
}

// Builds the shared trip-detail preamble used by both variant prompts.
function buildTripPreamble(params) {
  const destination = params.destination;
  const days = params.days;
  const budget = params.budget;
  const accommodation = params.accommodation;
  const interests = Array.isArray(params.interests) ? params.interests : [];
  const adults = typeof params.adults === 'number' ? params.adults : 1;

  // Nightlife earns a 02:00 finish, but not on the way out. Whatever day the
  // traveller flies home, they are packing and checking out the next morning,
  // so the final night ends at the normal time (Akber, 4 Sep 2026). A one-day
  // trip is the exception: its only night is also its last, and cutting that
  // short would mean the interest never happens at all.
  const hasNightlife = interests.some(function(i) { return i.toLowerCase().includes('nightlife'); });
  const endTimeLine = !hasNightlife
    ? '- End time: the last item of every day must end by 22:30. The traveller must be back at the hotel by 22:30.'
    : days <= 1
      ? '- End time: nightlife is a priority. Post-dinner activities (bars, clubs, live music) are expected. The last item of the day must end by 02:00. The traveller is back at the hotel by 02:00.'
      : `- End time (strictly enforced, and it CHANGES on the last day): nightlife is a priority, so post-dinner activities (bars, clubs, live music) are expected on days 1 to ${days - 1}, and those days may run until 02:00. Day ${days} is the LAST day and must end by 22:30 instead, with no late-night venue after dinner, because the traveller checks out and travels the next morning. Do not schedule a bar or club as the final stop of day ${days}.`;

  const groupLine = adults > 1
    ? `- Group size: ${adults} people — prefer venues with group-friendly seating, activities that are more enjoyable with multiple people, and restaurants that handle walk-in groups of ${adults} without a long wait.`
    : '';

  // Weighting alone was not enough. A Tokyo trip with "Temples & Shrines"
  // selected came back with four days, two of them themed "Spiritual Tokyo" and
  // "Sacred Temples", and not one temple or shrine anywhere in it - the theme
  // named the interest and the stops quietly ignored it (Akber, 4 Sep 2026).
  // So coverage is now a stated requirement, and a theme may not claim an
  // interest the day does not actually contain.
  // Nightlife is the one interest that needs a slot as well as a subject, and
  // the general coverage rule above turned out not to be enough on its own: a
  // trip with Nightlife selected came back with a ramen shop after dinner, which
  // then failed verification and was replaced by a members' club Google types as
  // a restaurant. The trip's entire nightlife was a restaurant (Akber, 7 Sep
  // 2026). Naming what a nightlife stop actually is, and where it goes, is the
  // part that was missing.
  const wantsNightlife = interests.some((interest) =>
    String(interest).trim().toLowerCase().includes('nightlife'));
  const nightlifeLine = wantsNightlife
    ? `
- NIGHTLIFE (strictly enforced): "Nightlife" is one of the interests, so every day except the last must end with a real, named night venue AFTER dinner - a well-known bar, cocktail bar, live music venue or club that this city is actually known for. It must be somewhere people go out in the evening, not a restaurant, a ramen shop, a late-opening cafe or a members-only club. Name a specific venue a local would recognise, not a generic description.`
    : '';

  const interestsLine = interests.length > 0
    ? `- Traveller interests: ${interests.join(', ')} — weight activity and meal choices toward these where it makes sense for the destination, rather than a generic mix.
- INTEREST COVERAGE (strictly enforced): every single interest listed above must appear as at least one real, named stop across the trip as a whole. If "Temples & Shrines" is listed, an actual named temple or shrine must appear. If "Anime & Pop Culture" is listed, an actual anime or pop-culture venue must appear. Spread the interests across the days rather than stacking them all into one.
- THEME HONESTY (strictly enforced): a day's "theme" may only name an interest that day actually delivers. Do not theme a day "Sacred Temples" unless that day contains a temple, or "Anime Culture" unless that day contains an anime venue. If a day has no stop for an interest, do not mention that interest in its theme.${nightlifeLine}`
    : '- Traveller interests: none specified — use a well-rounded, broadly appealing mix.';

  return { destination, days, budget, accommodation, endTimeLine, groupLine, interestsLine };
}

// Shared item-shape instructions appended to both variant prompts.
const ITEM_SHAPE_INSTRUCTIONS = `For each item, also include:
- "categoryTag": format "Type · Descriptor", two short words separated by a dot. Examples: "Beach · Outdoor", "Restaurant · Seafront", "Museum · Outdoor", "Bar · Seafront", "Activity · Outdoor", "Hotel · Seafront". Keep this consistent for every item, including meals.
- "startTime": a plausible 24-hour "HH:MM" clock time, sequential and realistic across the day. Nothing on any day may start before 09:00 - the day's first item (breakfast, or the first activity on a breakfastAtAccommodation day) starts at 09:00 at the earliest. MEAL TIMES ARE FIXED and identical on every day of the trip: breakfast 09:00, lunch 13:30, dinner 20:00. The app sets these exactly and they will not move, so build the day around them rather than choosing your own meal times. END TIME (strictly enforced): every day's last item must end by the time given in the End time line above. Read that line carefully rather than assuming one cutoff for the whole trip: it may name a different time for the final day. SCHEDULING RULE (strictly enforced): the only gap between any two consecutive items is the travel time between them. Each item's startTime must equal the previous item's startTime + durationMinutes + travel time. No idle time is permitted anywhere in the day. Schedule afternoon activities back-to-back after lunch so the day runs continuously right up to dinner.
- "description": one short sentence on what this place is and why it suits this traveller. NEVER state a travel time, a distance, a visit length, or a mode of transport. Do not write things like "10 minutes from the hotel", "a 15-minute walk from breakfast", "45-minute focused tour", "explore for 50 minutes", or "15 minutes by metro". Every one of those numbers is measured elsewhere from real route and schedule data and shown on the same card, so a number written here can only contradict it. Describe the place, not the logistics. Use no em dashes and no en dashes anywhere in the prose: write a comma, a semicolon or a new sentence instead.
- "durationMinutes": a plausible whole number of minutes for how long this stop takes. Activities are 45-150. Meals are always exactly 60 (the app resets every meal to the length that suits the chosen pace, so this value is only a placeholder for meals).
- "mealType": ONLY for items where "type" is "meal" — one of "breakfast", "lunch", or "dinner". Omit or set to null for non-meal items.

Respond with ONLY valid JSON, no markdown formatting, no code fences, no extra commentary.`;

function buildPackedPrompt(p) {
  return `You are generating a trip itinerary for a travel planning app.

Trip details:
- Destination: ${p.destination}
- Length: ${p.days} days
- Budget band: ${p.budget || 'mid-range'}
- Accommodation (routing anchor): ${p.accommodation || 'a centrally located hotel'}
${p.interestsLine}${p.groupLine ? `\n${p.groupLine}` : ''}
${p.endTimeLine}

Generate ONE itinerary: "Packed & Varied" — more activities per day, faster pace, wide variety of experiences. Each day has 4-5 activities (not counting meals). Favour more, shorter stops over fewer, longer ones: no single activity should run longer than 120 minutes, and the afternoon in particular should be built from several distinct stops rather than one long visit.

Also write:
- A short "tagline" (5-8 words) summarizing the pace and style.
- A short "divergenceLabel" (one sentence) describing what makes this plan distinct compared to a slower alternative.

Provide a day-by-day plan. Each day should include breakfast, lunch, dinner, and the activities specified above, each with a real, specific place name (a real restaurant, attraction, or landmark that actually exists in ${p.destination}), not a generic description. Exception: see "breakfastAtAccommodation" below.

The traveller's accommodation for this whole trip is ${p.accommodation || 'a centrally located hotel'}. Every day of the itinerary starts and ends there - the app adds those bookend stops automatically, so never invent your own "return to hotel" or "check in" item. What you decide, per day, is where breakfast happens:
- "breakfastAtAccommodation" (boolean, required on every day): true if it makes sense for this specific accommodation and this day's pacing for breakfast to happen there (e.g. a nicer hotel with its own breakfast, or a slower/later-starting day), false if the traveller should go out to a genuine, real breakfast/brunch venue instead. Vary this naturally across the trip rather than answering the same way every day - real trips mix both.
- When "breakfastAtAccommodation" is true: do NOT include a "breakfast" item in that day's "items" array - omit it entirely, the app fills it in using the accommodation's own real details. Instead include a "breakfastTime" field on the day object (24-hour "HH:MM", between 09:00 and 10:30) for when breakfast happens.
- When "breakfastAtAccommodation" is false: include a real breakfast item in "items" as normal, and omit "breakfastTime" (or set it null) - the item's own "startTime" already covers it.

For meal items specifically: the place you choose must genuinely fit that meal, not just have a plausible-sounding name. For breakfast, choose somewhere that's actually a breakfast/brunch venue by nature - a café, bakery, hotel restaurant, or dedicated brunch spot - never a place whose real identity is a burger joint, steakhouse, bar, or nightclub, even if its name sounds inviting. The same logic applies to lunch and dinner: pick a place whose actual identity matches the meal, not just any restaurant name that comes to mind.

CRITICAL DAY SHAPE RULE (strictly enforced): The fixed meal times divide every day into three stretches, and each one needs the right number of stops to fill it. Breakfast runs 09:00 to 10:00, so the morning between breakfast and lunch is about three and a half hours: give it TWO activities. Lunch runs 13:30 to 14:30, so the afternoon between lunch and dinner is about five and a half hours: give it THREE activities. Anything after dinner belongs to the evening.

Both counts matter in both directions. Too few stops and one place has to be stretched across hours it does not deserve; too many and the day cannot fit them and one gets dropped. Never leave the morning empty - breakfast followed straight by lunch is two meals in a row with nothing between them, and it wastes the hours when the famous sights are least crowded.

CRITICAL MEAL RULE (strictly enforced): Every single day must include both lunch and dinner as separate meal items at real restaurants. This rule has no exceptions — not even on the last day. Evening activities such as beach clubs, bars, rooftop venues, or nightlife are scheduled AFTER dinner, never instead of it. A venue that serves food or drinks is not a substitute for a dinner meal item.

CRITICAL ONE-MEAL-PER-SLOT RULE (strictly enforced): Each day has exactly one breakfast, one lunch and one dinner — never two of the same meal. Do NOT schedule a plain café, coffee shop, bakery or restaurant as an activity when its only purpose is eating or drinking — an ordinary café in the morning alongside breakfast is wrong, because it creates two breakfast-style stops in one day. Genuine food-THEMED experiences are still welcome as activities: a cooking class, a food-market or street-food tour, a wine, cheese or olive-oil tasting, or visiting a famous historic café as a landmark — these are real experiences, not just a meal. A simple coffee or café break may appear as an activity ONLY in the afternoon between lunch and dinner, and only once — never in the morning, and never as a second meal. Every other activity must be a genuine non-food attraction: a sight, landmark, museum, gallery, beach, viewpoint, park, garden, walk, boat trip or tour. (Where nightlife applies, a post-dinner bar or club is also allowed, only after dinner.)

CRITICAL ROUTING RULE (strictly enforced): All stops every day must be within the destination city or its immediate urban area — no day trips to towns or attractions in other cities, even if they are famous. Each day should travel THROUGH the city rather than orbit one pocket of it: plan the day as a route across 2 to 4 distinct neighbourhoods, moving in one direction so the traveller never doubles back. A short ride between areas is expected and welcome — do not place every activity of a day within a few streets of one another. Consecutive stops are normally 10 to 30 minutes apart, and travel between any two consecutive stops must never exceed 60 minutes by any mode of transport — if a place would take longer than 60 minutes to reach from the previous stop, do not include it; choose something closer instead. Dinner should be near the last afternoon activity or en route back to the hotel.

CRITICAL VARIETY RULE (strictly enforced): No two days may cover the same neighbourhoods, and each day must open somewhere the trip has not been yet. Vary the kind of place as well as the location: a day built from shopping centres and hotel restaurants is a failure even when every stop is real. Across the trip, mix landmarks, museums or galleries, outdoor space, and genuinely local spots rather than repeating one category.

CRITICAL REACH RULE (strictly enforced): Every stop, on every day, must be within about 15 km of the accommodation. Each day starts and ends there, so a stop further out forces a long journey out and the same journey back, and no amount of reordering can fix that - the day is ruined by the choice, not the sequence. This excludes outlying attractions however famous they are: if a place sits well outside the city's main area, leave it out entirely rather than wedging it into a day. Do not schedule it as a "quick visit" either; distance does not care how long you stay.

CRITICAL PROMINENCE RULE (strictly enforced): Choose places a visitor to this city would actually be told to go to. Famous, well-known, established landmarks, museums, temples, districts and venues come first. Do NOT fill a day with obscure local curiosities: a commemorative plaque, a birthplace marker, the site of a legendary tree, a flagpole, a minor local monument or a small neighbourhood shrine nobody travels for. If a first-time visitor would not recognise the name or find it in a guidebook, it needs a very good reason to be there. A day should contain at least two places the city is genuinely known for.

CRITICAL RESTAURANT RULE (strictly enforced): The prominence rule applies to meals as much as to sights. Choose restaurants, cafés and bars a visitor would actually be pointed to: an established, well-regarded or locally famous place, a notable specialist in its dish, or somewhere with a real reputation. Do NOT fill meal slots with whatever generic café or bar happens to be nearby - an unremarkable coffee shop or an anonymous rooftop bar is a wasted stop on a two-day trip. Where the destination is known for a particular dish, at least one meal should be somewhere known for it.

CRITICAL SPREAD RULE (strictly enforced): Use the whole city. Do not cluster every stop of a day into one district and leave the rest of the map empty - the finished plan is shown on a map, and a cluster in one corner with the hotel stranded far away looks wrong and reads as a lazy plan. The day's stops should be visibly distributed across the city while still being visited in a sensible order. Spread and order are not in conflict: pick places across the city, then walk them as a route that progresses rather than doubling back.

CRITICAL SEQUENCE RULE (strictly enforced): The order of the stops must make sense on a map, not just on a clock. Once the day moves to a new area, finish everything there before moving on. Never travel a long way to a place and then travel a long way back past where you started — no going across town, then back across town, then across again. Two stops that sit near each other must be consecutive, never separated by a stop on the far side of the city. Read the day back to yourself as a line on a map before you answer: it should read as a progression, not a zig-zag.

${ITEM_SHAPE_INSTRUCTIONS}

Use this exact structure:

{
  "label": "Packed & Varied",
  "tagline": "short tagline for this plan",
  "divergenceLabel": "one sentence on what makes this plan distinct",
  "days": [
    {
      "day": 1,
      "theme": "short theme for the day",
      "breakfastAtAccommodation": false,
      "items": [
        {
          "time": "breakfast",
          "type": "meal",
          "name": "Place Name",
          "categoryTag": "Hotel · Seafront",
          "description": "one short sentence",
          "startTime": "09:00",
          "durationMinutes": 60,
          "mealType": "breakfast"
        },
        {
          "time": "morning",
          "type": "activity",
          "name": "Place Name",
          "categoryTag": "Activity · Outdoor",
          "description": "one short sentence",
          "startTime": "10:05",
          "durationMinutes": 90,
          "mealType": null
        }
      ]
    }
  ]
}`;
}

function buildSlowPrompt(p) {
  return `You are generating a trip itinerary for a travel planning app.

Trip details:
- Destination: ${p.destination}
- Length: ${p.days} days
- Budget band: ${p.budget || 'mid-range'}
- Accommodation (routing anchor): ${p.accommodation || 'a centrally located hotel'}
${p.interestsLine}${p.groupLine ? `\n${p.groupLine}` : ''}
${p.endTimeLine}

Generate ONE itinerary: "Slow & Immersive" — fewer activities per day, more time per place, a calmer pace. Each day has 3-4 activities (not counting meals). Fewer than Packed, and each one gets a longer, unhurried stay rather than a quick look, but a day still has to be a day: 1-2 activities alongside three meals is a day of eating with errands attached, not an immersive one.

Also write:
- A short "tagline" (5-8 words) summarizing the pace and style.
- A short "divergenceLabel" (one sentence) describing what makes this plan distinct compared to a busier alternative.

Provide a day-by-day plan. Each day should include breakfast, lunch, dinner, and the activities specified above, each with a real, specific place name (a real restaurant, attraction, or landmark that actually exists in ${p.destination}), not a generic description. Exception: see "breakfastAtAccommodation" below.

The traveller's accommodation for this whole trip is ${p.accommodation || 'a centrally located hotel'}. Every day of the itinerary starts and ends there - the app adds those bookend stops automatically, so never invent your own "return to hotel" or "check in" item. What you decide, per day, is where breakfast happens:
- "breakfastAtAccommodation" (boolean, required on every day): true if it makes sense for this specific accommodation and this day's pacing for breakfast to happen there (e.g. a nicer hotel with its own breakfast, or a slower/later-starting day), false if the traveller should go out to a genuine, real breakfast/brunch venue instead. Vary this naturally across the trip rather than answering the same way every day - real trips mix both.
- When "breakfastAtAccommodation" is true: do NOT include a "breakfast" item in that day's "items" array - omit it entirely, the app fills it in using the accommodation's own real details. Instead include a "breakfastTime" field on the day object (24-hour "HH:MM", between 09:00 and 10:30) for when breakfast happens.
- When "breakfastAtAccommodation" is false: include a real breakfast item in "items" as normal, and omit "breakfastTime" (or set it null) - the item's own "startTime" already covers it.

For meal items specifically: the place you choose must genuinely fit that meal, not just have a plausible-sounding name. For breakfast, choose somewhere that's actually a breakfast/brunch venue by nature - a café, bakery, hotel restaurant, or dedicated brunch spot - never a place whose real identity is a burger joint, steakhouse, bar, or nightclub, even if its name sounds inviting. The same logic applies to lunch and dinner: pick a place whose actual identity matches the meal, not just any restaurant name that comes to mind.

CRITICAL MEAL RULE (strictly enforced): Every single day must include both lunch and dinner as separate meal items at real restaurants. This rule has no exceptions — not even on the last day. Evening activities such as beach clubs, bars, rooftop venues, or nightlife are scheduled AFTER dinner, never instead of it. A venue that serves food or drinks is not a substitute for a dinner meal item.

CRITICAL DAY SHAPE RULE (strictly enforced): The fixed meal times divide every day into three stretches, and each one needs the right number of stops to fill it. This is the slow plan, so meals are long: breakfast runs 09:00 to 11:00, which leaves about two and a half hours before lunch: give the morning ONE OR TWO activities. Lunch runs 13:30 to 15:30, which leaves about four and a half hours before dinner: give the afternoon TWO OR THREE activities. Anything after dinner belongs to the evening.

Both counts matter in both directions. Too few stops and one place has to be stretched across hours it does not deserve; too many and the day cannot fit them and one gets dropped. Never leave the morning empty - breakfast followed straight by lunch is two meals in a row with nothing between them, and it wastes the hours when the famous sights are least crowded.

CRITICAL ONE-MEAL-PER-SLOT RULE (strictly enforced): Each day has exactly one breakfast, one lunch and one dinner — never two of the same meal. Do NOT schedule a plain café, coffee shop, bakery or restaurant as an activity when its only purpose is eating or drinking — an ordinary café in the morning alongside breakfast is wrong, because it creates two breakfast-style stops in one day. Genuine food-THEMED experiences are still welcome as activities: a cooking class, a food-market or street-food tour, a wine, cheese or olive-oil tasting, or visiting a famous historic café as a landmark — these are real experiences, not just a meal. A simple coffee or café break may appear as an activity ONLY in the afternoon between lunch and dinner, and only once — never in the morning, and never as a second meal. Every other activity must be a genuine non-food attraction: a sight, landmark, museum, gallery, beach, viewpoint, park, garden, walk, boat trip or tour. (Where nightlife applies, a post-dinner bar or club is also allowed, only after dinner.)

CRITICAL ROUTING RULE (strictly enforced): All stops every day must be within the destination city or its immediate urban area — no day trips to towns or attractions in other cities, even if they are famous. Each day should travel THROUGH the city rather than orbit one pocket of it: plan the day as a route across 2 to 4 distinct neighbourhoods, moving in one direction so the traveller never doubles back. A short ride between areas is expected and welcome — do not place every activity of a day within a few streets of one another. Consecutive stops are normally 10 to 30 minutes apart, and travel between any two consecutive stops must never exceed 60 minutes by any mode of transport — if a place would take longer than 60 minutes to reach from the previous stop, do not include it; choose something closer instead. Dinner should be near the last afternoon activity or en route back to the hotel.

CRITICAL VARIETY RULE (strictly enforced): No two days may cover the same neighbourhoods, and each day must open somewhere the trip has not been yet. Vary the kind of place as well as the location: a day built from shopping centres and hotel restaurants is a failure even when every stop is real. Across the trip, mix landmarks, museums or galleries, outdoor space, and genuinely local spots rather than repeating one category.

CRITICAL REACH RULE (strictly enforced): Every stop, on every day, must be within about 15 km of the accommodation. Each day starts and ends there, so a stop further out forces a long journey out and the same journey back, and no amount of reordering can fix that - the day is ruined by the choice, not the sequence. This excludes outlying attractions however famous they are: if a place sits well outside the city's main area, leave it out entirely rather than wedging it into a day. Do not schedule it as a "quick visit" either; distance does not care how long you stay.

CRITICAL PROMINENCE RULE (strictly enforced): Choose places a visitor to this city would actually be told to go to. Famous, well-known, established landmarks, museums, temples, districts and venues come first. Do NOT fill a day with obscure local curiosities: a commemorative plaque, a birthplace marker, the site of a legendary tree, a flagpole, a minor local monument or a small neighbourhood shrine nobody travels for. If a first-time visitor would not recognise the name or find it in a guidebook, it needs a very good reason to be there. A day should contain at least two places the city is genuinely known for.

CRITICAL RESTAURANT RULE (strictly enforced): The prominence rule applies to meals as much as to sights. Choose restaurants, cafés and bars a visitor would actually be pointed to: an established, well-regarded or locally famous place, a notable specialist in its dish, or somewhere with a real reputation. Do NOT fill meal slots with whatever generic café or bar happens to be nearby - an unremarkable coffee shop or an anonymous rooftop bar is a wasted stop on a two-day trip. Where the destination is known for a particular dish, at least one meal should be somewhere known for it.

CRITICAL SPREAD RULE (strictly enforced): Use the whole city. Do not cluster every stop of a day into one district and leave the rest of the map empty - the finished plan is shown on a map, and a cluster in one corner with the hotel stranded far away looks wrong and reads as a lazy plan. The day's stops should be visibly distributed across the city while still being visited in a sensible order. Spread and order are not in conflict: pick places across the city, then walk them as a route that progresses rather than doubling back.

CRITICAL SEQUENCE RULE (strictly enforced): The order of the stops must make sense on a map, not just on a clock. Once the day moves to a new area, finish everything there before moving on. Never travel a long way to a place and then travel a long way back past where you started — no going across town, then back across town, then across again. Two stops that sit near each other must be consecutive, never separated by a stop on the far side of the city. Read the day back to yourself as a line on a map before you answer: it should read as a progression, not a zig-zag.

${ITEM_SHAPE_INSTRUCTIONS}

Use this exact structure:

{
  "label": "Slow & Immersive",
  "tagline": "short tagline for this plan",
  "divergenceLabel": "one sentence on what makes this plan distinct",
  "days": [
    {
      "day": 1,
      "theme": "short theme for the day",
      "breakfastAtAccommodation": false,
      "items": [
        {
          "time": "breakfast",
          "type": "meal",
          "name": "Place Name",
          "categoryTag": "Cafe · Central",
          "description": "one short sentence",
          "startTime": "09:00",
          "durationMinutes": 60,
          "mealType": "breakfast"
        },
        {
          "time": "morning",
          "type": "activity",
          "name": "Place Name",
          "categoryTag": "Museum · Indoor",
          "description": "one short sentence",
          "startTime": "10:20",
          "durationMinutes": 120,
          "mealType": null
        }
      ]
    }
  ]
}`;
}

// Every day must have lunch and dinner — breakfast is either an item or
// handled via breakfastAtAccommodation. If a day is missing either required
// meal, the itinerary is considered invalid and the call retries once.
function validateMeals(parsed, checkDuplicates) {
  const REQUIRED = ['lunch', 'dinner'];
  for (const day of parsed.days || []) {
    const mealTypes = (day.items || []).filter((i) => i.mealType).map((i) => i.mealType);
    const present = new Set(mealTypes);

    const missing = REQUIRED.filter((m) => !present.has(m));
    if (missing.length > 0) {
      const err = new Error(`Day ${day.day} is missing required meal(s): ${missing.join(', ')}`) as Error & { mealValidationFailed?: boolean };
      err.mealValidationFailed = true;
      throw err;
    }

    // Two of the same meal is as broken as none, and until now only one of the
    // two was checked. A generation on 7 Sep 2026 came back with day 2 of both
    // variants carrying two dinners - 18:10 and 19:25 on Packed, 17:30 and 19:50
    // on Slow - and everything downstream took them both at face value: the
    // window logic anchored one, the traveller was shown two.
    if (!checkDuplicates) continue;
    const duplicated = [...present].filter(
      (mealType) => mealTypes.filter((m) => m === mealType).length > 1
    );
    if (duplicated.length > 0) {
      const err = new Error(`Day ${day.day} has more than one ${duplicated.join(' and ')}`) as Error & { mealValidationFailed?: boolean };
      err.mealValidationFailed = true;
      throw err;
    }
  }
}

async function callClaude(prompt) {
  // One variant per call: 3 days × ~6 items × ~175 tokens/item ≈ 3,150 tokens.
  // 8192 gives real headroom; Haiku's output limit is 8192 max_tokens so this
  // is also the ceiling - but a single variant at 3 days fits comfortably.
  async function attempt(checkDuplicates) {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    // Content blocks are a union; only a text block has `.text` - narrow first.
    const firstBlock = message.content[0];
    let rawText = (firstBlock.type === 'text' ? firstBlock.text : '').trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseError) {
      const err = new Error('Claude did not return valid JSON') as Error & { rawText?: string };
      err.rawText = rawText;
      throw err;
    }

    // Validate every day has lunch and dinner — if not, throw so the caller
    // can retry once before surfacing an error to the user.
    validateMeals(parsed, checkDuplicates);
    return parsed;
  }

  try {
    return await attempt(true);
  } catch (err) {
    // Only auto-retry meal validation failures - JSON parse errors are
    // unlikely to self-correct on a second attempt with the same prompt.
    if (!err.mealValidationFailed) throw err;

    // The retry no longer rejects a duplicated meal. A missing meal is worth
    // failing over because the day is genuinely incomplete, but a day with two
    // dinners is repairable: dedupeMeals keeps whichever sits closest to the
    // meal's anchor and drops the rest. Asking once more is worth it, since the
    // model usually gets it right the second time and a real second dinner is
    // better than a dropped one - but failing the whole trip on the second slip
    // would mean a paid generation thrown away over something the pipeline can
    // already fix by itself.
    return await attempt(false);
  }
}

export async function generateRawItinerary(params) {
  const p = buildTripPreamble(params);

  // Two parallel calls - one per variant - instead of one combined call.
  // Haiku is ~5-10x faster per token than Sonnet, and parallelising the two
  // variants cuts wall-clock time roughly in half compared to running them
  // sequentially. Each call only needs to produce ~3,150 tokens for a 3-day
  // trip, so 8192 max_tokens is plenty.
  const [packedRaw, slowRaw] = await Promise.all([
    callClaude(buildPackedPrompt(p)),
    callClaude(buildSlowPrompt(p)),
  ]);

  const parsed = { packed: packedRaw, slow: slowRaw };

  if (parsed.packed) {
    computePacing(parsed.packed, 'Busy');
  }
  if (parsed.slow) {
    computePacing(parsed.slow, 'Relaxed');
  }

  // Hard enforcement: slow day must always have strictly fewer items than packed day.
  // If the AI returned equal or more, trim the last non-meal activity from the slow day
  // until the count is lower. Meals (type === 'meal') are never removed.
  if (parsed.packed && parsed.slow) {
    for (let i = 0; i < parsed.slow.days.length; i++) {
      const packedDay = parsed.packed.days[i];
      const slowDay = parsed.slow.days[i];
      if (!packedDay || !slowDay) continue;

      while (slowDay.items.length >= packedDay.items.length) {
        // Find the last activity (non-meal) to remove
        let removed = false;
        for (let j = slowDay.items.length - 1; j >= 0; j--) {
          if (slowDay.items[j].type !== 'meal') {
            slowDay.items.splice(j, 1);
            removed = true;
            break;
          }
        }
        if (!removed) break; // only meals left, can't trim further
      }

      // Recompute pacing for the trimmed slow day
      slowDay.stopCount = slowDay.items.length;
      slowDay.pacingLevel = Math.min(Math.round((slowDay.items.length / 8) * 100) / 100, 1);
    }
  }

  return parsed;
}
