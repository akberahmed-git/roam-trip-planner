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
  const longLegs: { bearing: number; from: number }[] = [];
  for (let k = 0; k < locations.length - 1; k++) {
    const metres = haversineMeters(locations[k], locations[k + 1]);
    path += metres;
    if (metres >= REORDER_LONG_LEG_METERS) {
      longLegs.push({ bearing: bearingBetween(locations[k], locations[k + 1]), from: k });
    }
  }
  // worstAt is the stop the day turns around on: the point shared by the two
  // legs that reverse. Reported because knowing a day doubles back is not much
  // use on its own - the repair needs to know which stop to replace, and the
  // stop furthest from the day's centre is often not it. A Shinjuku nightclub
  // 2.6 km from the centre, between two Roppongi stops, was inside every
  // distance test and still turned the day 174 degrees (Akber, 7 Sep 2026).
  let worstTurn = 0;
  let worstAt = -1;
  for (let k = 0; k < longLegs.length - 1; k++) {
    const turn = angleGap(longLegs[k].bearing, longLegs[k + 1].bearing);
    if (turn <= worstTurn) continue;
    worstTurn = turn;

    if (longLegs[k + 1].from === longLegs[k].from + 1) {
      // The two legs meet, so one stop is the corner the day turns on.
      worstAt = longLegs[k + 1].from;
      continue;
    }

    // The legs do not meet, so the reversal spans an excursion: the day travels
    // a long way out, does several things, and comes a long way back. This used
    // to return -1 here, on the reasoning that no single stop is at fault, and
    // repositionStrandedStops then had a day it knew was bent and nothing to
    // aim at, so it did nothing at all.
    //
    // Worse, because only the WORST turn was kept, a day carrying an
    // unattributable 160-degree reversal and a perfectly fixable 155-degree one
    // discarded the fixable one and repaired neither. That is a real Tokyo
    // draft: breakfast in Harajuku, three stops in Asakusa 9.5 km northeast,
    // then back southwest to Toranomon.
    //
    // Something IS at fault there, and it is the stop the day set off from. The
    // excursion is a cluster; the departure point is the one place standing
    // apart from it. Aim at that (Akber, 8 Sep 2026).
    worstAt = longLegs[k].from;
  }
  return { worstTurn, worstAt, path };
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
