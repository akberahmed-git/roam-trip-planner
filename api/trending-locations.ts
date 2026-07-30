import { getTrendingLocations } from './_lib/trendingLocations';

export default async function handler(req, res) {
  try {
    const locations = await getTrendingLocations();
    res.status(200).json({ locations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
