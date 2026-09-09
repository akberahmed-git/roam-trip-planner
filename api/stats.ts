import { timingSafeEqual } from 'node:crypto';
import { recordEvent, readStats, toCsv, COLUMNS } from './_lib/stats.js';

// POST: a beacon from the app (see src/utils/track.ts). No token, always 204.
// GET:  the log, for the owner only. Needs STATS_TOKEN, set in Vercel and
//       never written down anywhere else.
//
//   /api/stats?token=...                       last 1,000 generations, JSON
//   /api/stats?token=...&format=csv            same, as a CSV download
//   /api/stats?token=...&list=events&limit=5000
//
// A wrong or missing token gets a 404, not a 401, so the endpoint does not
// advertise itself to anyone poking at the API (Akber, 9 Sep 2026).

function tokenMatches(given, expected) {
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    await recordEvent(req, req.body);
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!tokenMatches(req.query.token || bearer, process.env.STATS_TOKEN)) {
    return res.status(404).end();
  }

  const list = req.query.list === 'events' ? 'events' : 'generations';
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 1000));
  const rows = await readStats(list, limit);

  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="roam-${list}.csv"`);
    return res.status(200).send(toCsv(rows, COLUMNS[list]));
  }

  res.status(200).json({ list, count: rows.length, rows });
}
