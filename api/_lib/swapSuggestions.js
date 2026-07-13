// Real alternatives for the Swap screen (Figma node 273:16409). Same
// propose-then-verify shape as the rest of the app: Claude proposes 3
// candidate real places near the destination that could stand in for the
// one being swapped, each with a short "why swap" reasoning string, then
// every candidate is checked against Google Places the same way
// verifyPlace.js checks itinerary items. Only verified (status: 'found')
// candidates are ever returned - an unverified guess never reaches the UI,
// same "every place shown is real" rule as everywhere else in this app.
//
// "Why swap?" reasoning is Claude's own explanation, not a factual claim
// about the world, so it doesn't need an "estimated" label the way the
// Accommodation price range does - it's presented as AI reasoning, same as
// itinerary item descriptions elsewhere, and that's honest as-is.
//
// Busy time is deliberately never set here - the standard Places API doesn't
// expose it (see ROAM-BUILD-CONTEXT.md, "busyTime - gap") and nothing in the
// real pipeline fabricates it, so alternative cards simply omit that row
// rather than invent one.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CANDIDATE_COUNT = 3;

function typeLabelFor(types) {
  const list = types || [];
  if (list.includes('beach')) return 'Beach';
  if (list.includes('museum')) return 'Museum';
  if (list.includes('park') || list.includes('national_park')) return 'Park';
  if (list.includes('restaurant')) return 'Restaurant';
  if (list.includes('cafe')) return 'Café';
  if (list.includes('bar')) return 'Bar';
  if (list.includes('tourist_attraction')) return 'Attraction';
  if (list.includes('natural_feature')) return 'Natural landmark';
  return 'Place';
}

// Same diacritic/case-insensitive normalization used elsewhere (e.g.
// verifyPlace.js, trendingLocations.js) so "Café X" and "cafe x" are
// recognised as the same place when deduping against the rest of the
// itinerary.
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function photoUrlFor(place) {
  const photos = place.photos;
  if (!photos || photos.length === 0) return null;
  return '/api/place-photo?ref=' + encodeURIComponent(photos[0].name);
}

async function searchCandidate(name, destination) {
  const textQuery = name + ', ' + destination;
  let response;
  try {
    response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.photos,places.location,places.types',
      },
      body: JSON.stringify({ textQuery }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = await response.json();
  const place = data.places?.[0];
  if (!place || !place.displayName?.text || !place.rating || !place.userRatingCount) {
    return null;
  }

  return {
    placeId: place.id,
    name: place.displayName.text,
    categoryTag: typeLabelFor(place.types),
    rating: place.rating,
    ratingCount: place.userRatingCount,
    photoUrl: photoUrlFor(place),
    location: place.location ? { lat: place.location.latitude, lng: place.location.longitude } : null,
  };
}

async function proposeCandidates({ placeName, categoryTag, destination, excludeNames, interests }) {
  const excludeLine = excludeNames?.length
    ? `Do not suggest any of these places, already elsewhere in the same itinerary: ${excludeNames.join(', ')}.`
    : '';
  const interestsLine = interests?.length
    ? `The traveller's stated interests are: ${interests.join(', ')}. Prefer alternatives that fit these where reasonable.`
    : '';

  const prompt = `You are suggesting real alternative places for a trip-planning app's "swap" feature. The user wants to swap out one itinerary stop for something else nearby, similar in kind, that still fits the same slot in their day.

Destination: ${destination}
Place being swapped: ${placeName}${categoryTag ? ` (${categoryTag})` : ''}
${excludeLine}
${interestsLine}

Suggest exactly ${CANDIDATE_COUNT} real, specific, named places near ${destination} that could replace "${placeName}" in the itinerary - same general category and rough time commitment, genuinely real places you're confident exist (not invented), not duplicates of each other or of "${placeName}" itself.

For each, write a short one-to-two sentence "why swap" reason: what's different or appealing about this option compared to "${placeName}" specifically.

Respond with ONLY valid JSON, no markdown formatting, no code fences, no commentary. Use this exact structure:

[
  { "name": "Exact real place name", "reason": "Why swap reasoning here" }
]`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
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
    const err = new Error('Claude did not return valid JSON for swap suggestions');
    err.rawText = rawText;
    throw err;
  }

  return Array.isArray(parsed) ? parsed : [];
}

export async function getSwapSuggestions({ placeName, categoryTag, destination, excludeNames, interests }) {
  const candidates = await proposeCandidates({ placeName, categoryTag, destination, excludeNames, interests });

  const verified = await Promise.all(
    candidates.map(async (candidate) => {
      const result = await searchCandidate(candidate.name, destination);
      if (!result) return null;
      return { ...result, reason: candidate.reason || null };
    })
  );

  // Backstop against a duplicate/double-booking slipping through even if
  // Claude's proposal ignores the excludeNames instruction, or Google
  // Places' text search resolves a candidate to a place already elsewhere
  // in the itinerary under a slightly different name. Belt-and-braces with
  // the prompt-level exclusion above, not a replacement for it.
  const excludeSet = new Set((excludeNames || []).map(normalize));
  const deduped = verified.filter((result) => result && !excludeSet.has(normalize(result.name)));

  // Only real, Places-verified candidates ever reach the UI - an unverified
  // Claude suggestion is dropped silently rather than shown as a guess.
  return deduped.filter(Boolean);
}
