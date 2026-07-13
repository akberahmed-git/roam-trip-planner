// Fixes a real mismatch found in testing: a place called "Smack Burger" was
// shown described as "a chic brunch spot known for creative seasonal dishes
// and excellent coffee." Root cause: Claude writes an item's name and
// description together, in the same generation pass, before any real place
// has been looked up (see generateRawItinerary.js) - if it pairs a real,
// verifiable name with a description that doesn't actually fit that name
// (whether by hallucinating an inaccurate concept, or because
// generate-resolved-itinerary.js's applyResolution() substituted a
// different real business for a weak/failed match), nothing ever checks
// that the pairing itself makes sense.
//
// First pass at this only refreshed items where verification had changed
// the name (weak match score or a substitute) - which missed exactly the
// "Smack Burger" case, since that name was an exact match to begin with,
// substitution was never involved. This version audits every item's
// name/category against both its current description AND its meal tag
// (independently - a meal tag can be wrong even when the description reads
// fine on its own), replacing only the ones that are actually wrong, in one
// batched call per itinerary rather than one call per item.
//
// This is the second line of defense, not the only one: generateRawItinerary.js's
// prompt now also explicitly tells Claude to only assign a meal tag to a
// place whose real identity fits that meal, so most mismatches shouldn't
// reach this audit in the first place - this catches whatever still slips
// through.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function refreshDescriptions(items) {
  if (!items || items.length === 0) return;

  const itemLines = items
    .map((item, index) => {
      const parts = [`${index}. Name: "${item.name}"`];
      if (item.categoryTag) parts.push(`Category: ${item.categoryTag}`);
      if (item.mealType) parts.push(`Currently tagged as: ${item.mealType}`);
      parts.push(`Current description: "${item.description || ''}"`);
      return parts.join(', ');
    })
    .join('\n');

  const prompt = `You are auditing places in a trip-planning app's itinerary. Each place's NAME is real and confirmed to exist. The description and meal tag next to it were written earlier in a separate pass, before this real place was necessarily attached to the slot, and may not actually fit.

For each place below, judge TWO things independently:
1. Description fit: is the current description a plausible, accurate fit for a real place with this exact name and category? A restaurant named "Smack Burger" described as "a chic brunch spot known for creative seasonal dishes and excellent coffee" is a clear mismatch - the name signals a casual burger restaurant, and the description should never contradict what the name itself implies.
2. Meal tag fit (only if a meal tag is present): does this meal tag genuinely make sense for a place with this name/category, independent of whether its description happens to sound fine? A burger joint, steakhouse, bar, or nightclub tagged "breakfast" is wrong even if its current description was never touched or already sounds plausible - judge the name/category itself, not just the description text.

${itemLines}

Respond with ONLY valid JSON, no markdown formatting, no code fences, no commentary. An array, same order and length as the list above. For each item:
- If both the description and meal tag are reasonable fits, respond with {} (empty object) - leave it unchanged. Most items should get this.
- If the description is a clear mismatch, include a corrected one-sentence description grounded in what a real place with this name/category would actually be (same brief, appealing style as the rest of the app).
- If the meal tag is wrong for this name/category - even when the description itself doesn't need to change - include a corrected "mealType" (one of "breakfast", "lunch", "dinner", or null to remove the tag). Include "mealType" whenever it needs correcting, not only alongside a description correction.

Example response shape:
[
  {},
  { "description": "Casual burger joint known for smash-style patties and quick service.", "mealType": "lunch" },
  {},
  { "mealType": "dinner" }
]`;

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
    // Non-fatal: whatever descriptions were already in place (right or
    // wrong) stay as-is, so a parse failure here shouldn't break generation.
    console.error('[refreshDescriptions] Claude did not return valid JSON:', rawText);
    return;
  }

  if (!Array.isArray(parsed)) return;

  items.forEach((item, index) => {
    const result = parsed[index];
    if (!result) return;
    if (typeof result.description === 'string' && result.description.trim()) {
      item.description = result.description.trim();
    }
    if ('mealType' in result) {
      item.mealType = result.mealType || null;
    }
  });
}
