import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// These options are intentionally NOT verified against Google Places. They're
// plausible, Claude-generated placeholders for the accommodation picker (name,
// price, description), a fast stand-in for a real hotel-search feature. Never
// treat these as verified data the way itinerary places are, and never show a
// photo for them, there's no real photo to show.
export async function generateAccommodationOptions(params) {
  const destination = params.destination;
  const budget = params.budget;

  const prompt = `You are generating placeholder accommodation options for a travel planning app's demo.

Destination: ${destination}
Budget tier: ${budget} (one of Economy, Standard, Luxury)

Generate 3 plausible accommodation options (hotels, guesthouses, or villas) for this destination at this budget tier. These do not need to be real businesses, they're realistic placeholders standing in for a future real hotel-search feature. Keep pricing and style consistent with the budget tier and destination.

For each option provide:
- "name": a plausible accommodation name
- "categoryTag": format "Type · Descriptor", e.g. "Hotel · Seafront", "Villa · Hillside", "Guesthouse · City center"
- "description": one short sentence
- "rating": a plausible number between 3.5 and 4.9
- "ratingCount": a plausible review count appropriate for the rating (e.g. 80-15000)
- "pricePerNight": a plausible nightly price in EUR as a number, appropriate for the budget tier and destination's cost of living
- "mealTag": "Breakfast included" or null

Respond with ONLY valid JSON, no markdown formatting, no code fences, no extra commentary. Use this exact structure:

{
  "options": [
    {
      "name": "string",
      "categoryTag": "string",
      "description": "string",
      "rating": 4.5,
      "ratingCount": 1200,
      "pricePerNight": 85,
      "mealTag": "Breakfast included"
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
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

  return parsed;
}
