// Real static map image via Google's Maps Static API, proxied server-side so
// the API key never reaches the browser (same pattern as place-photo.js).
// Pins are placed at the day's actual verified coordinates (item.location,
// added to the data contract by travelTime.js's work) using Google's own
// `markers` parameter, rather than hand-rolling Mercator-projection pixel
// math - Google auto-fits center/zoom to the given markers, and renders the
// numbered pins itself at the exact real lat/lng.
//
// Known limitation: Google Static Maps marker labels only support a single
// uppercase alphanumeric character. Stops 10+ in one day get an unlabeled
// pin rather than an invalid two-digit label - itineraries in this app run
// well under that in practice (~6-8 stops/day).
//
// Requires the "Maps Static API" to be enabled on the same Google Cloud
// project as Places/Routes - not yet confirmed enabled as of this pass.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { points } = req.query;
  if (!points) {
    return res.status(400).json({ error: 'points is required' });
  }

  // Format: "label:lat,lng|label:lat,lng|..." - label is "1".."9" or empty.
  const entries = points.split('|').filter(Boolean);
  if (entries.length === 0) {
    return res.status(400).json({ error: 'no valid points provided' });
  }

  const markerParams = entries
    .map((entry) => {
      const [label, coords] = entry.split(':');
      if (!coords || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(coords)) return null;
      const labelPart = /^[1-9]$/.test(label) ? `label:${label}|` : '';
      return `color:0x0A6E83|${labelPart}${coords}`;
    })
    .filter(Boolean);

  if (markerParams.length === 0) {
    return res.status(400).json({ error: 'no valid points provided' });
  }

  const params = new URLSearchParams();
  params.set('size', '640x400');
  params.set('scale', '2');
  params.set('key', process.env.GOOGLE_PLACES_API_KEY);

  const markerQuery = markerParams.map((m) => 'markers=' + encodeURIComponent(m)).join('&');

  // Route line connecting stops in order. Uses the same teal as the pins
  // (0x0A6E83). Google Static Maps requires the path to be a separate
  // `path` query parameter - can't go through URLSearchParams since it
  // would double-encode the pipe-separated coord list.
  const coords = entries
    .map((entry) => {
      const [, coords] = entry.split(':');
      return coords && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(coords) ? coords : null;
    })
    .filter(Boolean);
  const pathQuery = coords.length >= 2
    ? '&path=' + encodeURIComponent(`color:0x0A6E83|weight:3|${coords.join('|')}`)
    : '';

  const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}&${markerQuery}${pathQuery}`;

  try {
    const response = await fetch(googleUrl);
    if (!response.ok) {
      // Google's staticmap endpoint returns a plain-text error body (not
      // JSON) describing exactly what's wrong - e.g. "You must enable
      // Billing", "This API project is not authorized...", "This IP,
      // site or mobile application is not authorized...". Surfacing that
      // text is far more useful for debugging than a bare 502, so we log
      // it server-side and echo it back in the response too.
      const detail = await response.text();
      console.error('static-map: Google returned', response.status, detail);
      return res.status(502).json({ error: 'Failed to fetch map from Google', status: response.status, detail });
    }
    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
