import { fetchDestinationSuggestions } from './_lib/autocompletePlaces.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const input = (req.query.input || '').trim();

  if (input.length < 2) {
    return res.status(200).json({ suggestions: [] });
  }

  try {
    const suggestions = await fetchDestinationSuggestions(input);
    res.status(200).json({ suggestions });
  } catch (error) {
    // The client treats any non-OK answer as "no suggestions", which is the
    // right degradation for a spent budget: the box goes quiet, typing works.
    if (error.rateLimited) {
      return res.status(429).json({ error: error.message, code: 'RATE_LIMITED', scope: 'global' });
    }
    res.status(500).json({ error: error.message });
  }
}
