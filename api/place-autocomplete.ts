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
    res.status(500).json({ error: error.message });
  }
}
