// Real (not fake) "My trips" persistence via localStorage - no backend
// exists for saved trips (see SCREEN-MAP.md: "Nav menu / saved trips:
// localStorage-based, no backend dependency"), so this is genuinely the
// full implementation, not a stub. Home.jsx merges this with its one
// hardcoded demo entry (Tokyo) for a max of 2 rows total in "My trips" -
// only the single most recent real save is ever kept, deliberately, so
// opening a saved trip always means "the last thing I actually planned"
// rather than picking through a long history.
const STORAGE_KEY = 'roam:savedTrips'
const MAX_SAVED_TRIPS = 1

export function getSavedTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Defensive cap on read, not just on write - trims any stale entries
    // left over from before MAX_SAVED_TRIPS was lowered (or from a future
    // lowering), without needing a one-off migration or the user manually
    // clearing storage. Newest-first order is already guaranteed by
    // saveTrip, so slicing here keeps the same "most recent" entries a
    // fresh write would have kept.
    return parsed.slice(0, MAX_SAVED_TRIPS)
  } catch {
    // Corrupt or inaccessible storage shouldn't break Home - just behave as
    // if nothing's been saved yet.
    return []
  }
}

export function saveTrip(trip) {
  try {
    const existing = getSavedTrips()
    // Newest first, capped so a long session of repeated saves doesn't grow
    // localStorage without bound.
    const next = [{ ...trip, savedAt: new Date().toISOString() }, ...existing].slice(0, MAX_SAVED_TRIPS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return next
  } catch {
    // Storage full/unavailable (e.g. private browsing) - the save silently
    // no-ops rather than throwing and blocking navigation back to Home.
    return getSavedTrips()
  }
}
