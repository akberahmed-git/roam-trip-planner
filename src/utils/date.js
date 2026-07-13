// Local-date (not UTC) ISO formatting. `Date.prototype.toISOString()`
// converts to UTC first, which can silently shift the date by a day
// depending on timezone and time of day - every place in this app that
// needs a "YYYY-MM-DD" string for a calendar day should use this instead,
// so "today" always means the same calendar day everywhere.
export function toLocalISODate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Longest trip the itinerary generator reliably supports in one shot.
// generateRawItinerary.js asks Claude for two full itineraries (Packed +
// Slow) in a single response - each day needs ~6 items x ~7 fields, so a
// 7-day trip pushes the response past its token budget and gets truncated
// mid-JSON ("Claude did not return valid JSON"). 3 days is also what this
// app's own default trip length already was, before this limit existed.
export const MAX_TRIP_DAYS = 2

// Whole nights between two "YYYY-MM-DD" strings (client-side mirror of the
// same calculation in api/_lib/hotelPricing.js). Returns null rather than 0
// or a negative number for missing/invalid input, so callers can tell "no
// dates yet" apart from a genuine same-day error.
export function nightsBetween(startDate, endDate) {
  if (!startDate || !endDate) return null
  const ms = new Date(endDate) - new Date(startDate)
  const nights = Math.round(ms / (1000 * 60 * 60 * 24))
  return nights > 0 ? nights : null
}
