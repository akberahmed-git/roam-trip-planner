import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Google Places' `priceRange` field is confirmed (empirically, 8 Jul 2026 -
// null across every hotel tested in multiple destinations, including
// flagship properties like The Plaza and Mandarin Oriental New York) to not
// be populated for the lodging category in practice, despite being listed
// as available for Text Search in Google's docs. Real per-hotel pricing
// (Xotelo) was already tried and removed once for quota/reliability reasons
// - see hotelSearch.js history.
//
// This is the deliberate alternative: a plausible per-tier nightly range
// from Claude's general knowledge, grounded in the actual hotel names shown
// (Claude may recognize specific chains/properties and estimate more
// accurately) but ALWAYS returned with `estimated: true` and shown with a
// visible "Estimated" badge in the UI - reusing the app's existing
// confidence-badge design language (--color-estimated-* tokens) rather than
// presenting a guess as a verified figure. This is the one deliberate
// exception to "never fabricate" elsewhere in this app, and it's only
// acceptable because it's visibly labeled as an estimate, never silent.
export async function estimatePriceRanges({ destination, currencyCode, hotelsByTier }) {
  const tierLines = Object.entries(hotelsByTier)
    .map(([tier, hotels]) => {
      const names = (hotels || []).map((hotel) => hotel.name).filter(Boolean).join(', ')
      return `- ${tier}: ${names || 'no specific hotels found for this tier'}`;
    })
    .join('\n');

  const prompt = `You are estimating typical hotel nightly price ranges for a travel planning app. This estimate will be clearly labeled "Estimated" to the user, so it should be your honest best judgment, not a hedge - give a specific, realistic range.

Destination: ${destination}
Currency: ${currencyCode}

For each budget tier below, real hotels are listed that a user will see in that tier. Estimate a realistic nightly price range (in whole ${currencyCode} units, no currency symbols or commas) for hotels of that caliber in ${destination}. If you recognize the specific hotel names, ground your estimate in what you know about their typical rates. If not, use your knowledge of typical rates for similar hotels in this destination and tier.

${tierLines}

Respond with ONLY valid JSON, no markdown formatting, no code fences, no commentary. Use this exact structure:

{
  "Economy": { "min": 45, "max": 75 },
  "Standard": { "min": 90, "max": 140 },
  "Luxury": { "min": 220, "max": 450 }
}

Only include tiers that were listed above. Every tier listed must get a real, specific numeric estimate - never omit a tier or return null.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
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
    const err = new Error('Claude did not return valid JSON for a price estimate');
    err.rawText = rawText;
    throw err;
  }

  return parsed;
}
