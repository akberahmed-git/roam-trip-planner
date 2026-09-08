import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// When a stop fails verification the pipeline substitutes a real, photographed
// place from Google in its slot (backfillOrDropActivities, resolveMealPlaceholders,
// repositionStrandedMeals). The substitute's description CANNOT be the dropped
// stop's - that text was written about a different place, and inheriting it is
// exactly the failure those passes exist to prevent - so each of them writes a
// line out of Google's own data instead: "Landmark in Shibakoen.", "Restaurant
// in Oshiage.", "Museum in Toranomon."
//
// That is honest but it is not a description. It names a category and a postcode
// and tells the traveller nothing about why the stop is on their day. In the
// bundled Tokyo demo it hit 9 of 27 cards, including Zojo-ji - a major temple
// reduced to "Landmark in Shibakoen." - which is what Akber flagged on 7 Sep
// 2026: "how do we avoid random places that have no description or context?"
//
// So the substitutes get real copy, written for the place that actually shipped.
// One request for the whole itinerary rather than one per stop: it is a single
// round trip on a path that already makes several, and the model sees the day's
// other stops as context while it writes.
//
// The synthesised line stays as the fallback for every stop this fails to cover,
// so a bad or missing response can only leave things exactly as they are today.
const MODEL = 'claude-sonnet-4-5';

// The scratch field every substitution path sets alongside its synthesised
// line: the Google data the line was built from, which is also the only real
// evidence about the place available to write from. Stripped before the
// itinerary is returned, so it never reaches the client.
export function stripAdoptionMarkers(days) {
  for (const day of days) {
    for (const item of day.items) {
      delete item.adoptedFrom;
      // Scheduler scratch: the routed leg kept apart from the padded display
      // string. src/types.ts has no field for it and the fixture is TypeScript.
      delete item.routedMinutes;
      // placeTypes stays. It was deleted here because src/types.ts had no field
      // for it and the demo fixture is saved as TypeScript, so shipping it broke
      // the build. The field exists now, and stripping it was doing real damage:
      // the pipeline decides what a place is from Google's types, the demo audit
      // reads the shipped fixture, and with the types gone the audit fell back to
      // matching keywords against prose. A souvenir street whose description
      // mentions the temple it leads to counted as a temple for one and not the
      // other, which is the pipeline-and-audit disagreement that cost fifteen
      // generations in another guise (Akber, 8 Sep 2026).
    }
  }
}

export async function describeAdoptedStops(days, destination) {
  const pending: any[] = [];
  for (const day of days) {
    for (const item of day.items) {
      if (item.adoptedFrom && item.name) pending.push(item);
    }
  }
  if (pending.length === 0) return 0;

  const listed = pending
    .map((item, i) => {
      const source = item.adoptedFrom || {};
      const bits = [`${i + 1}. ${item.name}`];
      if (source.neighbourhood) bits.push(`neighbourhood: ${source.neighbourhood}`);
      if (Array.isArray(source.types) && source.types.length > 0) {
        bits.push(`Google categories: ${source.types.slice(0, 4).join(', ')}`);
      }
      if (item.mealType) bits.push(`this is the traveller's ${item.mealType}`);
      return bits.join(' | ');
    })
    .join('\n');

  const prompt = `These are real places in ${destination} that appear as stops on a traveller's itinerary. Write one short sentence for each describing what the place is and why someone would stop there.

${listed}

Rules:
- One sentence per place, roughly 15 to 25 words. Write it the way a good guidebook would, not the way a directory listing would.
- Describe the PLACE. Never state a travel time, a distance, a visit length, or a mode of transport - those numbers are measured elsewhere and shown on the same card, so anything written here can only contradict them.
- If you genuinely know the place, use what you know: what it is, what it is known for, what it feels like to be there.
- If you do NOT recognise it, say what it is from its categories and its neighbourhood and stop there. Do not invent history, founding dates, specialities, awards or reputation. A plain true sentence is far better than a vivid false one.
- No markdown, no names in bold, no exclamation marks.

Respond with ONLY valid JSON, no markdown formatting, no code fences, no commentary. An array of objects, one per numbered place above, in the same order:

[{ "n": 1, "description": "..." }]`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') return 0;

  let parsed;
  try {
    parsed = JSON.parse(block.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;

  let applied = 0;
  for (const entry of parsed) {
    const index = Number(entry?.n) - 1;
    const text = typeof entry?.description === 'string' ? entry.description.trim() : '';
    // A one-word answer, or an index pointing at nothing, leaves that stop on
    // its synthesised line rather than replacing a true sentence with a worse one.
    if (!Number.isInteger(index) || index < 0 || index >= pending.length) continue;
    if (text.length < 20) continue;
    pending[index].description = text;
    applied += 1;
  }
  return applied;
}
