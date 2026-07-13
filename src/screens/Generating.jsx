import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
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
  const { tripParams, generateItinerary, status, errorMessage } = useTrip()
  const hasStarted = useRef(false)
  const [activeStep, setActiveStep] = useState(0)

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
      .catch(() => {
        // Error state is surfaced below via `status`/`errorMessage`.
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

  function handleRetry() {
    hasStarted.current = false
    setActiveStep(0)
    generateItinerary(tripParams)
      .then(() => navigate('/comparison'))
      .catch(() => {})
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
            <p className="checklist-loading-heading__subtext">This usually takes 10 to 15 seconds</p>
          </div>
          <Checklist steps={STEPS} activeIndex={activeStep} />
        </div>
      </div>
      <Footer />
    </div>
  )
}
