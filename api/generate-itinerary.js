import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { destination, days, budget, accommodation } = req.body;

  if (!destination || !days) {
    return res.status(400).json({ error: 'destination and days are required' });
  }

  const prompt = `You are generating a trip itinerary for a travel planning app.

Trip details:
- Destination: ${destination}
- Length: ${days} days
- Budget band: ${budget || 'mid-range'}
- Accommodation (routing anchor): ${accommodation || 'a centrally located hotel'}

Generate TWO different itineraries for this trip:
1. "Packed & Varied" — more activities per day, faster pace, wide variety of experiences.
2. "Slow & Immersive" — fewer activities per day, more time per place, a calmer pace.

For each itine, provide a day-by-day plan. Each day should include breakfast, lunch, dinner, and 1-3 activities, each with a real, specific place name (a real restaurant, attraction, or landmark that actually exists in ${destination}), not a generic description.

Respond with ONLY valid JSON, no markdown formatting, no code fences, no extra commentary. Use exactly this structure:

{
  "packed": {
    "label": "Packed & Varied",
    "days": [
      {
        "day": 1,
        "theme": "short theme for the day",
        "items": [
          { "time": "breakfast", "type": "meal", "name": "Place Name", "description": "one short sentence" },
          { "time": "morning", "type": "activity", "name": "Place Name", "description": "one short sentence" }
        ]
      }
    ]
  },
  "slow": {
    "label": "Slow & Immersive",
    "days": []
  }
}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    let rawText = message.content[0].text.trim();

    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseError) {
      return res.status(500).json({
        error: 'Claude did not return valid JSON',
        raw: rawText,
      });
    }

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
