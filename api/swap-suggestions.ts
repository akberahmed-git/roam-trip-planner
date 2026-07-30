import { getSwapSuggestions } from './_lib/swapSuggestions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const placeName = req.body.placeName;
  const categoryTag = req.body.categoryTag;
  const destination = req.body.destination;
  const excludeNames = req.body.excludeNames;
  const interests = req.body.interests;

  if (!placeName || !destination) {
    return res.status(400).json({ error: 'placeName and destination are required' });
  }

  try {
    const alternatives = await getSwapSuggestions({
      placeName,
      categoryTag,
      destination,
      excludeNames,
      interests,
    });
    res.status(200).json({ alternatives });
  } catch (error) {
    if (error.rawText) {
      return res.status(500).json({ error: error.message, raw: error.rawText });
    }
    res.status(500).json({ error: error.message });
  }
}
