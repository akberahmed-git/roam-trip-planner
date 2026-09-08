// Real static map image via Google's Maps Static API, proxied server-side so
// the API key never reaches the browser (same pattern as place-photo.js).
// Pins are placed at the day's actual verified coordinates (item.location,
// added to the data contract by travelTime.js's work) using Google's own
// `markers` parameter, rather than hand-rolling Mercator-projection pixel
// math - Google auto-fits center/zoom to the given markers, and renders the
// numbered pins itself at the exact real lat/lng.
//
// Since 8 Sep 2026 the markers are not Google's. See the handler.
//
// Requires the "Maps Static API" to be enabled on the same Google Cloud
// project as Places/Routes - not yet confirmed enabled as of this pass.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Two shapes of request.
  //
  // The current one: `center`, `zoom` and `path`, and Google draws only the
  // map tiles and the route line. The client works out the framing itself with
  // the same Mercator maths Google uses, so it can lay its own badges over the
  // image at the exact projected pixel - the same component as the numbered
  // circles in the list, at the same size at every width, always on top, and
  // nudged apart when two stops sit on the same corner.
  //
  // Google's own markers could not do that, and not for want of trying: its
  // labels are one character, custom icons are doubled by scale=2 and can never
  // be 28 CSS pixels at every screen width, and above all a request may carry
  // AT MOST FIVE unique custom icons. A packed day has ten markers, so home and
  // 1 to 4 drew as circles and 5 to 9 fell back to Google's red default pin
  // (Akber, 8 Sep 2026).
  //
  // The old one, `points`, is kept so a page that was already open keeps
  // getting a map through a deploy.
  const { points, center, zoom, path } = req.query;
  const framed = typeof center === 'string' && typeof zoom === 'string' && typeof path === 'string';
  if (!framed && !points) {
    return res.status(400).json({ error: 'center, zoom and path are required' });
  }

  const params = new URLSearchParams();
  // 3:2 was cropped by the page's 361:241 box, and a crop would throw the
  // overlay off. The image is requested at the box's own ratio instead.
  params.set('size', framed ? `${MAP_WIDTH}x${MAP_HEIGHT}` : '640x400');
  params.set('scale', '2');
  params.set('key', process.env.GOOGLE_PLACES_API_KEY ?? '');

  let markerQuery = '';
  let pathQuery = '';
  const isCoord = (value) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(value);

  if (framed) {
    if (!isCoord(center) || !/^\d{1,2}$/.test(zoom)) {
      return res.status(400).json({ error: 'center must be lat,lng and zoom an integer' });
    }
    params.set('center', center);
    params.set('zoom', zoom);
    const coords = path.split('|').filter(isCoord);
    if (coords.length >= 2) {
      pathQuery = '&path=' + encodeURIComponent(`color:0x0C869D|weight:3|${coords.join('|')}`);
    }
  } else {
    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const entries = String(points).split('|').filter(Boolean);
    const markerParams = entries
      .map((entry) => {
        const [label, coords] = entry.split(':');
        if (!coords || !isCoord(coords)) return null;
        if (label === 'h') return `icon:${origin}/map-pin-home-v2.png|${coords}`;
        const labelPart = /^[1-9]$/.test(label) ? `label:${label}|` : '';
        return `color:0x0C869D|${labelPart}${coords}`;
      })
      .filter(Boolean);
    if (markerParams.length === 0) {
      return res.status(400).json({ error: 'no valid points provided' });
    }
    markerQuery = '&' + markerParams.map((m) => 'markers=' + encodeURIComponent(String(m))).join('&');
    const coords = entries.map((entry) => entry.split(':')[1] || '').filter((c) => isCoord(c));
    if (coords.length >= 2) {
      pathQuery = '&path=' + encodeURIComponent(`color:0x0C869D|weight:3|${coords.join('|')}`);
    }
  }

  const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}${markerQuery}${pathQuery}`;

  try {
    const response = await fetch(googleUrl);
    if (!response.ok) {
      // Google's staticmap endpoint returns a plain-text error body (not
      // JSON) describing exactly what's wrong - e.g. "You must enable
      // Billing", "This API project is not authorized...". Surfacing that
      // text is far more useful for debugging than a bare 502.
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

// The image's pixel size before scale=2. 361:241 is the page's map box, so
// nothing is cropped and a projected pixel lands where the client expects it.
// Shared with the client through src/lib/mapFraming.ts, which owns the maths.
const MAP_WIDTH = 640;
const MAP_HEIGHT = 427;
