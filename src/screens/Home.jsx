import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import LoadingSpinner from '../components/LoadingSpinner'
import { toLocalISODate } from '../utils/date'
import { getSavedTrips } from '../utils/savedTrips'
import { TOKYO_2_DAYS } from '../data/savedTrips/tokyo'

// Tokyo is the one fixed demo entry. The result is pre-captured from a real
// run through the live pipeline (Claude draft -> Places verification ->
// Routes travel times) and bundled here so clicking the card jumps straight
// to Comparison with no live generation call. Hotel Chinzanso Tokyo is
// pre-selected as the Standard accommodation.
// "My trips" shows at most this one demo plus the single most recent trip
// actually saved via Finalise & Save (see utils/savedTrips.js's
// MAX_SAVED_TRIPS=1), for a cap of 2 rows total.
const DEMO_TRIPS = [
  {
    title: '2 days in Tokyo',
    subtitle: 'Feb 2026 · Temples & Shrines · Anime & Pop Culture · Nighte & Entertainment · Modern Architecture',
    destination: 'Tokyo',
    days: 2,
    interests: ['Temples & Shrines', 'Anime & Pop Culture', 'Nightlife & Entertainment', 'Modern Architecture'],
    budget: 'Standard',
    accommodation: 'Hotel Chinzanso Tokyo',
    accommodationDetails: {
      name: 'Hotel Chinzanso Tokyo',
      categoryTag: 'Hotel · Bunkyo City',
      address: '2-chōme-10-8 Sekiguchi, Bunkyo City, Tokyo 112-8680, Japan',
      rating: 4.4,
      ratingCount: 10408,
      photoUrl: '/api/place-photo?ref=places%2FChIJNxw8EQSNGGART8GbVls3c4A%2Fphotos%2FAWCwydiGolg6Ujhot7izHmXrY9R-ZVUVNdXAIQXV_VOFcbB4aNrfdYGnCdHO2RTi6jT2CVdPLwckL92Bew4Z4_I8A9TvGrpZ9dMUFjXUWmlTSaX4zza3Z_SpFRUdKLI6u27F0uzTBuuFD75husyZcMXZFczV6Y1UOcsN8pKXkn4C_bGoU5Wgci8I78lwSdkMg-ndg-tcgxkEIMmZO_KPIlC5CpIbHWzYoCJNH5-rYJmnK0AQHFcmtYVdZk_wUzf-VAwdSW_dRIQJdFweA68EZdlgGvlORfb8y0MRJ-1Y-TbhIJBe3JytcDMO8Nr5Ch4qy31vCTmlPSew3srerkhhx4xqNMERVBtX3gPJNwdh3hPDlIJZDDUJ36TAalRyJmllb3tWKx7GQ9vUFSTGnmibng3gAt3FIaeIVZyF3xUus1a_3cECOQ',
      priceLevelLabel: null,
      budget: 'Standard',
      nights: 2,
      priceRange: { min: 40000, max: 90000, currencyCode: 'JPY', estimated: true },
      placeId: 'ChIJNxw8EQSNGGART8GbVls3c4A',
      location: { lat: 35.7117779, lng: 139.7257143 },
    },
    savedItinerary: TOKYO_2_DAYS,
  },
]

const MENU_ITEMS = [
  { label: 'Settings', to: '/', icon: SettingsIcon },
  { label: 'Help', to: '/', icon: HelpIcon },
  { label: 'About', to: '/', icon: InfoIcon },
]

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

function ChevronIcon({ direction }) {
  const d = direction === 'left' ? 'M10 3.5 4.5 9l5.5 5.5' : 'M8 3.5 13.5 9 8 14.5'
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="17" height="19" viewBox="0 0 17 19" fill="none">
      <path
        d="M6.5228 2.76548C6.56871 2.28243 6.79308 1.83385 7.15205 1.50738C7.51103 1.18091 7.97882 1 8.46405 1C8.94928 1 9.41707 1.18091 9.77605 1.50738C10.135 1.83385 10.3594 2.28243 10.4053 2.76548C10.4329 3.07752 10.5353 3.37833 10.7037 3.64243C10.8722 3.90653 11.1018 4.12615 11.3732 4.28271C11.6445 4.43926 11.9496 4.52815 12.2625 4.54183C12.5755 4.55551 12.8872 4.49359 13.1711 4.36131C13.6121 4.16113 14.1117 4.13216 14.5728 4.28005C15.0339 4.42794 15.4235 4.7421 15.6657 5.1614C15.908 5.58069 15.9855 6.07512 15.8833 6.54845C15.7811 7.02179 15.5065 7.44016 15.1128 7.72214C14.8564 7.90202 14.6472 8.14098 14.5027 8.41883C14.3583 8.69668 14.2828 9.00523 14.2828 9.31839C14.2828 9.63156 14.3583 9.94011 14.5027 10.218C14.6472 10.4958 14.8564 10.7348 15.1128 10.9146C15.5065 11.1966 15.7811 11.615 15.8833 12.0883C15.9855 12.5617 15.908 13.0561 15.6657 13.4754C15.4235 13.8947 15.0339 14.2089 14.5728 14.3567C14.1117 14.5046 13.6121 14.4757 13.1711 14.2755C12.8872 14.1432 12.5755 14.0813 12.2625 14.095C11.9496 14.1086 11.6445 14.1975 11.3732 14.3541C11.1018 14.5106 10.8722 14.7303 10.7037 14.9944C10.5353 15.2585 10.4329 15.5593 10.4053 15.8713C10.3594 16.3544 10.135 16.8029 9.77605 17.1294C9.41707 17.4559 8.94928 17.6368 8.46405 17.6368C7.97882 17.6368 7.51103 17.4559 7.15205 17.1294C6.79308 16.8029 6.56871 16.3544 6.5228 15.8713C6.49525 15.5592 6.39288 15.2582 6.22435 14.994C6.05583 14.7298 5.82611 14.5102 5.55466 14.3536C5.28321 14.197 4.97802 14.1082 4.66495 14.0946C4.35187 14.081 4.04013 14.143 3.75613 14.2755C3.31521 14.4757 2.81557 14.5046 2.35447 14.3567C1.89336 14.2089 1.50378 13.8947 1.26154 13.4754C1.01929 13.0561 0.941728 12.5617 1.04393 12.0883C1.14614 11.615 1.4208 11.1966 1.81447 10.9146C2.07082 10.7348 2.28007 10.4958 2.42454 10.218C2.56901 9.94011 2.64443 9.63156 2.64443 9.31839C2.64443 9.00523 2.56901 8.69668 2.42454 8.41883C2.28007 8.14098 2.07082 7.90202 1.81447 7.72214C1.42135 7.44002 1.14717 7.02181 1.04522 6.5488C0.94326 6.07578 1.02081 5.58176 1.26279 5.16274C1.50477 4.74372 1.89389 4.42963 2.35454 4.28151C2.81519 4.1334 3.31445 4.16184 3.7553 4.36131C4.03926 4.49359 4.35092 4.55551 4.66388 4.54183C4.97685 4.52815 5.28191 4.43926 5.55325 4.28271C5.82458 4.12615 6.05421 3.90653 6.22269 3.64243C6.39116 3.37833 6.49353 3.07752 6.52113 2.76548M10.9634 9.31868C10.9634 10.6994 9.84409 11.8187 8.46338 11.8187C7.08267 11.8187 5.96338 10.6994 5.96338 9.31868C5.96338 7.93797 7.08267 6.81868 8.46338 6.81868C9.84409 6.81868 10.9634 7.93797 10.9634 9.31868Z"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
      <path
        d="M6.90868 6.83346C7.10461 6.27647 7.49135 5.8068 8.00039 5.50763C8.50943 5.20846 9.10793 5.0991 9.68988 5.19892C10.2718 5.29874 10.7997 5.6013 11.1799 6.053C11.5602 6.50471 11.7683 7.07641 11.7674 7.66686C11.7674 9.33366 9.2672 10.1671 9.2672 10.1671M9.334 13.501H9.34233M17.668 9.334C17.668 13.9367 13.9367 17.668 9.334 17.668C4.73126 17.668 1 13.9367 1 9.334C1 4.73126 4.73126 1 9.334 1C13.9367 1 17.668 4.73126 17.668 9.334Z"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
      <path
        d="M9.334 12.6676V9.334M9.334 6.0004H9.34233M17.668 9.334C17.668 13.9367 13.9367 17.668 9.334 17.668C4.73126 17.668 1 13.9367 1 9.334C1 4.73126 4.73126 1 9.334 1C13.9367 1 17.668 4.73126 17.668 9.334Z"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

const AUTO_ADVANCE_MS = 5000
// Matches --duration-slow in tokens.css; kept in sync manually since this
// value also drives a JS timeout (cleanup can't read a CSS var).
const TRANSITION_MS = 400

export default function Home() {
  const navigate = useNavigate()
  const { setTripParams, loadSavedItinerary } = useTrip()
  const [locations, setLocations] = useState([])
  const [status, setStatus] = useState('loading') // loading | success | error
  const [activeIndex, setActiveIndex] = useState(0)
  const [prevIndex, setPrevIndex] = useState(null)
  // Read once on mount - real trips saved via Finalise & Save, newest first,
  // shown ahead of the two fixed demo entries.
  const [savedTrips] = useState(() => [...getSavedTrips(), ...DEMO_TRIPS])
  const timerRef = useRef(null)
  const transitionTimeoutRef = useRef(null)

  // Dates/travellers/interests aren't part of the saved-trip data (there's
  // nothing to restore them from), so both paths below use the same
  // defaults TripInput itself starts with.
  function handleOpenSavedTrip(trip) {
    const start = new Date()
    start.setDate(start.getDate() + 14)
    const end = new Date(start)
    end.setDate(end.getDate() + trip.days)

    const params = {
      destination: trip.destination,
      days: trip.days,
      adults: 2,
      children: 0,
      startDate: toLocalISODate(start),
      endDate: toLocalISODate(end),
      interests: trip.interests || [],
      budget: trip.budget || 'Standard',
      transport: trip.transport || 'Car or taxi',
      // Undefined for trips saved before this was captured (including the
      // bundled Tokyo demo) - Finalise & Save's empty state handles that
      // honestly rather than implying nothing was ever chosen.
      accommodation: trip.accommodation,
      accommodationDetails: trip.accommodationDetails,
    }
    setTripParams(params)

    if (trip.savedItinerary) {
      // Real, pre-captured result - load it directly and skip straight to
      // Comparison, no live generation call, no accommodation re-pick.
      loadSavedItinerary(trip.savedItinerary)
      navigate('/comparison')
      return
    }

    // No saved result for this one - start a fresh, real generation. Lands
    // on Accommodation - a real hotel still needs picking, same as any
    // other new trip - which is also where the FlowBreadcrumb
    // ("Home / Plan / Accommodation") gives a working way back.
    navigate('/accommodation')
  }

  useEffect(() => {
    let cancelled = false

    fetch('/api/trending-locations')
      .then((response) => {
        if (!response.ok) throw new Error('Request failed')
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        const nextLocations = data.locations || []
        setLocations(nextLocations)
        setStatus('success')
        // Warm the browser cache for every photo up front, so advancing the
        // carousel never has to wait on a network fetch mid-transition (that
        // gap is what was showing the gradient placeholder instead of a
        // clean crossfade).
        nextLocations.forEach((location) => {
          if (!location.photoUrl) return
          const preloadImage = new Image()
          preloadImage.src = location.photoUrl
        })
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (locations.length === 0) return

    timerRef.current = setInterval(() => {
      setActiveIndex((current) => {
        setPrevIndex(current)
        return (current + 1) % locations.length
      })
    }, AUTO_ADVANCE_MS)

    return () => clearInterval(timerRef.current)
  }, [locations.length])

  useEffect(() => {
    if (prevIndex === null) return
    clearTimeout(transitionTimeoutRef.current)
    transitionTimeoutRef.current = setTimeout(() => setPrevIndex(null), TRANSITION_MS)
    return () => clearTimeout(transitionTimeoutRef.current)
  }, [prevIndex, activeIndex])

  function goToSlide(index) {
    if (index === activeIndex) return
    clearInterval(timerRef.current)
    setPrevIndex(activeIndex)
    setActiveIndex(index)
  }

  const activeLocation = locations[activeIndex]
  const outgoingLocation = prevIndex !== null ? locations[prevIndex] : null

  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <section className="home-section">
            <h2 className="home-section__title">Trending locations</h2>

            {status === 'loading' && (
              <div className="trending-card">
                <div className="trending-card__photo-stack">
                  <div className="trending-card__photo" />
                  <span className="photo-frame__spinner">
                    <LoadingSpinner />
                  </span>
                </div>
              </div>
            )}
            {status === 'error' && <p className="form-error">Couldn't load trending locations.</p>}

            {status === 'success' && activeLocation && (
              <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
                <button
                  type="button"
                  className="trending-card trending-card--button"
                  onClick={() => navigate('/trip-input', { state: { destination: activeLocation.name } })}
                >
                  <div className="trending-card__photo-stack">
                    {outgoingLocation && outgoingLocation.photoUrl && (
                      <img
                        key={`out-${outgoingLocation.name}`}
                        className="trending-card__photo trending-card__photo--out"
                        src={outgoingLocation.photoUrl}
                        alt=""
                      />
                    )}
                    {activeLocation.photoUrl ? (
                      <img
                        key={`in-${activeLocation.name}`}
                        className={`trending-card__photo ${outgoingLocation ? 'trending-card__photo--in' : ''}`}
                        src={activeLocation.photoUrl}
                        alt={activeLocation.name}
                      />
                    ) : (
                      <div className="trending-card__photo" />
                    )}
                  </div>
                  <div className="trending-card__body">
                    <span className="trending-card__name">{activeLocation.name}</span>
                    <p className="trending-card__description">{activeLocation.description}</p>
                  </div>
                </button>

                <div className="carousel-nav" style={{ alignSelf: 'center' }}>
                  <button
                    type="button"
                    className="carousel-arrow"
                    onClick={() => goToSlide((activeIndex - 1 + locations.length) % locations.length)}
                    aria-label="Previous location"
                  >
                    <ChevronIcon direction="left" />
                  </button>

                  <div className="carousel-dots">
                    {locations.map((location, index) => (
                      <button
                        type="button"
                        key={location.name}
                        className={`carousel-dot ${index === activeIndex ? 'carousel-dot--active' : ''}`}
                        onClick={() => goToSlide(index)}
                        aria-label={`Show ${location.name}`}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    className="carousel-arrow"
                    onClick={() => goToSlide((activeIndex + 1) % locations.length)}
                    aria-label="Next location"
                  >
                    <ChevronIcon direction="right" />
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="home-section">
            <h2 className="home-section__title">My trips</h2>
            <div className="stack" style={{ gap: 'var(--spacing-2)' }}>
              <Link className="list-row" to="/trip-input">
                <SparkleIcon />
                <span className="list-row__title" style={{ flex: 1 }}>Plan a trip</span>
                <span className="list-row__chevron">
                  <ChevronIcon direction="right" />
                </span>
              </Link>
              {savedTrips.map((trip) => (
                <button
                  type="button"
                  className="list-row list-row--button"
                  key={trip.savedAt ? `${trip.title}-${trip.savedAt}` : trip.title}
                  onClick={() => handleOpenSavedTrip(trip)}
                >
                  <span style={{ alignSelf: "flex-start", display: "flex" }}><PinIcon /></span>
                  <div style={{ flex: 1 }}>
                    <span className="list-row__title">{trip.title}</span>
                    <span className="list-row__subtitle">{trip.subtitle}</span>
                  </div>
                  <span className="list-row__chevron">
                    <ChevronIcon direction="right" />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="home-section">
            <h2 className="home-section__title">More</h2>
            <div className="stack" style={{ gap: 'var(--spacing-2)' }}>
              {MENU_ITEMS.map((item) => {
                const ItemIcon = item.icon
                return (
                  <Link className="list-row" to={item.to} key={item.label}>
                    <ItemIcon />
                    <span className="list-row__title" style={{ flex: 1 }}>{item.label}</span>
                    <span className="list-row__chevron">
                      <ChevronIcon direction="right" />
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  )
}
