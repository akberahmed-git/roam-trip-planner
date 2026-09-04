import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import { DEMO_TRIPS } from '../data/demoTrips'
import Header from '../components/Header'
import Footer from '../components/Footer'
import Checklist from '../components/Checklist'

// Mirrors the real order of work in api/generate-resolved-itinerary.js:
// 1. generateRawItinerary() drafts both variants in a single Claude call.
// 2. resolveItinerary() checks every place in the itinerary against real
//    Google Places data (a real business, rating, address, photo, opening
//    hours) - run once per variant.
// 3. computeTravelTimes() calculates real travel time between consecutive
//    stops via Google Routes - also run once per variant.
// 4. the resolved result is packaged and returned to the browser.
// There's no backend signal for exactly which phase is running at any given
// moment (this is a single request/response, not a stream), so the ticks
// below are a timed simulation rather than a live progress feed - but each
// label describes something that genuinely happens in the pipeline, not an
// invented step. (The previous copy - "Estimating pacing for each day" and
// "Comparing packed vs. slow options" - didn't match anything real: pacing
// is trivial synchronous math computed the instant Claude responds, and
// there's no comparison step at all.)
const STEPS = [
  'Drafting two itinerary personalities',
  'Checking every place is real and open',
  'Calculating travel times between stops',
  'Finalizing your two itineraries',
]

const STEP_INTERVAL_MS = 3200

export default function Generating() {
  const navigate = useNavigate()
  const { tripParams, generateItinerary, status, errorMessage, loadSavedItinerary } = useTrip()
  const hasStarted = useRef(false)
  const [activeStep, setActiveStep] = useState(0)
  // Set when the daily spend cap turned the request away (see
  // api/_lib/rateLimit.js). Kept separate from `status === 'error'` on
  // purpose: nothing is broken, so this must not render as a failure.
  const [limitedScope, setLimitedScope] = useState<string | null>(null)

  useEffect(() => {
    if (!tripParams) {
      navigate('/trip-input', { replace: true })
      return
    }

    if (hasStarted.current) {
      return
    }
    hasStarted.current = true

    generateItinerary(tripParams)
      .then(() => navigate('/comparison'))
      .catch((err) => {
        // Everything except the daily cap is surfaced below via
        // `status`/`errorMessage`.
        if (err?.code === 'RATE_LIMITED') {
          setLimitedScope(err.scope || 'ip')
        }
      })
  }, [tripParams, generateItinerary, navigate])

  // Advances the checklist on a timer, clamped at the last step rather than
  // looping - if the real request runs long, the UI just holds on
  // "Finalizing" instead of implying a fifth phase that doesn't exist.
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((current) => Math.min(current + 1, STEPS.length - 1))
    }, STEP_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  // Opens the bundled, pre-captured Tokyo itinerary. Deliberately an explicit
  // choice rather than a silent swap: someone who asked for Lisbon and was
  // shown Tokyo without being told would reasonably think the app was broken,
  // or worse, not notice.
  function handleSeeExample() {
    const demo = DEMO_TRIPS[0]
    if (!demo?.savedItinerary) {
      navigate('/')
      return
    }
    loadSavedItinerary(demo.savedItinerary)
    navigate('/comparison')
  }

  function handleRetry() {
    hasStarted.current = false
    setActiveStep(0)
    if (!tripParams) return
    generateItinerary(tripParams)
      .then(() => navigate('/comparison'))
      .catch(() => {})
  }

  // Checked before the error branch: a capped request also leaves status as
  // 'error', and this is the more specific, more accurate thing to say.
  if (limitedScope) {
    return (
      <div>
        <Header />
        <div className="screen">
          <div className="container stack">
            <h1>
              {limitedScope === 'capacity' ? 'Roam is at capacity' : "Roam is at today's limit"}
            </h1>
            <p>
              {limitedScope === 'capacity'
                ? 'Roam is a side project running on a fixed budget, and it has reached it for now. Planning will be back.'
                : limitedScope === 'global'
                ? "Roam plans a fixed number of trips a day so it stays free to use, and today's are gone. Planning opens again tomorrow."
                : "You've planned as many trips as Roam allows in one day. Your limit resets tomorrow."}
            </p>
            <p>
              In the meantime you can look through a complete example trip, built by
              the same pipeline and checked against real places.
            </p>
            <div className="stack" style={{ flexDirection: 'row', gap: 'var(--spacing-3)' }}>
              <button type="button" className="button-primary" onClick={handleSeeExample}>
                See an example trip
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => navigate('/')}
              >
                Back to home
              </button>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div>
        <Header />
        <div className="screen">
          <div className="container stack">
            <h1>We hit a snag</h1>
            <p className="error-banner">
              {errorMessage || "We couldn't generate your itinerary. Please try again."}
            </p>
            <div className="stack" style={{ flexDirection: 'row', gap: 'var(--spacing-3)' }}>
              <button type="button" className="button-primary" onClick={handleRetry}>
                Try again
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => navigate('/trip-input')}
              >
                Change trip details
              </button>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="app-page">
      <Header />
      <div className="screen checklist-loading-screen">
        <div className="checklist-loading-content">
          <div className="checklist-loading-heading">
            <h1 className="checklist-loading-heading__title">Generating</h1>
            <p className="checklist-loading-heading__subtext">
              {tripParams?.days === 1
                ? 'This usually takes around 10 seconds'
                : tripParams?.days === 2
                ? 'This usually takes around 20 seconds'
                : 'This usually takes around 30 seconds'}
            </p>
          </div>
          <Checklist steps={STEPS} activeIndex={activeStep} />
        </div>
      </div>
      <Footer />
    </div>
  )
}
