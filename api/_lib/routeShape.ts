// How a day looks as a line on a map. Extracted so that everything which can
// change the order of a day measures it the same way - the geographic reorder,
// the scheduler's block rebalancing, and the demo audit that rejects a
// generation for doubling back. They used to each have their own copy or none
// at all, and a pass that reordered a day without consulting this could undo
// the reorder's work and only find out at audit time (Akber, 7 Sep 2026).

// Only long legs count towards a reversal. Two short hops within a
// neighbourhood can point any way they like without the day reading as a
// zig-zag; it is the four-kilometre haul back across town that does.
export const REORDER_LONG_LEG_METERS = 4000;
export const REORDER_REVERSAL_DEGREES = 140;

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angleGap(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

// Worst reversal in a sequence, and how far it walks. Ranked in that order: a
// day that doubles back is worse than a day that is merely a little longer.
export function shapeOf(locations) {
  let path = 0;
  const longBearings: number[] = [];
  for (let k = 0; k < locations.length - 1; k++) {
    const metres = haversineMeters(locations[k], locations[k + 1]);
    path += metres;
    if (metres >= REORDER_LONG_LEG_METERS) {
      longBearings.push(bearingBetween(locations[k], locations[k + 1]));
    }
  }
  let worstTurn = 0;
  for (let k = 0; k < longBearings.length - 1; k++) {
    worstTurn = Math.max(worstTurn, angleGap(longBearings[k], longBearings[k + 1]));
  }
  return { worstTurn, path };
}

// The same measurement taken straight off a day's items, for callers that
// reorder items rather than raw coordinates.
//
// Accommodation bookends are excluded, matching the demo audit exactly - which
// is the reason this function exists rather than each caller rolling its own.
// Including them looks defensible for about a minute (the traveller really does
// start and end at the hotel) and is wrong: leaving the hotel for a district
// 11 km away and coming home at night is the shape of every day, not a day that
// doubles back, and counting it flagged a perfectly good Harajuku day at 178
// degrees while the audit passed it.
export function dayShape(day) {
  const points = day.items
    .filter((item) => item.type !== 'accommodation' && item.location)
    .map((item) => item.location);
  return shapeOf(points);
}
