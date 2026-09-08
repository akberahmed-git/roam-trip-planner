import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import FlowBreadcrumb from '../components/FlowBreadcrumb'
import SegmentedControl from '../components/SegmentedControl'
import PlacePhoto from '../components/PlacePhoto'
import { frame, project, spread, MAP_WIDTH, MAP_HEIGHT } from '../utils/mapFraming'

// The accommodation is where the day starts and ends, not something the
// traveller chose to go and see. Numbering it made a Packed day ten markers,
// two of them the same place (three when breakfast is at the hotel), and pushed
// the last real stop past the single character Google Static Maps allows for a
// label - so it shipped as an unlabelled pin. Marking it as home instead frees
// those slots and makes the numbers mean the things you are actually doing
// (Akber, 8 Sep 2026).
function HomeMarker() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M12 3.2 3.6 10.3h2.1v9.4h5V14h2.6v5.7h5v-9.4h2.1z" fill="currentColor" />
    </svg>
  )
}

// Centre-to-centre distance two badges are kept to, in CSS pixels: the 28px
// badge plus a 4px gap, so numbers never sit on top of each other.
const BADGE_CLEARANCE_PX = 32

// Accommodation is marked as home and takes no number, so the stops run 1..n
// over the things there are to do rather than over every row in the array.
function numberStops(items) {
  let next = 0
  return items.map((item) => ({
    item,
    number: item.type === 'accommodation' ? null : ++next,
  }))
}

function MapRow({ item, number }) {
  return (
    <div className="map-row">
      <div className="map-row__number" aria-label={number == null ? 'Start and end of the day' : undefined}>
        {number == null ? <HomeMarker /> : number}
      </div>
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
  const numbered = numberStops(items)
  const located = numbered.filter(({ item }) => item.location)

  // One badge per place. The hotel bookends a day at both ends, and two home
  // badges on the same pixel would only be pushed apart by the overlap rule
  // into two hotels.
  const seen = new Set<string>()
  const badges = located.filter(({ item }) => {
    const key = `${item.location!.lat},${item.location!.lng}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const framing = frame(located.map(({ item }) => item.location!))
  const pathParam = located.map(({ item }) => `${item.location!.lat},${item.location!.lng}`).join('|')
  const mapSrc = framing
    ? `/api/static-map?center=${framing.center.lat.toFixed(6)},${framing.center.lng.toFixed(6)}` +
      `&zoom=${framing.zoom}&path=${encodeURIComponent(pathParam)}`
    : null

  // Badge positions in CSS pixels, so the overlap rule works in the unit the
  // badge is drawn in. The box is measured because the map is fluid; the image
  // itself is a fixed 640x427, so a projected pixel scales by width alone.
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setBoxWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = boxWidth > 0 ? boxWidth / MAP_WIDTH : 0
  type Badge = (typeof badges)[number]
  const placedBadges: Array<{ x: number; y: number; data: Badge }> = framing && scale > 0
    ? spread<Badge>(
        badges.map((b) => {
          const { x, y } = project(b.item.location!, framing)
          return { x: x * scale, y: y * scale, data: b }
        }),
        BADGE_CLEARANCE_PX,
        { width: MAP_WIDTH * scale, height: MAP_HEIGHT * scale }
      )
    : []

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

          <div className="map-image" ref={boxRef}>
            {mapSrc ? (
              <>
                <img
                  className="map-image__img"
                  src={mapSrc}
                  alt={`Map of Day ${day?.day} stops`}
                />
                {placedBadges.map(({ x, y, data }) => (
                  <div
                    key={data.number ?? 'home'}
                    className="map-image__badge"
                    style={{ left: `${x}px`, top: `${y}px` }}
                    aria-hidden="true"
                  >
                    <div className="map-row__number">
                      {data.number == null ? <HomeMarker /> : data.number}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="map-image__empty">No verified locations to show for this day yet.</div>
            )}
          </div>

          {day && (
            <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
              <h2 className="day-heading">{day.theme}</h2>
              <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
                {numbered.map(({ item, number }, index) => (
                  <MapRow key={index} item={item} number={number} />
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
