import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import FlowBreadcrumb from '../components/FlowBreadcrumb'
import PlacePhoto from '../components/PlacePhoto'
import LoadingSpinner from '../components/LoadingSpinner'

function computeEndTime(startTime, durationMinutes) {
  if (!startTime || !durationMinutes) return null
  const [hours, minutes] = startTime.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  const totalMinutes = (hours * 60 + minutes + durationMinutes) % (24 * 60)
  const endHours = Math.floor(totalMinutes / 60)
  const endMinutes = totalMinutes % 60
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`
}

// Figma node 438:32929 - the small rating star used wherever a place's ★
// rating is shown (place cards, hotel cards, comparison cards).
function RatingStarIcon() {
  return (
    <svg width="14" height="13" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6.44572 0.661321C6.39537 0.692582 6.35475 0.737294 6.32846 0.790412L4.94328 3.59751C4.85192 3.78245 4.71698 3.94242 4.55009 4.06365C4.3832 4.18488 4.18935 4.26374 3.98523 4.29343L0.886718 4.74638C0.827749 4.75472 0.772308 4.77946 0.726709 4.81777C0.681111 4.85608 0.647188 4.90642 0.628806 4.96307C0.610424 5.01972 0.608321 5.0804 0.622737 5.13819C0.637153 5.19597 0.667509 5.24855 0.710346 5.28992L2.95159 7.47189C3.09954 7.61597 3.21021 7.79387 3.27407 7.99026C3.33792 8.18665 3.35305 8.39563 3.31814 8.59917L2.78962 11.6822C2.77934 11.7408 2.78571 11.8012 2.80801 11.8563C2.83031 11.9115 2.86765 11.9593 2.91578 11.9943C2.9639 12.0293 3.02089 12.0501 3.08025 12.0543C3.1396 12.0586 3.19895 12.046 3.25155 12.0182L6.02131 10.5616C6.20385 10.4657 6.40694 10.4156 6.61312 10.4156C6.8193 10.4156 7.02239 10.4657 7.20493 10.5616L9.97529 12.0182C10.0279 12.0462 10.0873 12.0589 10.1468 12.0547C10.2062 12.0506 10.2633 12.0298 10.3116 11.9948C10.3598 11.9598 10.3972 11.9119 10.4195 11.8566C10.4418 11.8014 10.4482 11.7409 10.4378 11.6822L9.9087 8.59857C9.87394 8.39512 9.88914 8.18628 9.953 7.99001C10.0168 7.79374 10.1274 7.61593 10.2752 7.47189L12.5165 5.28932C12.559 5.2479 12.589 5.19541 12.6032 5.1378C12.6174 5.08019 12.6152 5.01975 12.5969 4.96332C12.5785 4.9069 12.5448 4.85673 12.4994 4.81849C12.454 4.78026 12.3988 4.75549 12.3401 4.74698L9.24101 4.29343C9.03712 4.2635 8.84353 4.18454 8.67687 4.06333C8.51021 3.94212 8.37545 3.78227 8.28416 3.59751L6.89838 0.790412C6.87209 0.737294 6.83147 0.692582 6.78112 0.661321C6.73077 0.63006 6.67268 0.613495 6.61342 0.613495C6.55415 0.613495 6.49607 0.63006 6.44572 0.661321Z"
        fill="var(--color-slate-400)"
        stroke="var(--color-slate-400)"
        strokeWidth="1.22701"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <g clipPath="url(#clip0_swap_check)">
        <path
          d="M8 16C12.4183 16 16 12.4183 16 8C16 3.58172 12.4183 0 8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16Z"
          fill="var(--text-brand)"
        />
        <path
          d="M4.5 8.5L6.5 10.5L11.5 5.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="clip0_swap_check">
          <rect width="16" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}

// Duplicated per-screen rather than shared, matching how MealTag/
// TransportIndicator are already duplicated across DetailView/ComparisonView
// in this codebase.
function MealTag({ mealType }) {
  if (!mealType) return null
  const label = mealType.charAt(0).toUpperCase() + mealType.slice(1)
  return <span className={`meal-tag meal-tag--${mealType}`}>{label}</span>
}

// Mirrors DetailView.jsx's PlaceCard for the item being swapped (Figma node
// 273:16409) - same .place-card classes, but with two deliberate omissions:
// - No Swap button/actions row. There's no sensible action for it while
//   already on the Swap screen for this exact item - Figma's own mock ships
//   this button at opacity-0 too, effectively invisible. Per Akber's call.
// - No Busy row, even though this item's real busyTime may exist. Akber
//   chose to drop busy-time from the Swap screen entirely (current card and
//   alternatives alike) rather than only working around the fact that
//   alternatives have no real source for it - see AlternativeCard below.
function CurrentPlaceCard({ item }) {
  const endTime = computeEndTime(item.startTime, item.durationMinutes)

  return (
    <div className="place-card">
      <PlacePhoto src={item.photoUrl} alt={item.name} className="place-card__photo" />
      <div className="place-card__body">
        <span className="place-card__name">{item.name}</span>
        {item.description && <p className="place-card__description">{item.description}</p>}
        <div className="place-card__footer">
          <div className="place-card__meta">
            {(item.categoryTag || item.rating != null) && (
              <span className="place-card__meta-row">
                {item.categoryTag && <span>{item.categoryTag}</span>}
                {item.rating != null && (
                  <span className="rating-inline">
                    <RatingStarIcon />
                    {item.rating.toFixed(1)}
                    {item.reviewCount != null ? ` (${item.reviewCount.toLocaleString()})` : ''}
                  </span>
                )}
              </span>
            )}
            {(item.startTime || item.mealType) && (
              <span className="place-card__visit-row">
                {item.startTime && (
                  <span>
                    Visit: {item.startTime}
                    {endTime ? ` - ${endTime}` : ''}
                  </span>
                )}
                <MealTag mealType={item.mealType} />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AlternativeCard({ alt, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`hotel-card${selected ? ' hotel-card--selected' : ''}`}
      onClick={onSelect}
    >
      <PlacePhoto src={alt.photoUrl} alt={alt.name} className="hotel-card__photo" />
      <div className="hotel-card__body">
        <div className="hotel-card__content">
          <span className="hotel-card__name">{alt.name}</span>
          <div className="hotel-card__meta">
            {alt.categoryTag && <span>{alt.categoryTag}</span>}
            {alt.rating != null && (
              <span className="rating-inline">
                <RatingStarIcon />
                {alt.rating.toFixed(1)}
                {alt.ratingCount != null ? ` (${alt.ratingCount.toLocaleString()})` : ''}
              </span>
            )}
          </div>
          <div className="hotel-card__divider" />
          <div className="why-swap">
            <span className="why-swap__label">Why swap?</span>
            <p className="why-swap__reason">{alt.reason || 'A real, nearby alternative for this stop.'}</p>
          </div>
        </div>
        {selected && (
          <span className="hotel-card__selected-note">
            <CheckCircleIcon />
            Selected
          </span>
        )}
      </div>
    </button>
  )
}

export default function SwapThisPlace() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tripParams, resolvedItinerary, swapDayItem } = useTrip()

  const swapContext = location.state
  const [status, setStatus] = useState('loading') // loading | success | error
  const [alternatives, setAlternatives] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(null)
  // Bumped by the error/empty state's "Try again" button to re-run the
  // fetch effect below without a full page reload - it's otherwise only
  // keyed on the item name, which won't have changed on a plain retry.
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (!swapContext?.item || !tripParams?.destination) {
      navigate('/swap_place', { replace: true })
    }
  }, [swapContext, tripParams, navigate])

  useEffect(() => {
    if (!swapContext?.item || !tripParams?.destination) return

    let cancelled = false
    setStatus('loading')
    setSelectedIndex(null)

    // Every other stop across the WHOLE itinerary (all days), not just the
    // current day - otherwise a suggestion could duplicate something on a
    // different day of the same plan. Only this variant's own days count as
    // "the same itinerary" though - the same place showing up on the Slow &
    // Immersive plan too is a fine, separate itinerary, not a double-booking.
    const variant = resolvedItinerary?.[swapContext.variant]
    const excludeNames = (variant?.days || [])
      .flatMap((d, di) =>
        (d.items || [])
          .filter((_, ii) => !(di === swapContext.dayIndex && ii === swapContext.itemIndex))
          .map((entry) => entry.name)
      )
      .filter(Boolean)

    fetch('/api/swap-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeName: swapContext.item.name,
        categoryTag: swapContext.item.categoryTag,
        destination: tripParams.destination,
        excludeNames,
        interests: tripParams.interests,
      }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Request failed'))))
      .then((data) => {
        if (cancelled) return
        setAlternatives(data.alternatives || [])
        setStatus('success')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapContext?.item?.name, retryToken])

  function handleRetry() {
    setRetryToken((t) => t + 1)
  }

  if (!swapContext?.item) {
    return null
  }

  const { item, variant, dayIndex, itemIndex } = swapContext

  function handleConfirm() {
    const alt = alternatives[selectedIndex]
    if (!alt) return

    swapDayItem(variant, dayIndex, itemIndex, {
      name: alt.name,
      categoryTag: alt.categoryTag,
      rating: alt.rating,
      reviewCount: alt.ratingCount,
      photoUrl: alt.photoUrl,
      location: alt.location,
      placeId: alt.placeId,
      // The old place's description/busy time don't apply to the new one,
      // and there's no real data source for the new place's own description
      // or busy time here - cleared rather than carried over stale or guessed.
      description: undefined,
      busyTime: undefined,
    })

    navigate('/swap_place', { state: { variant, dayIndex } })
  }

  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <FlowBreadcrumb current="Swap place" />

          <div className="itinerary-header">
            <h1>Swap {item.name}</h1>
            {tripParams?.destination && <p className="page-location">{tripParams.destination}</p>}
          </div>

          <CurrentPlaceCard item={item} />

          <p className="page-intro">Swap places to suit everyone in your group.</p>

          {status === 'loading' && (
            <p className="page-intro inline-loading">
              Looking for real, nearby alternatives…
              <LoadingSpinner size={16} />
            </p>
          )}

          {status === 'error' && (
            <div className="stack">
              <p className="error-banner">Couldn't load alternatives. Check your connection and try again.</p>
              <button type="button" className="button-secondary" onClick={handleRetry}>
                Try again
              </button>
            </div>
          )}

          {status === 'success' && (
            <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
              <h2 className="day-heading">Swap with:</h2>
              {alternatives.length === 0 ? (
                <div className="stack">
                  <p className="error-banner">
                    Couldn't find a verified, real alternative nearby right now. Try again shortly.
                  </p>
                  <button type="button" className="button-secondary" onClick={handleRetry}>
                    Try again
                  </button>
                </div>
              ) : (
                <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
                  {alternatives.map((alt, index) => (
                    <AlternativeCard
                      key={alt.placeId || alt.name}
                      alt={alt}
                      selected={index === selectedIndex}
                      onSelect={() => setSelectedIndex(index)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {status !== 'loading' && (
            <div className="detail-footer">
              <button
                type="button"
                className="detail-footer__button detail-footer__button--outline"
                onClick={() => navigate('/swap_place', { state: { variant, dayIndex } })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="detail-footer__button detail-footer__button--solid"
                onClick={handleConfirm}
                disabled={selectedIndex == null}
              >
                Swap
              </button>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
