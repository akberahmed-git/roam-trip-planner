import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import FlowBreadcrumb from '../components/FlowBreadcrumb'
import SegmentedControl from '../components/SegmentedControl'
import PlacePhoto from '../components/PlacePhoto'

function MapRow({ item, number }) {
  return (
    <div className="map-row">
      <div className="map-row__number">{number}</div>
      <div className="comparison-card" style={{ flex: 1 }}>
        <PlacePhoto src={item.photoUrl} alt={item.name} className="comparison-card__photo" />
        <div className="comparison-card__body">
          <span className="comparison-card__name">{item.name}</span>
          <div className="comparison-card__meta">
            {item.startTime && <span>{item.startTime}</span>}
            {item.categoryTag && <span>{item.categoryTag}</span>}
          </div>
          {item.description && <p className="comparison-card__description">{item.description}</p>}
        </div>
      </div>
    </div>
  )
}

export default function MapView() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tripParams, resolvedItinerary, selectedVariant, setSelectedVariant } = useTrip()

  const availableVariants = resolvedItinerary
    ? ['packed', 'slow'].filter((key) => resolvedItinerary[key])
    : []

  // Same fallback chain as DetailView/ComparisonView: prefer explicit nav
  // state (arriving from Detail's "View on map"), then whatever's already
  // selected in context, then just the first available variant - the last
  // case covers reaching this screen from Home's menu link, which passes no
  // state at all.
  const [variantKey, setVariantKey] = useState(location.state?.variant || selectedVariant || null)
  const [dayIndex, setDayIndex] = useState(0)

  useEffect(() => {
    if (!resolvedItinerary) {
      navigate('/trip-input', { replace: true })
    }
  }, [resolvedItinerary, navigate])

  useEffect(() => {
    if (!variantKey && availableVariants.length > 0) {
      setVariantKey(availableVariants[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableVariants.length])

  if (!resolvedItinerary || !variantKey) {
    return null
  }

  const plan = resolvedItinerary[variantKey]
  if (!plan) {
    return null
  }

  const days = plan.days || []
  const day = days[dayIndex] || days[0]
  const dayLabels = days.map((d) => `Day ${d.day}`)

  function selectDay(label) {
    const index = days.findIndex((d) => `Day ${d.day}` === label)
    if (index !== -1) setDayIndex(index)
  }

  const items = day?.items || []
  // Only items with a real, verified location get a pin - never guess a
  // position for one that doesn't have one, same "don't fabricate" rule as
  // everywhere else. The list below still shows every item, pinned or not.
  const pointsParam = items
    .map((item, index) => ({ item, number: index + 1 }))
    .filter(({ item }) => item.location)
    .map(({ item, number }) => `${number}:${item.location.lat},${item.location.lng}`)
    .join('|')

  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <FlowBreadcrumb current="Map" />

          <div className="itinerary-header">
            <h1>{plan.label} itinerary</h1>
            {tripParams?.destination && <p className="page-location">{tripParams.destination}</p>}
          </div>

          <SegmentedControl options={dayLabels} value={`Day ${day?.day}`} onChange={selectDay} />

          <div className="map-image">
            {pointsParam ? (
              <img
                className="map-image__img"
                src={`/api/static-map?points=${encodeURIComponent(pointsParam)}`}
                alt={`Map of Day ${day?.day} stops`}
              />
            ) : (
              <div className="map-image__empty">No verified locations to show for this day yet.</div>
            )}
          </div>

          {day && (
            <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
              <h2 className="day-heading">{day.theme}</h2>
              <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
                {items.map((item, index) => (
                  <MapRow key={index} item={item} number={index + 1} />
                ))}
              </div>
            </div>
          )}

          <div className="detail-footer">
            <button
              type="button"
              className="detail-footer__button detail-footer__button--solid"
              // Commit the variant being viewed here into context before
              // Finalise reads it. MapView's heading is driven by this local
              // variantKey (from nav state / context / first-available), but
              // Finalise reads selectedVariant from context - without this,
              // arriving here via a path that never set it (e.g. Comparison's
              // Continue before its fix, or Home's map link) left Finalise
              // falling back to the first variant and showing the wrong Trip
              // Type. Syncing here guarantees the two screens always agree.
              onClick={() => { setSelectedVariant(variantKey); navigate('/finalise') }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
