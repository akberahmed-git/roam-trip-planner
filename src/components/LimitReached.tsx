import { useNavigate } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import { useTrip } from '../context/TripContext'
import { DEMO_TRIPS } from '../data/demoTrips'
import { toLocalISODate } from '../utils/date'

// Shown when there is no planning budget left, from wherever that is
// discovered: TripInput finds it on load (see api/capacity.js), Generating
// finds it when the API turns a request away.
//
// Deliberately not an error screen. Nothing is broken - Roam runs on a fixed
// daily budget so it can stay free, and that budget is spent. Rendering this as
// a red failure would tell a visitor the product doesn't work, which is both
// untrue and the worst possible impression from a link someone shared.
//
// scope says which ceiling was hit:
//   'global'   - the day's shared allowance is gone, back tomorrow
//   'capacity' - upstream credit is out, no promised return time
//   'ip'       - this visitor's own allowance (currently disabled)
const COPY = {
  global: {
    title: "Roam is at today's limit",
    body: "Roam plans a fixed number of trips a day so it stays free to use, and today's are gone. Planning opens again tomorrow.",
  },
  capacity: {
    title: 'Roam is at capacity',
    body: 'Roam is a side project running on a fixed budget, and it has reached it for now. Planning will be back.',
  },
  ip: {
    title: "Roam is at today's limit",
    body: "You've planned as many trips as Roam allows in one day. Your limit resets tomorrow.",
  },
}

export default function LimitReached({ scope }: { scope?: string | null }) {
  const navigate = useNavigate()
  const { setTripParams, loadSavedItinerary } = useTrip()
  const copy = COPY[scope as keyof typeof COPY] || COPY.global

  // Opens the bundled Tokyo itinerary. An explicit choice rather than a silent
  // swap: someone who asked for Lisbon and was shown Tokyo without being told
  // would reasonably think the app was broken, or worse, not notice.
  function handleSeeExample() {
    const demo = DEMO_TRIPS[0]
    if (!demo?.savedItinerary) {
      navigate('/')
      return
    }

    // Same params Home builds when its demo card is clicked. Without them
    // Comparison would render the saved days with no destination or dates
    // around them, which reads as a half-loaded screen rather than an example.
    const start = new Date()
    start.setDate(start.getDate() + 14)
    const end = new Date(start)
    end.setDate(end.getDate() + demo.days)

    setTripParams({
      destination: demo.destination,
      days: demo.days,
      adults: 2,
      children: 0,
      startDate: toLocalISODate(start),
      endDate: toLocalISODate(end),
      interests: demo.interests || [],
      budget: demo.budget || 'Standard',
      transport: 'Car or taxi',
      accommodation: demo.accommodation,
      accommodationDetails: demo.accommodationDetails,
    })
    loadSavedItinerary(demo.savedItinerary)
    navigate('/comparison')
  }

  return (
    <div>
      <Header />
      <div className="screen">
        <div className="container stack">
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <p>
            In the meantime you can look through a complete example trip, built by the
            same pipeline and checked against real places.
          </p>
          <div className="stack" style={{ flexDirection: 'row', gap: 'var(--spacing-3)' }}>
            <button type="button" className="button-primary" onClick={handleSeeExample}>
              See an example trip
            </button>
            <button type="button" className="button-secondary" onClick={() => navigate('/')}>
              Back to home
            </button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
