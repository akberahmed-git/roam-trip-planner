const WALK_ATTEMPT_THRESHOLD_METERS = 3000;
const MAX_WALK_MINUTES = 25;

function haversineMeters(a, b) {
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

function parseDurationSeconds(durationStr) {
  if (!durationStr) {
    return null;
  }
  const seconds = parseInt(durationStr.replace('s', ''), 10);
  return Number.isNaN(seconds) ? null : seconds;
}

async function routeDuration(origin, destination, mode) {
  const body = {
    origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
    destinations: [{ waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } } }],
    travelMode: mode,
  };

  const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : null;

  if (!result || result.condition !== 'ROUTE_EXISTS') {
    return null;
  }

  const seconds = parseDurationSeconds(result.duration);
  if (seconds === null) {
    return null;
  }

  return Math.max(1, Math.round(seconds / 60));
}

function formatTravelLabel(minutes, mode) {
  const modeLabel = mode === 'WALK' ? 'walk' : 'drive';
  return `${minutes} minute ${modeLabel}`;
}

// transportMode mirrors TripInput.jsx's Transport field values directly
// ('Car or taxi' / 'No car or taxi', undefined for anything generated before
// that field existed - treated the same as 'Car or taxi' for backward
// compatibility with older tripParams/saved trips).
const NO_CAR = 'No car or taxi';

export async function travelBetween(origin, destination, transportMode) {
  // "No car or taxi" means walking is the only real mode available, so it's
  // always shown, however long - the MAX_WALK_MINUTES/distance cap below
  // exists only to decide when it's reasonable to prefer a walk over
  // driving for someone who has a car, which doesn't apply here. Previously
  // this fell through to the same capped check as the car/taxi path and
  // returned null (no indicator at all) for anything past ~3km or 25
  // minutes on foot - wrong for someone who explicitly has no other option.
  if (transportMode === NO_CAR) {
    try {
      const walkMinutes = await routeDuration(origin, destination, 'WALK');
      return walkMinutes !== null ? formatTravelLabel(walkMinutes, 'WALK') : null;
    } catch {
      return null;
    }
  }

  const straightLineMeters = haversineMeters(origin, destination);

  // Straight-line distance is only a hint: real walking paths (coastlines, hills,
  // one-way streets) can be much longer than the straight line. So for anything
  // plausibly walkable, ask for the actual walking duration and only keep it if
  // it's still a reasonable walk. Otherwise (or if that check fails), fall back
  // to driving.
  if (straightLineMeters <= WALK_ATTEMPT_THRESHOLD_METERS) {
    try {
      const walkMinutes = await routeDuration(origin, destination, 'WALK');
      if (walkMinutes !== null && walkMinutes <= MAX_WALK_MINUTES) {
        return formatTravelLabel(walkMinutes, 'WALK');
      }
    } catch {
      // fall through to drive attempt
    }
  }

  try {
    const driveMinutes = await routeDuration(origin, destination, 'DRIVE');
    if (driveMinutes === null) {
      return null;
    }
    return formatTravelLabel(driveMinutes, 'DRIVE');
  } catch {
    return null;
  }
}

export async function computeTravelTimes(items, transportMode) {
  const pairs = [];
  for (let i = 0; i < items.length - 1; i++) {
    const current = items[i];
    const next = items[i + 1];
    if (current.location && next.location) {
      pairs.push({ index: i, origin: current.location, destination: next.location });
    } else {
      current.travelToNext = null;
    }
  }

  const results = await Promise.all(
    pairs.map((pair) => travelBetween(pair.origin, pair.destination, transportMode))
  );

  pairs.forEach((pair, i) => {
    items[pair.index].travelToNext = results[i];
  });

  if (items.length > 0) {
    items[items.length - 1].travelToNext = null;
  }
}
