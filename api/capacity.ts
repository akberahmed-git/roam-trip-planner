import { peekRateLimit } from './_lib/rateLimit.js';

// "Is there planning budget left today?" - read-only, so asking costs nothing
// and never consumes the allowance being asked about.
//
// Called by TripInput on load so someone is told the day is spent before they
// fill in a form and pick a hotel, rather than after. The real enforcement
// still lives in generate-resolved-itinerary; this only decides what to show.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { available, scope } = await peekRateLimit('trip');
    // Never cached: a stale "available" would walk someone into the wall this
    // endpoint exists to keep them away from.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ available, scope });
  } catch {
    // Fail open, same as the limiter. A failed check should never stop someone
    // planning a trip.
    res.status(200).json({ available: true, scope: null });
  }
}
