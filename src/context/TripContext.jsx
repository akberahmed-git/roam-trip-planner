import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const TripContext = createContext(null)

// In-progress trip is mirrored to sessionStorage so a full-page reload (a
// refresh, a hard navigation into a mid-flow route, or a testing tool
// re-entering the site) rehydrates the flow instead of booting empty and
// bouncing the user back to the start. sessionStorage (not localStorage) is
// deliberate: this is ephemeral in-progress state that should survive a reload
// within the same session but not resurrect a half-finished trip days later.
// Finished trips are saved separately and explicitly (see utils/savedTrips).
const STORAGE_KEYS = {
  tripParams: 'roam.inProgress.tripParams',
  resolvedItinerary: 'roam.inProgress.resolvedItinerary',
  selectedVariant: 'roam.inProgress.selectedVariant',
}

function readStored(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    // sessionStorage unavailable (private mode, disabled) or corrupt JSON -
    // fall back to no persisted state rather than crash the app on boot.
    return null
  }
}

function writeStored(key, value) {
  try {
    if (value == null) {
      sessionStorage.removeItem(key)
    } else {
      sessionStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    // Quota exceeded or storage unavailable - skip persisting rather than
    // break the flow. Worst case a reload doesn't restore, same as before.
  }
}

export function TripProvider({ children }) {
  const [tripParams, setTripParams] = useState(() => readStored(STORAGE_KEYS.tripParams))
  const [resolvedItinerary, setResolvedItinerary] = useState(() => readStored(STORAGE_KEYS.resolvedItinerary))
  const [selectedVariant, setSelectedVariant] = useState(() => readStored(STORAGE_KEYS.selectedVariant))
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [errorMessage, setErrorMessage] = useState(null)

  // Mirror the three flow-critical pieces of state to sessionStorage on every
  // change, so a reload rehydrates them (see STORAGE_KEYS above). Setting any
  // of them to null - e.g. via resetTrip - clears its stored copy too.
  useEffect(() => { writeStored(STORAGE_KEYS.tripParams, tripParams) }, [tripParams])
  useEffect(() => { writeStored(STORAGE_KEYS.resolvedItinerary, resolvedItinerary) }, [resolvedItinerary])
  useEffect(() => { writeStored(STORAGE_KEYS.selectedVariant, selectedVariant) }, [selectedVariant])

  const generateItinerary = useCallback(async (params) => {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const response = await fetch('/api/generate-resolved-itinerary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody.error || `Request failed with status ${response.status}`)
      }

      const data = await response.json()
      setResolvedItinerary(data)
      setStatus('success')
      return data
    } catch (err) {
      setErrorMessage(err.message || 'Something went wrong while planning your trip.')
      setStatus('error')
      throw err
    }
  }, [])

  // Tracks which days currently have a recompute in flight, keyed by
  // "variantKey:dayIndex" - lets screens show a real loading state instead
  // of nothing while a swap/reorder recompute is running. Added 9 Jul 2026:
  // Akber reported travel indicators taking "a minute" to reappear after a
  // swap, with no on-screen sign anything was happening in the meantime -
  // that read as broken even though it was just a slow, silent fetch (see
  // fillMissingTravelTimes's parallelization fix in scheduleRealign.js for
  // the other half of this).
  const [pendingRecomputes, setPendingRecomputes] = useState(() => new Set())
  // Guards against a stale response overwriting a newer one - if a second
  // swap/reorder lands on the same day before the first recompute's request
  // has returned, each day tracks its own monotonically increasing request
  // id here, and a response is only applied (and only clears the pending
  // flag) if it's still the most recent request for that day.
  const recomputeRequestIds = useRef({})

  function dayRecomputeKey(variantKey, dayIndex) {
    return `${variantKey}:${dayIndex}`
  }

  const isDayRecomputing = useCallback(
    (variantKey, dayIndex) => pendingRecomputes.has(dayRecomputeKey(variantKey, dayIndex)),
    [pendingRecomputes]
  )

  // Fire-and-forget follow-up to reorderDayItem/swapDayItem below - both
  // clear the stale travelToNext values synchronously first (so nothing
  // wrong is ever shown, even briefly), then call this in the background to
  // get real numbers back. Posts the day's current items to the server,
  // which runs the exact same real-routing + Claude-estimate-fallback +
  // schedule-realignment pipeline generate-resolved-itinerary.js's initial
  // generation uses (see api/_lib/scheduleRealign.js), then patches the
  // response back in once it lands. If the request fails, the cleared
  // (null) values from the synchronous step are left as they are - no
  // travel indicator shown is still safer than silently keeping a stale
  // one.
  const recomputeDayTravelTimes = useCallback((variantKey, dayIndex, items, destination, transport) => {
    const key = dayRecomputeKey(variantKey, dayIndex)
    const requestId = (recomputeRequestIds.current[key] || 0) + 1
    recomputeRequestIds.current[key] = requestId

    setPendingRecomputes((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))

    fetch('/api/recompute-day-travel-times', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination, transport, items }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Request failed'))))
      .then((data) => {
        // A newer swap/reorder on this same day already started a fresher
        // request - drop this now-stale response rather than overwrite
        // newer (possibly already-applied) data with older data.
        if (recomputeRequestIds.current[key] !== requestId) return
        setResolvedItinerary((prev) => {
          if (!prev || !prev[variantKey]) return prev
          const variant = prev[variantKey]
          const days = variant.days.map((day, di) => (di === dayIndex ? { ...day, items: data.items } : day))
          return { ...prev, [variantKey]: { ...variant, days } }
        })
      })
      .catch(() => {
        // Leave the cleared values in place - see comment above.
      })
      .finally(() => {
        // Only clear the pending flag if this was still the latest request -
        // an older, superseded request finishing after a newer one started
        // shouldn't flip the loading state off while the newer one is still
        // running.
        if (recomputeRequestIds.current[key] === requestId) {
          setPendingRecomputes((prev) => {
            if (!prev.has(key)) return prev
            const next = new Set(prev)
            next.delete(key)
            return next
          })
        }
      })
  }, [])

  // Swaps two adjacent items within one day's list (direction: -1 up, +1
  // down). travelToNext for every item in that day is cleared immediately
  // rather than shifted along with the reorder - it described real travel
  // time for the old adjacency, and there's no honest number for the new one
  // to show yet. Matches the "never show a stale number as if it's current"
  // rule used elsewhere (e.g. the Transport "no car" fallback).
  // recomputeDayTravelTimes then fetches real replacements in the
  // background and patches them in once they're back.
  const reorderDayItem = useCallback((variantKey, dayIndex, itemIndex, direction) => {
    let updatedItems = null
    setResolvedItinerary((prev) => {
      if (!prev || !prev[variantKey]) return prev
      const variant = prev[variantKey]
      const days = variant.days.map((day, di) => {
        if (di !== dayIndex) return day
        const targetIndex = itemIndex + direction
        if (targetIndex < 0 || targetIndex >= day.items.length) return day
        const items = [...day.items]
        ;[items[itemIndex], items[targetIndex]] = [items[targetIndex], items[itemIndex]]
        updatedItems = items.map((item) => ({ ...item, travelToNext: null }))
        return { ...day, items: updatedItems }
      })
      return { ...prev, [variantKey]: { ...variant, days } }
    })
    if (updatedItems) {
      recomputeDayTravelTimes(variantKey, dayIndex, updatedItems, tripParams?.destination, tripParams?.transport)
    }
  }, [tripParams, recomputeDayTravelTimes])

  // Replaces one item (by day + index) with a swap alternative the user
  // picked on the Swap screen. Same immediate-clear rule as reordering
  // applies here, but to BOTH legs touching the swapped item, not just its
  // own outgoing one: the previous item's travelToNext described real travel
  // time to whatever place used to be at this position, and swapping in a
  // new place at a different location makes that number stale too - it was
  // being left in place before, silently describing travel to a place that's
  // no longer there. recomputeDayTravelTimes then fetches real replacements
  // for the whole day in the background and patches them in once they're
  // back.
  const swapDayItem = useCallback((variantKey, dayIndex, itemIndex, replacement) => {
    let updatedItems = null
    setResolvedItinerary((prev) => {
      if (!prev || !prev[variantKey]) return prev
      const variant = prev[variantKey]
      const days = variant.days.map((day, di) => {
        if (di !== dayIndex) return day
        const items = day.items.map((item, ii) => {
          if (ii === itemIndex) {
            return { ...item, ...replacement, travelToNext: null }
          }
          if (ii === itemIndex - 1) {
            return { ...item, travelToNext: null }
          }
          return item
        })
        updatedItems = items
        return { ...day, items }
      })
      return { ...prev, [variantKey]: { ...variant, days } }
    })
    if (updatedItems) {
      recomputeDayTravelTimes(variantKey, dayIndex, updatedItems, tripParams?.destination, tripParams?.transport)
    }
  }, [tripParams, recomputeDayTravelTimes])

  // For a saved trip with a real, pre-captured result (see src/data/savedTrips)
  // - sets the same state generateItinerary's success path would, just
  // synchronously from bundled data instead of a live request. Still a real,
  // Places-verified result under the hood, it was just generated once ahead
  // of time rather than on this click.
  const loadSavedItinerary = useCallback((data) => {
    setErrorMessage(null)
    setResolvedItinerary(data)
    setStatus('success')
  }, [])

  // "Delete itinerary" on Comparison - wipes the in-progress trip (params +
  // generated result) back to the same blank state a fresh page load starts
  // from. This only clears context, not localStorage - a trip only lands in
  // "My trips" if the user explicitly hit Save on Finalise & Save, so
  // there's nothing persisted to also delete at this stage.
  const resetTrip = useCallback(() => {
    setTripParams(null)
    setResolvedItinerary(null)
    setSelectedVariant(null)
    setStatus('idle')
    setErrorMessage(null)
  }, [])

  const value = {
    tripParams,
    setTripParams,
    resolvedItinerary,
    selectedVariant,
    setSelectedVariant,
    status,
    errorMessage,
    generateItinerary,
    loadSavedItinerary,
    reorderDayItem,
    swapDayItem,
    isDayRecomputing,
    resetTrip,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export function useTrip() {
  const context = useContext(TripContext)
  if (!context) {
    throw new Error('useTrip must be used within a TripProvider')
  }
  return context
}
