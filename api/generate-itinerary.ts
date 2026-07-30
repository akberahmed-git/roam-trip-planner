import { generateRawItinerary } from './_lib/generateRawItinerary.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const destination = req.body.destination;
  const days = req.body.days;
  const budget = req.body.budget;
  const accommodation = req.body.accommodation;
  const interests = req.body.interests;

  if (!destination || !days) {
    return res.status(400).json({ error: 'destination and days are required' });
  }

  try {
    const parsed = await generateRawItinerary({ destination, days, budget, accommodation, interests });
    res.status(200).json(parsed);
  } catch (error) {
    if (error.rawText) {
      return res.status(500).json({ error: error.message, raw: error.rawText });
    }
    res.status(500).json({ error: error.message });
  }
}
