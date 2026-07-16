export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ref, maxWidth } = req.query;

  if (!ref) {
    return res.status(400).json({ error: 'ref is required' });
  }

  const width = maxWidth || '800';

  try {
    const googleUrl =
      'https://places.googleapis.com/v1/' +
      ref +
      '/media?maxWidthPx=' +
      width +
      '&key=' +
      process.env.GOOGLE_PLACES_API_KEY;

    const response = await fetch(googleUrl);

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch photo from Google' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', contentType);
    // Photo references are stable per place, so a given photo never changes.
    // max-age caches it in each user's browser; s-maxage caches it at Vercel's
    // edge CDN so the FIRST request for a photo bills Google once and every
    // later request (any user, any session, both itinerary variants) is a CDN
    // hit that never re-invokes this function or re-bills the Place Details
    // Photos SKU. immutable skips revalidation; stale-while-revalidate serves
    // the cached copy instantly while any refresh happens in the background.
    res.setHeader(
      'Cache-Control',
      'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400, immutable'
    );
    res.status(200).send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
