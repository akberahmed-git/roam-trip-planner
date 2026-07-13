import { verifyPlace } from './_lib/verifyPlace.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const name = req.body.name;
  const destination = req.body.destination;
  const type = req.body.type;

  if (!name || !destination) {
    return res.status(400).json({ error: 'name and destination are required' });
  }

  const result = await verifyPlace({ name, destination, type });
  res.status(200).json(result);
}
