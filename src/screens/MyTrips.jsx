import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { toLocalISODate } from '../utils/date'
import { getSavedTrips } from '../utils/savedTrips'
import { DEMO_TRIPS } from '../data/demoTrips'

// Dedicated "My trips" page (Figma node 273:16854). This is the last screen in
// the plan-a-trip flow: Finalise & Save redirects here after the user saves,
// so they land on their saved trip rather than being dropped back on the Home
// carousel. Reuses the exact same list-row pattern, saved-trip data, and
// open-trip behaviour as Home's "My trips" section, so the two stay identical.

function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M18.19 9.37201C12.898 8.17701 12.155 7.43401 10.96 2.14301C10.856 1.68701 10.452 1.36401 9.984 1.36401C9.516 1.36401 9.112 1.68701 9.008 2.14301C7.813 7.43401 7.07 8.17701 1.779 9.37201C1.323 9.47601 1 9.88001 1 10.348C1 10.816 1.323 11.22 1.779 11.324C7.07 12.519 7.813 13.262 9.008 18.554C9.112 19.009 9.516 19.333 9.984 19.333C10.452 19.333 10.856 19.009 10.96 18.554C12.155 13.262 12.898 12.519 18.19 11.324C18.645 11.22 18.969 10.816 18.969 10.348C18.969 9.88001 18.645 9.47601 18.19 9.37201ZM9.984 14.673C9.114 12.396 7.937 11.218 5.659 10.348C7.937 9.47801 9.114 8.30101 9.984 6.02301C10.854 8.30101 12.032 9.47801 14.309 10.348C12.032 11.218 10.854 12.396 9.984 14.673Z"
        fill="var(--text-disabled)"
      />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M10.3877 1.7998C13.4787 1.79996 16.0865 3.90507 16.8145 6.75879C17.0597 7.7199 17.028 9.07454 16.7002 10.0293C16.2465 11.35 15.3835 12.807 14.4668 14.1348C13.5484 15.4649 12.5674 16.6771 11.8691 17.5107C11.0998 18.4292 9.67858 18.4301 8.90918 17.5107C8.21087 16.6767 7.22874 15.4631 6.30957 14.1318C5.39229 12.8033 4.52851 11.346 4.0752 10.0254C3.74804 9.07256 3.71534 7.71978 3.95996 6.75879L4.03418 6.49316C4.85196 3.77527 7.39322 1.7998 10.3877 1.7998ZM10.3877 3.2002C7.93473 3.2002 5.88985 4.86741 5.31836 7.10645C5.24473 7.39574 5.2141 7.8681 5.22949 8.35156C5.24493 8.83587 5.30613 9.29856 5.39941 9.57129C5.77855 10.6761 6.57783 12.0258 7.46191 13.3115C8.3436 14.5938 9.30007 15.7987 9.98047 16.6113V16.6123C10.1189 16.7774 10.2634 16.8389 10.3877 16.8389C10.5122 16.8388 10.6565 16.7764 10.7949 16.6113C11.4753 15.799 12.4319 14.5952 13.3135 13.3135C14.1974 12.0284 14.9964 10.6794 15.376 9.57422C15.4697 9.30099 15.5316 8.83663 15.5479 8.35156C15.5641 7.86726 15.5336 7.39443 15.46 7.10547C14.889 4.86685 12.8404 3.20035 10.3877 3.2002ZM10.3877 5.01074C12.2493 5.01093 13.7803 6.52137 13.7803 8.37793C13.78 10.2346 12.2488 11.74 10.3877 11.7402C8.52598 11.7402 6.99928 10.2343 6.99902 8.37793C6.99902 6.5217 8.5255 5.01074 10.3877 5.01074ZM10.3877 6.41016C9.27919 6.41016 8.39941 7.29105 8.39941 8.37793C8.39967 9.46481 9.27889 10.3408 10.3877 10.3408C11.4974 10.3406 12.3796 9.46356 12.3799 8.37793C12.3799 7.2911 11.4966 6.41034 10.3877 6.41016Z"
        fill="var(--text-disabled)"
        stroke="var(--text-disabled)"
        strokeWidth="0.4"
      />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path d="M8 3.5 13.5 9 8 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function MyTrips() {
  const navigate = useNavigate()
  const { setTripParams, loadSavedItinerary } = useTrip()
  // Read once on mount - real trips saved via Finalise & Save, newest first,
  // ahead of the fixed demo entry. Same source and order as Home's "My trips".
  const [savedTrips] = useState(() => [...getSavedTrips(), ...DEMO_TRIPS])

  // Mirrors Home.jsx's handleOpenSavedTrip. Dates/travellers/interests aren't
  // part of saved-trip data, so this uses the same defaults TripInput starts
  // with. A trip with a pre-captured result skips straight to Comparison; one
  // without starts a fresh generation from Accommodation.
  function handleOpenSavedTrip(trip) {
    const start = new Date()
    start.setDate(start.getDate() + 14)
    const end = new Date(start)
    end.setDate(end.getDate() + trip.days)

    setTripParams({
      destination: trip.destination,
      days: trip.days,
      adults: 2,
      children: 0,
      startDate: toLocalISODate(start),
      endDate: toLocalISODate(end),
      interests: trip.interests || [],
      budget: trip.budget || 'Standard',
      transport: trip.transport || 'Car or taxi',
      accommodation: trip.accommodation,
      accommodationDetails: trip.accommodationDetails,
    })

    if (trip.savedItinerary) {
      loadSavedItinerary(trip.savedItinerary)
      navigate('/comparison')
      return
    }
    navigate('/accommodation')
  }

  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <section className="home-section">
            <h2 className="home-section__title">My trips</h2>
            <div className="stack" style={{ gap: 'var(--spacing-2)' }}>
              <Link className="list-row" to="/trip-input">
                <SparkleIcon />
                <span className="list-row__title" style={{ flex: 1 }}>Plan a trip</span>
                <span className="list-row__chevron">
                  <ChevronIcon />
                </span>
              </Link>
              {savedTrips.map((trip) => (
                <button
                  type="button"
                  className="list-row list-row--button"
                  key={trip.savedAt ? `${trip.title}-${trip.savedAt}` : trip.title}
                  onClick={() => handleOpenSavedTrip(trip)}
                >
                  <span style={{ alignSelf: 'flex-start', display: 'flex' }}><PinIcon /></span>
                  <div style={{ flex: 1 }}>
                    <span className="list-row__title">{trip.title}</span>
                    <span className="list-row__subtitle">{trip.subtitle}</span>
                  </div>
                  <span className="list-row__chevron">
                    <ChevronIcon />
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  )
}
