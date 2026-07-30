import { searchAccommodations } from './_lib/hotelSearch.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const destination = req.body.destination;
  const checkInDate = req.body.checkInDate;
  const checkOutDate = req.body.checkOutDate;

  if (!destination) {
    return res.status(400).json({ error: 'destination is required' });
  }

  try {
    // Returns all three tiers at once, each with its own hotel list and a
    // real min-max nightly price range (not an individual price per hotel -
    // see hotelSearch.js for why), plus the destination's local currency
    // (independent of whether any hotel actually had a priceRange).
    const { options, priceRangeByTier, destinationCurrency } = await searchAccommodations({
      destination,
      checkInDate,
      checkOutDate,
    });
    res.status(200).json({ options, priceRangeByTier, destinationCurrency });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
