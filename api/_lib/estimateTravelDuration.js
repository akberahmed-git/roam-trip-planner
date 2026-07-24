import Anthropic from '@anthropic-ai/sdk';
import { MAX_TRAVEL_MINUTES } from './travelTime.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// transportMode mirrors travelTime.js's own convention ('No car or taxi'
// forces a walking estimate here too, same as the real routing path).
const NO_CAR = 'No car or taxi';

// Real travel-time calculation (travelTime.js) needs both stops' verified
// coordinates - when one or both sides of a gap in the itinerary never
// resolved to a real, verified place (see applyResolution in
// generate-resolved-itinerary.js), there's no coordinate pair to route
// between at all, and computeTravelTimes correctly leaves travelToNext null
// rather than inventing one.
//
// Per Akber's explicit call (9 Jul 2026): rather than leave that gap blank,
// this asks Claude for a plausible single-number duration instead, based on
// its own knowledge of the destination and these two named/described stops.
// Deliberately NOT labeled "estimated" in the UI, unlike the accommodation
// price fallback (estimatePriceRange.js) - Akber's choice, made with the
// trade-off understood: unlike the price fallback, there's no real
// coordinate or comparable data behind this number at all, only Claude's
// judgment about typical distances between similar places, so it carries
// more risk of being meaningfully wrong.
export async function estimateTravelDuration({
  fromName,
  fromDescription,
  toName,
  toDescription,
  destination,
  transportMode,
}) {
  const modeInstruction =
    transportMode === NO_CAR
      ? 'The traveller has no car or taxi, so this must be a walking estimate.'
      : 'Pick whichever of walking or driving is more realistic for this distance.';

  const prompt = `You are estimating a realistic travel time between two stops on a real person's day itinerary in ${destination}. Give your honest best single-number guess based on your knowledge of ${destination} and these two specific places - do not hedge or return a range.

Stop A: ${fromName}${fromDescription ? ` - ${fromDescription}` : ''}
Stop B: ${toName}${toDescription ? ` - ${toDescription}` : ''}

${modeInstruction}

Respond with ONLY valid JSON, no markdown formatting, no code fences, no commentary. Use this exact structure:

{ "minutes": 15, "mode": "walk" }

"mode" must be either "walk" or "drive". "minutes" must be a realistic whole number of minutes for that mode of transport between these two specific stops.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 128,
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
    const err = new Error('Claude did not return valid JSON for a travel duration estimate');
    err.rawText = rawText;
    throw err;
  }

  const minutes = Math.round(Number(parsed.minutes));
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Claude returned an invalid minutes value for a travel duration estimate');
  }
  // Same upper sanity bound the real routing path enforces (see
  // MAX_TRAVEL_MINUTES in travelTime.js). This fallback is the likeliest source
  // of an absurd value: when two stops are on different islands or otherwise
  // have no road route, the real Routes call returns null (no ROUTE_EXISTS) and
  // this estimate fires instead, where Claude may reason its way to a ferry- or
  // flight-scale number like 900. Throwing here lets fillMissingTravelTimes'
  // catch leave the gap null - far better than cascading a 15-hour leg that
  // pushes the itinerary into the next day.
  if (minutes > MAX_TRAVEL_MINUTES) {
    throw new Error(`Estimated travel duration ${minutes} min exceeds the ${MAX_TRAVEL_MINUTES} min cap`);
  }
  const modeLabel = parsed.mode === 'drive' ? 'drive' : 'walk';

  // Same "${minutes} minute ${walk|drive}" format travelTime.js's own
  // formatTravelLabel produces, so this slots straight into item.travelToNext
  // without the UI or the drive-cap parsing needing to know the difference.
  return `${minutes} minute ${modeLabel}`;
}
