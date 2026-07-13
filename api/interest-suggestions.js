import { getInterestSuggestions } from './_lib/interestSuggestions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const destination = req.body.destination;
  if (!destination) {
    return res.status(400).json({ error: 'destination is required' });
  }

  try {
    const { interests } = await getInterestSuggestions(destination);
    res.status(200).json({ interests });
  } catch (error) {
    if (error.rawText) {
      return res.status(500).json({ error: error.message, raw: error.rawText });
    }
    res.status(500).json({ error: error.message });
  }
}
