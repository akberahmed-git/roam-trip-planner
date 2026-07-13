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

export async function generateRawItinerary(params) {
  const destination = params.destination;
  const days = params.days;
  const budget = params.budget;
  const accommodation = params.accommodation;
  const interests = Array.isArray(params.interests) ? params.interests : [];

  const interestsLine = interests.length > 0
    ? `- Traveller interests: ${interests.join(', ')} — weight activity and meal choices toward these where it makes sense for the destination, rather than a generic mix.`
    : '- Traveller interests: none specified — use a well-rounded, broadly appealing mix.';

  const prompt = `You are generating a trip itinerary for a travel planning app.

Trip details:
- Destination: ${destination}
- Length: ${days} days
- Budget band: ${budget || 'mid-range'}
- Accommodation (routing anchor): ${accommodation || 'a centrally located hotel'}
${interestsLine}

Generate TWO different itineraries for this trip:
1. "Packed & Varied" — more activities per day, faster pace, wide variety of experiences.
2. "Slow & Immersive" — fewer activities per day, more time per place, a calmer pace.

For each itinerary, also write:
- A short "tagline" (5-8 words) summarizing the pace and style.
- A short "divergenceLabel" (one sentence) describing what makes this specific plan distinct compared to the other one.

For each itinerary, provide a day-by-day plan. Each day should include breakfast, lunch, dinner, and 2-3 activities, each with a real, specific place name (a real restaurant, attraction, or landmark that actually exists in ${destination}), not a generic description. Exception: see "breakfastAtAccommodation" below - on days where breakfast happens at the accommodation itself, do not include a breakfast item at all.

The traveller's accommodation for this whole trip is ${accommodation || 'a centrally located hotel'}. Every day of the itinerary starts and ends there - the app adds those bookend stops automatically, so never invent your own "return to hotel" or "check in" item. What you decide, per day, is where breakfast happens:
- "breakfastAtAccommodation" (boolean, required on every day): true if it makes sense for this specific accommodation and this day's pacing for breakfast to happen there (e.g. a nicer hotel with its own breakfast, or a slower/later-starting day), false if the traveller should go out to a genuine, real breakfast/brunch venue instead. Vary this naturally across the trip rather than answering the same way every day - real trips mix both.
- When "breakfastAtAccommodation" is true: do NOT include a "breakfast" item in that day's "items" array - omit it entirely, the app fills it in using the accommodation's own real details. Instead include a "breakfastTime" field on the day object (24-hour "HH:MM", between 09:00 and 10:30) for when breakfast happens.
- When "breakfastAtAccommodation" is false: include a real breakfast item in "items" as normal, and omit "breakfastTime" (or set it null) - the item's own "startTime" already covers it.

For meal items specifically: the place you choose must genuinely fit that meal, not just have a plausible-sounding name. For breakfast, choose somewhere that's actually a breakfast/brunch venue by nature - a café, bakery, hotel restaurant, or dedicated brunch spot - never a place whose real identity is a burger joint, steakhouse, bar, or nightclub, even if its name sounds inviting. The same logic applies to lunch and dinner: pick a place whose actual identity matches the meal, not just any restaurant name that comes to mind. If you're not confident a specific real place fits the meal, choose a different real place that you are confident fits, rather than forcing a mismatched one into the slot.

For each item, also include:
- "categoryTag": format "Type · Descriptor", two short words separated by a dot. Examples: "Beach · Outdoor", "Restaurant · Seafront", "Museum · Outdoor", "Bar · Seafront", "Activity · Outdoor", "Hotel · Seafront". Keep this consistent for every item, including meals.
- "startTime": a plausible 24-hour "HH:MM" clock time, sequential and realistic across the day. Nothing on any day may start before 09:00 - the day's first item (breakfast, or the first activity on a breakfastAtAccommodation day) starts at 09:00 at the earliest. Meal windows are fixed: breakfast between 09:00-10:30, lunch between 12:00-14:00, dinner between 20:00-22:00.
- "durationMinutes": a plausible whole number of minutes for how long this stop takes. Meals are always exactly 60. Activities are 45-150.
- "mealType": ONLY for items where "type" is "meal" — one of "breakfast", "lunch", or "dinner". Omit or set to null for non-meal items.

Respond with ONLY valid JSON, no markdown formatting, no code fences, no extra commentary.

Use this exact structure. Note the example below has two items in Day 1 of "packed" to show the pattern, apply the same item shape throughout both itineraries:

{
  "packed": {
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
  },
  "slow": {
    "label": "Slow & Immersive",
    "tagline": "short tagline for this plan",
    "divergenceLabel": "one sentence on what makes this plan distinct",
    "days": []
  }
}`;

  // Two full itineraries in one response, each day needing ~6 items x ~7
  // fields (~150-200 tokens/item). At MAX_TRIP_DAYS (3 days), that's
  // roughly 3 x 2 x 6 x 175 =~ 6,300 tokens - the old 8192 ceiling left
  // barely any margin, and longer trips (this app used to allow up to 14
  // days) blew straight past it, truncating mid-JSON and failing to parse.
  // 16000 gives real headroom at the current 3-day cap; if MAX_TRIP_DAYS
  // (src/utils/date.js) ever goes up, this needs to scale with it.
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    messages: [
      { role: 'user', content: prompt }
    ],
  });

  let rawText = message.content[0].text.trim();

  if (rawText.startsWith('```')) {
    rawText = rawText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (parseError) {
    const err = new Error('Claude did not return valid JSON');
    err.rawText = rawText;
    throw err;
  }

  if (parsed.packed) {
    computePacing(parsed.packed, 'Busy');
  }
  if (parsed.slow) {
    computePacing(parsed.slow, 'Relaxed');
  }

  return parsed;
}
