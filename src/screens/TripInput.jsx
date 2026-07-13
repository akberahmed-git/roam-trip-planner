import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import DestinationAutocomplete from '../components/DestinationAutocomplete'
import DateRangePicker from '../components/DateRangePicker'
import SegmentedControl from '../components/SegmentedControl'
import { toLocalISODate, MAX_TRIP_DAYS } from '../utils/date'

// Always shown first, in this order, for every destination - the only
// categories universal enough that they never need a per-destination call
// (unlike "Nature", thin in dense cities, or the original "Nightlife"/
// "Bars" problem this whole rework exists to fix). Also what's shown before
// a destination is entered, and the safety net if interest-suggestions
// generation is slow, errors, or returns something unusable - deliberately
// no larger fallback list beyond these three, since a fixed list of extra
// categories can't be trusted to be appropriate for a destination generation
// failed to actually classify. The remaining seven chip slots are otherwise
// generated fresh per destination (see the effect below). Mirrors
// api/_lib/interestSuggestions.js's STAPLE_INTERESTS exactly - keep in sync.
const STAPLE_INTERESTS = ['Landmarks', 'Cuisine', 'Shopping']

// Same tier set Accommodation.jsx uses. Budget now lives here (Figma node
// 273:15525) and fully determines which tier's hotels load on Accommodation
// - no more live tab-switching there, see Accommodation.jsx.
const BUDGET_OPTIONS = ['Economy', 'Standard', 'Luxury']

// Upper bounds for the Travellers stepper - large enough for a real family
// or friend-group trip, small enough to stay realistic for a single
// itinerary and single hotel selection (this app doesn't split a group
// across rooms or plans). Previously uncapped, which let the count run
// away with itself (e.g. 46 adults) since only the decrement side was
// clamped via Math.max.
const MAX_ADULTS = 8
const MAX_CHILDREN = 6

// Debounced generation of the full interest-chip set for the entered
// destination. Soft enhancement, not a gate: see the effect below and
// interestSuggestions.js for the fail-open behaviour.
const SUGGESTIONS_DEBOUNCE_MS = 500
const MIN_DESTINATION_LENGTH = 3

function defaultDates() {
  const start = new Date()
  start.setDate(start.getDate() + 14)
  const end = new Date(start)
  end.setDate(end.getDate() + 2)
  return { start: toLocalISODate(start), end: toLocalISODate(end) }
}

function daysBetween(startStr, endStr) {
  const start = new Date(startStr)
  const end = new Date(endStr)
  const diffMs = end - start
  return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))
}

export default function TripInput() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tripParams, setTripParams } = useTrip()
  const { start: defaultStart, end: defaultEnd } = defaultDates()

  // Restoring a trip already submitted once (e.g. Accommodation's "Change
  // trip details" when a tier has no options, or any other "go back and
  // edit" affordance) should land the user exactly where they left off, not
  // a blank form - tripParams already holds everything submitted last time.
  // Clicking a Trending Locations card on Home is the one case that should
  // win over a restore: it navigates here with the place name as nav state
  // (see Home.jsx), explicitly asking for a different destination than
  // whatever was there before. Falls back to a blank form only when neither
  // applies (first time on this screen this session).
  const cameFromTrendingCard = Boolean(location.state?.destination)
  const [destination, setDestination] = useState(
    location.state?.destination || tripParams?.destination || ''
  )
  // Clamped on read, not just on click, so a stale restored value above the
  // new cap (e.g. from before MAX_ADULTS/MAX_CHILDREN existed) doesn't slip
  // back in via tripParams restore on back-navigation.
  const [adults, setAdults] = useState(
    Math.min(MAX_ADULTS, Math.max(1, tripParams?.adults ?? 2))
  )
  const [children, setChildren] = useState(
    Math.min(MAX_CHILDREN, Math.max(0, tripParams?.children ?? 0))
  )
  const [startDate, setStartDate] = useState(tripParams?.startDate || defaultStart)
  const [endDate, setEndDate] = useState(tripParams?.endDate || defaultEnd)
  const [budget, setBudget] = useState(tripParams?.budget || 'Standard')
  const transport = 'Car or taxi'
  const [interests, setInterests] = useState(() => new Set(tripParams?.interests || []))
  // The chip set actually shown - starts as the fallback and gets replaced
  // wholesale once generation resolves for a given destination. Not
  // filtered client-side; interest-suggestions.js decides the full set.
  // On a restore (see above), tripParams.interestOptions has the exact set
  // that was showing last time (tripParams.destination is always already
  // trimmed, from a prior submit), so re-use it directly instead of a bare
  // staples-only flash while a fresh generation call round-trips for a
  // destination that hasn't actually changed.
  const isRestoringInterests = !cameFromTrendingCard && tripParams?.interestOptions?.length > 0
  const [interestOptions, setInterestOptions] = useState(
    isRestoringInterests ? tripParams.interestOptions : STAPLE_INTERESTS
  )
  const [error, setError] = useState(null)

  const suggestionsDebounceRef = useRef(null)
  const suggestionsRequestIdRef = useRef(0)
  // Which destination (if any) the currently-displayed chip set was
  // generated for. Lets the short-destination branch below reset state only
  // when there's an actual transition to undo, rather than on every
  // keystroke of a still-short destination. Seeded on a restore so the
  // effect below treats the restored set as already up to date instead of
  // immediately firing a redundant generation call for an unchanged
  // destination.
  const generatedForRef = useRef(isRestoringInterests ? tripParams.destination : null)
  // The SUGGESTIONS_DEBOUNCE_MS wait only exists to avoid firing a call on
  // every keystroke while the destination is still being typed - it serves
  // no purpose when the destination was set in one shot by a deliberate
  // action instead (picking an autocomplete suggestion, or arriving here
  // with a Trending Locations card's destination already filled in). Akber's
  // report (9 Jul 2026): those cases still waited the full debounce plus the
  // generation call itself before chips updated, reading as sluggish for an
  // action that was already final - there was nothing left to debounce
  // against. Starts true for the Trending-card case since that destination
  // arrives pre-filled, in one shot, on mount - same reasoning as a picked
  // suggestion, just via nav state instead of a click.
  const skipDebounceRef = useRef(cameFromTrendingCard)

  useEffect(() => {
    const trimmed = destination.trim()
    clearTimeout(suggestionsDebounceRef.current)

    // Already showing the right set for this exact destination (restored,
    // or just generated a moment ago) - nothing to do.
    if (trimmed === generatedForRef.current) {
      return
    }

    if (trimmed.length < MIN_DESTINATION_LENGTH) {
      if (generatedForRef.current !== null) {
        generatedForRef.current = null
        suggestionsRequestIdRef.current += 1
        setInterestOptions(STAPLE_INTERESTS)
        setInterests(new Set())
      }
      return
    }

    const fireSuggestionsRequest = () => {
      const requestId = ++suggestionsRequestIdRef.current
      fetch('/api/interest-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: trimmed }),
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Request failed'))))
        .then((data) => {
          if (requestId !== suggestionsRequestIdRef.current) return
          const suggested = Array.isArray(data.interests) ? data.interests : []
          generatedForRef.current = trimmed
          // The chip set is genuinely different now - a prior selection may
          // not even exist under this destination's wording, so clear
          // rather than try to diff old selections against new labels.
          setInterestOptions(suggested.length > 0 ? suggested : STAPLE_INTERESTS)
          setInterests(new Set())
        })
        .catch(() => {
          // Fail open to the same fallback set the field starts with - a
          // generation hiccup should never leave Interests empty.
          if (requestId === suggestionsRequestIdRef.current) {
            generatedForRef.current = null
            setInterestOptions(STAPLE_INTERESTS)
            setInterests(new Set())
          }
        })
    }

    // A one-shot destination (autocomplete pick, or arriving from a
    // Trending card) skips the debounce entirely and fires right away - see
    // skipDebounceRef above. Still typing waits the usual
    // SUGGESTIONS_DEBOUNCE_MS so a call isn't fired on every keystroke.
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false
      fireSuggestionsRequest()
    } else {
      suggestionsDebounceRef.current = setTimeout(fireSuggestionsRequest, SUGGESTIONS_DEBOUNCE_MS)
    }

    return () => clearTimeout(suggestionsDebounceRef.current)
  }, [destination])

  // DestinationAutocomplete calls this with isSelection=true when the
  // change came from picking a suggestion (click or Enter) rather than a
  // keystroke - see skipDebounceRef above for why that distinction matters.
  function handleDestinationChange(value, isSelection) {
    if (isSelection) {
      skipDebounceRef.current = true
    }
    setDestination(value)
  }

  function toggleInterest(interest) {
    setInterests((prev) => {
      const next = new Set(prev)
      if (next.has(interest)) {
        next.delete(interest)
      } else {
        next.add(interest)
      }
      return next
    })
  }

  function handleSubmit(event) {
    event.preventDefault()

    const trimmedDestination = destination.trim()
    if (!trimmedDestination) {
      setError('Enter a destination to plan your trip.')
      return
    }

    const days = daysBetween(startDate, endDate)
    if (days < 1 || days > MAX_TRIP_DAYS) {
      setError(`Trip length must be between 1 and ${MAX_TRIP_DAYS} days.`)
      return
    }

    setError(null)

    setTripParams({
      destination: trimmedDestination,
      days,
      adults,
      children,
      startDate,
      endDate,
      budget,
      transport,
      interests: Array.from(interests),
      // Not used by itinerary generation - kept so a later "go back and
      // edit" can restore the exact chip set shown here instead of
      // re-rolling generation for a destination that hasn't changed.
      interestOptions,
    })

    navigate('/accommodation')
  }

  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <div>
            <h1>Plan a trip</h1>
            <p className="page-intro">Generate two personalised itinerary options to compare</p>
          </div>

          <form className="stack" onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <label className="form-label" htmlFor="destination">Destination</label>
              <DestinationAutocomplete
                id="destination"
                value={destination}
                onChange={handleDestinationChange}
                placeholder="e.g. Ksamil, Albania"
                autoFocus
              />
            </div>

            <div className="form-field">
              <span className="form-label">Travellers</span>
              <div className="card travellers-card">
                <div className="traveller-row">
                  <span>Adults</span>
                  <div className="stepper">
                    <button
                      type="button"
                      className="stepper-button"
                      onClick={() => setAdults((n) => Math.max(1, n - 1))}
                      disabled={adults <= 1}
                      aria-label="Decrease adults"
                    >
                      −
                    </button>
                    <span className="stepper-count">{adults}</span>
                    <button
                      type="button"
                      className="stepper-button"
                      onClick={() => setAdults((n) => Math.min(MAX_ADULTS, n + 1))}
                      disabled={adults >= MAX_ADULTS}
                      aria-label="Increase adults"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="traveller-row traveller-row--last">
                  <span>Children</span>
                  <div className="stepper">
                    <button
                      type="button"
                      className="stepper-button"
                      onClick={() => setChildren((n) => Math.max(0, n - 1))}
                      disabled={children <= 0}
                      aria-label="Decrease children"
                    >
                      −
                    </button>
                    <span className="stepper-count">{children}</span>
                    <button
                      type="button"
                      className="stepper-button"
                      onClick={() => setChildren((n) => Math.min(MAX_CHILDREN, n + 1))}
                      disabled={children >= MAX_CHILDREN}
                      aria-label="Increase children"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-field">
              <span className="form-label">Dates</span>
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                maxDays={MAX_TRIP_DAYS}
                onChange={(nextStart, nextEnd) => {
                  setStartDate(nextStart)
                  setEndDate(nextEnd)
                }}
              />
            </div>

            <div className="form-field">
              <span className="form-label">Budget</span>
              <SegmentedControl options={BUDGET_OPTIONS} value={budget} onChange={setBudget} />
            </div>

            <div className="form-field">
              <span className="form-label">Interests</span>
              <div className="card interests-card">
                {interestOptions.map((interest) => (
                  <button
                    type="button"
                    key={interest}
                    className={`chip ${interests.has(interest) ? 'chip--selected' : ''}`}
                    onClick={() => toggleInterest(interest)}
                  >
                    {interest}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="form-error">{error}</p>}

            <button type="submit" className="button-primary button-full">
              Continue
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  )
}
