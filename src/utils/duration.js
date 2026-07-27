// Human-readable durations. The itinerary stores stay lengths and travel legs
// as whole minutes (always in 15-minute increments), which read badly once they
// pass an hour - "315 min" forces the traveller to do the maths. These helpers
// render the same value as compact hours and minutes ("5h 15m"), used for both
// place/stay durations and the travel-leg labels, across every plan variant.

// minutes -> "5h 15m" | "1h" | "45m". Returns '' for a missing/zero value so
// callers can guard with a simple falsy check, exactly as they did with the raw
// minute count before.
export function formatDuration(minutes) {
  const total = Math.round(Number(minutes));
  if (!Number.isFinite(total) || total <= 0) {
    return '';
  }
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) {
    return `${hours}h ${mins}m`;
  }
  if (hours) {
    return `${hours}h`;
  }
  return `${mins}m`;
}

// Travel legs are stored as "<n> minute walk|drive|train" (see travelTime.js /
// scheduleRealign.js). This reformats only the number to the compact form while
// keeping the mode word, so "90 minute drive" becomes "1h 30m drive" and
// "20 minute walk" becomes "20m walk". Anything that doesn't match the expected
// shape is returned untouched, so an unexpected label never renders blank.
export function formatTravelLabel(label) {
  if (!label || typeof label !== 'string') {
    return label;
  }
  const match = /^(\d+)\s*minutes?\s+(.+)$/i.exec(label.trim());
  if (!match) {
    return label;
  }
  const pretty = formatDuration(parseInt(match[1], 10));
  if (!pretty) {
    return label;
  }
  return `${pretty} ${match[2]}`;
}
