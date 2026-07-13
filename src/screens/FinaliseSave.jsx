import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import PlacePhoto from '../components/PlacePhoto'
import { formatCompactRange } from '../utils/currency'
import { saveTrip } from '../utils/savedTrips'

function formatDateRange(startStr, endStr) {
  if (!startStr || !endStr) return ''
  const start = new Date(startStr)
  const end = new Date(endStr)
  const startLabel = start.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  const endLabel = end.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  return `${startLabel} - ${endLabel} ${end.getFullYear()}`
}

function formatTravellers(adults, children) {
  const parts = [`${adults || 0} Adult${adults === 1 ? '' : 's'}`]
  if (children) parts.push(`${children} Child${children === 1 ? '' : 'ren'}`)
  return parts.join(', ')
}

// Compact k/mil/b notation (000 -> "k", 6 zeros -> "mil") - same logic as
// Accommodation's price field, shared via utils/currency.js. Unlike that
// screen, the currency code is passed through here: Finalise & Save has no
// nearby CurrencySelect stating it, so it still needs to show on the price
// itself.
function formatPriceRange(range) {
  return formatCompactRange(range, { currencyCode: range?.currencyCode })
}

// Exact SVGs supplied for the Trip Details card's row icons (Figma node
// 273:16626) - pasted verbatim rather than approximated, per the "ask for
// the real SVG" rule for flattened icons. MapPinIcon replaced again with a
// second, more accurate literal SVG supplied later (16x19, not 20x20).
// Same pin-with-circle asset as Home.jsx's PinIcon (used for saved trips),
// swapped in for the previous outline-only pin, which had no inner circle.
function MapPinIcon() {
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

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M6.66667 1.66602V4.99962M13.3333 1.66602V4.99962M2.5 8.33322H17.5M4.16667 3.33282H15.8333C16.7538 3.33282 17.5 4.07907 17.5 4.99962V16.6672C17.5 17.5878 16.7538 18.334 15.8333 18.334H4.16667C3.24619 18.334 2.5 17.5878 2.5 16.6672V4.99962C2.5 4.07907 3.24619 3.33282 4.16667 3.33282Z"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M13.3336 17.5V15.8333C13.3336 14.9493 12.9824 14.1014 12.3572 13.4763C11.7321 12.8512 10.8841 12.5 10 12.5H4.99962C4.11549 12.5 3.26758 12.8512 2.6424 13.4763C2.01723 14.1014 1.66602 14.9493 1.66602 15.8333V17.5M13.3336 2.60661C14.0485 2.79192 14.6816 3.20933 15.1335 3.79333C15.5854 4.37733 15.8306 5.09485 15.8306 5.83327C15.8306 6.5717 15.5854 7.28922 15.1335 7.87322C14.6816 8.45722 14.0485 8.87463 13.3336 9.05994M18.334 17.4999V15.8332C18.3335 15.0947 18.0876 14.3772 17.6351 13.7935C17.1826 13.2098 16.549 12.7929 15.8338 12.6082M10.8334 5.83333C10.8334 7.67428 9.34091 9.16667 7.49982 9.16667C5.65872 9.16667 4.16622 7.67428 4.16622 5.83333C4.16622 3.99238 5.65872 2.5 7.49982 2.5C9.34091 2.5 10.8334 3.99238 10.8334 5.83333Z"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

// Export & Share's icons (Figma node 273:16760) are flattened image assets
// in Figma, not native vectors, so these are hand-approximated from the
// well-known Feather "download"/"share-2" icon shapes rather than an exact
// export - matching CalendarIcon's existing 20x20/strokeWidth-2 treatment
// for visual consistency with the rest of this row group.
function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M3.333 13.333v2.5a1.667 1.667 0 001.667 1.667h10a1.667 1.667 0 001.667-1.667v-2.5"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.833 8.333L10 12.5l4.167-4.167"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 12.5V2.5" stroke="var(--text-disabled)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="15" cy="4.167" r="2.5" stroke="var(--text-disabled)" strokeWidth="2" />
      <circle cx="5" cy="10" r="2.5" stroke="var(--text-disabled)" strokeWidth="2" />
      <circle cx="15" cy="15.833" r="2.5" stroke="var(--text-disabled)" strokeWidth="2" />
      <path d="M7.158 11.258l5.692 3.317" stroke="var(--text-disabled)" strokeWidth="2" strokeLinecap="round" />
      <path d="M12.842 5.425L7.158 8.742" stroke="var(--text-disabled)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Figma node 438:32929 - the small rating star used wherever a place's ★
// rating is shown (place cards, hotel cards, comparison cards). Not to be
// confused with StarIcon below, which is the larger filled/empty trip-rating
// widget star - different component, different Figma node.
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

function HeartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M10 18C10 18 2 12.2857 2 6.57143C2 4.05714 3.8 2 6 2C7.5 2 8.8 2.91429 10 4.28571C11.2 2.91429 12.5 2 14 2C16.2 2 18 4.05714 18 6.57143C18 12.2857 10 18 10 18Z"
        stroke="var(--text-disabled)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Both states use the exact same literal SVG path (native viewBox 22x22,
// scaled to 24x24), only fill/stroke color differs - pasted verbatim per
// the "ask for the real SVG" rule rather than approximated.
const STAR_PATH_D =
  'M10.7222 1.07972C10.6382 1.13183 10.5705 1.20636 10.5267 1.29491L8.21773 5.97408C8.06543 6.28237 7.84051 6.54902 7.56232 6.7511C7.28412 6.95318 6.961 7.08463 6.62074 7.13413L1.45579 7.88916C1.3575 7.90306 1.26508 7.94429 1.18907 8.00815C1.11307 8.07201 1.05652 8.15593 1.02588 8.25036C0.995237 8.34479 0.991731 8.44593 1.01576 8.54226C1.03979 8.63858 1.09039 8.72622 1.1618 8.79519L4.89776 12.4323C5.14437 12.6725 5.32885 12.969 5.43529 13.2964C5.54174 13.6238 5.56695 13.9721 5.50875 14.3114L4.62776 19.4506C4.61062 19.5483 4.62124 19.6489 4.65842 19.7408C4.6956 19.8328 4.75783 19.9125 4.83806 19.9708C4.91828 20.0292 5.01326 20.0638 5.11221 20.0709C5.21115 20.0779 5.31009 20.057 5.39775 20.0106L10.0147 17.5825C10.319 17.4228 10.6575 17.3393 11.0012 17.3393C11.3449 17.3393 11.6834 17.4228 11.9877 17.5825L16.6056 20.0106C16.6933 20.0573 16.7924 20.0784 16.8915 20.0715C16.9906 20.0646 17.0858 20.03 17.1662 19.9716C17.2466 19.9132 17.3089 19.8334 17.3461 19.7413C17.3833 19.6492 17.3939 19.5484 17.3766 19.4506L16.4946 14.3104C16.4367 13.9713 16.462 13.6232 16.5685 13.296C16.6749 12.9688 16.8593 12.6724 17.1056 12.4323L20.8416 8.79419C20.9124 8.72514 20.9625 8.63765 20.9862 8.54162C21.0099 8.44559 21.0062 8.34484 20.9756 8.25078C20.945 8.15672 20.8887 8.07309 20.8131 8.00936C20.7374 7.94563 20.6455 7.90434 20.5476 7.89016L15.3817 7.13413C15.0418 7.08424 14.7191 6.95262 14.4413 6.75057C14.1635 6.54851 13.9388 6.28206 13.7867 5.97408L11.4767 1.29491C11.4329 1.20636 11.3652 1.13183 11.2812 1.07972C11.1973 1.02761 11.1005 1 11.0017 1C10.9029 1 10.8061 1.02761 10.7222 1.07972Z'

function StarIcon({ filled }) {
  // Filled: #10A2BC (--brand-default). Empty: #94A3B8 (--text-disabled).
  const color = filled ? 'var(--brand-default)' : 'var(--text-disabled)'
  return (
    <svg width="24" height="24" viewBox="0 0 22 22" fill="none">
      <path d={STAR_PATH_D} fill={filled ? color : 'none'} stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function FinaliseSave() {
  const navigate = useNavigate()
  const { tripParams, resolvedItinerary, selectedVariant } = useTrip()

  const [rating, setRating] = useState(0)
  const [note, setNote] = useState('')
  const [copyState, setCopyState] = useState('idle') // idle | copied | error
  const [saveState, setSaveState] = useState('idle') // idle | saved

  if (!tripParams || !resolvedItinerary) {
    navigate('/trip-input', { replace: true })
    return null
  }

  const variantKey = selectedVariant || Object.keys(resolvedItinerary)[0]
  const plan = resolvedItinerary[variantKey]

  if (!plan) {
    navigate('/comparison', { replace: true })
    return null
  }

  const days = plan.days || []
  const acc = tripParams.accommodationDetails
  const nights = acc?.nights
  const priceRangeLabel = formatPriceRange(acc?.priceRange)
  const totalRange =
    acc?.priceRange && nights
      ? {
          min: acc.priceRange.min * nights,
          max: acc.priceRange.max * nights,
          currencyCode: acc.priceRange.currencyCode,
        }
      : null
  const totalLabel = formatPriceRange(totalRange)
  // Same single/double room logic Accommodation.jsx already uses - adults +
  // children combined, so e.g. 1 adult + 1 child reads as "double", not
  // "single". Cosmetic label only, doesn't change the price shown.
  const totalTravellers = (tripParams?.adults ?? 1) + (tripParams?.children ?? 0)
  const roomTypeLabel = totalTravellers <= 1 ? 'single' : 'double'

  // Beyond accommodation, meal stops are the one other category the app
  // actually has real signal for (item.mealType, same field the Detail
  // screen's meal tags use) - Economy trips skip this since budget/casual
  // dining rarely needs booking ahead, but Standard and especially Luxury
  // commonly do. Everything else (tickets, tours) still has no real data
  // source for which stops need advance booking, so it stays out of scope -
  // see the note below.
  const needsMealReservations = tripParams.budget === 'Standard' || tripParams.budget === 'Luxury'
  const mealReservations = needsMealReservations
    ? days.flatMap((day) =>
        (day.items || [])
          // Breakfast-at-accommodation bookend stops (item.type
          // 'accommodation', see generate-resolved-itinerary.js) carry a
          // mealType too, but they're already covered by the Trip Details
          // accommodation card above - "book directly with the restaurant"
          // doesn't make sense for a hotel breakfast already included with
          // the stay, so they're excluded here rather than double-listed.
          .filter((item) => item.mealType && item.type !== 'accommodation')
          .map((item) => {
            const mealLabel = item.mealType.charAt(0).toUpperCase() + item.mealType.slice(1)
            return {
              key: `${day.day}-${item.name}`,
              name: item.name,
              note: `Day ${day.day}${item.startTime ? ` · ${item.startTime}` : ''} · ${mealLabel} reservation. Check availability and book directly with the restaurant.`,
            }
          })
      )
    : []
  const hasReservations = Boolean(acc) || mealReservations.length > 0

  const calendarLink = (() => {
    if (!tripParams.startDate || !tripParams.endDate) return null
    const start = tripParams.startDate.replaceAll('-', '')
    // Google Calendar's all-day `dates` end is exclusive - add one day.
    const endDate = new Date(tripParams.endDate)
    endDate.setDate(endDate.getDate() + 1)
    const end = endDate.toISOString().slice(0, 10).replaceAll('-', '')
    const text = `${tripParams.days} day${tripParams.days === 1 ? '' : 's'} in ${tripParams.destination}`
    const details = acc?.name ? `Staying at ${acc.name}. Planned with Roam.` : 'Planned with Roam.'
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text,
      dates: `${start}/${end}`,
      details,
      location: tripParams.destination || '',
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  })()

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
    }
  }

  function handleSaveTrip() {
    saveTrip({
      title: `${tripParams.days} day${tripParams.days === 1 ? '' : 's'} in ${tripParams.destination}`,
      subtitle: `${plan.label} · ${days.reduce((sum, d) => sum + (d.items?.length || 0), 0)} stops`,
      destination: tripParams.destination,
      days: tripParams.days,
      savedItinerary: resolvedItinerary,
      // Previously dropped on save entirely - reopening a saved trip from
      // Home (see handleOpenSavedTrip) would always land back here showing
      // "No accommodation was selected", even though picking one is
      // mandatory earlier in the flow and the user genuinely had. It just
      // never survived the round trip through localStorage.
      accommodation: tripParams.accommodation,
      accommodationDetails: tripParams.accommodationDetails,
      budget: tripParams.budget,
      transport: tripParams.transport,
    })
    setSaveState('saved')
    navigate('/')
  }

  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <div className="itinerary-header">
            <h1>Your itinerary is ready</h1>
            {tripParams?.destination && <p className="page-location">{tripParams.destination}</p>}
            <p className="page-intro">Save it, share it, or export it to your calendar</p>
          </div>

          <section className="finalise-section">
            <div className="finalise-section__header">
              <span className="finalise-section__title">Trip Details</span>
              <button type="button" className="pill-button pill-button--outline" onClick={() => navigate('/trip-input')}>
                Edit
              </button>
            </div>
            <div className="finalise-card">
              <div className="finalise-row">
                <span className="finalise-row__icon">
                  <MapPinIcon />
                </span>
                <div className="finalise-row__content">
                  <span className="finalise-row__label">Destination</span>
                  <span className="finalise-row__value">{tripParams.destination}</span>
                </div>
              </div>
              <div className="finalise-row">
                <span className="finalise-row__icon">
                  <CalendarIcon />
                </span>
                <div className="finalise-row__content">
                  <span className="finalise-row__label">Dates</span>
                  <span className="finalise-row__value">
                    {formatDateRange(tripParams.startDate, tripParams.endDate)}
                    {tripParams.days ? ` · ${tripParams.days} night${tripParams.days === 1 ? '' : 's'}` : ''}
                  </span>
                </div>
              </div>
              <div className="finalise-row">
                <span className="finalise-row__icon">
                  <UsersIcon />
                </span>
                <div className="finalise-row__content">
                  <span className="finalise-row__label">Travellers</span>
                  <span className="finalise-row__value">{formatTravellers(tripParams.adults, tripParams.children)}</span>
                </div>
              </div>
              <div className="finalise-row">
                <span className="finalise-row__icon">
                  <HeartIcon />
                </span>
                <div className="finalise-row__content">
                  <span className="finalise-row__label">Interests</span>
                  {tripParams.interests?.length > 0 ? (
                    <div className="finalise-row__chips">
                      {tripParams.interests.map((interest) => (
                        <span key={interest} className="chip" style={{ cursor: 'default' }}>
                          {interest}
                        </span>
                      ))}
                    </div>
                  ) : (
                    // Always shown, even for saved trips restored with no
                    // interests recorded (see Home.jsx's handleOpenSavedTrip)
                    // - a missing row read as broken, not "none picked".
                    <span className="finalise-row__value">Not specified</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="finalise-section">
            <div className="finalise-section__header">
              <span className="finalise-section__title">Accommodation</span>
              <button type="button" className="pill-button pill-button--outline" onClick={() => navigate('/accommodation')}>
                Edit
              </button>
            </div>
            {acc ? (
              <div className="hotel-card">
                <PlacePhoto src={acc.photoUrl} alt={acc.name} className="hotel-card__photo" />
                <div className="hotel-card__body">
                  <div className="hotel-card__content">
                    <span className="hotel-card__name">{acc.name}</span>
                    <div className="hotel-card__meta">
                      {acc.categoryTag && <span>{acc.categoryTag}</span>}
                      {acc.rating != null && (
                        <span className="rating-inline">
                          <RatingStarIcon />
                          {acc.rating.toFixed(1)}
                          {acc.ratingCount != null ? ` (${acc.ratingCount.toLocaleString()})` : ''}
                        </span>
                      )}
                    </div>
                    {acc.address && <p className="hotel-card__description">{acc.address}</p>}
                  </div>
                  <div className="hotel-card__tags">
                    {acc.budget && <span className="hotel-card__tag">{acc.budget}</span>}
                  </div>
                  {priceRangeLabel && (
                    <span className="finalise-price-note">
                      <span>
                        {priceRangeLabel} for a {roomTypeLabel} room/night
                      </span>
                      {totalLabel && nights && (
                        <span>
                          {totalLabel} total for {nights} night{nights === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="page-intro">Accommodation details aren't available for this trip.</p>
            )}
          </section>

          <section className="finalise-section">
            <div className="finalise-section__header">
              <span className="finalise-section__title">Itinerary</span>
              <button type="button" className="pill-button pill-button--outline" onClick={() => navigate('/detail')}>
                Edit
              </button>
            </div>
            <div className="finalise-card">
              <div className="stack" style={{ gap: 'var(--spacing-4)' }}>
                {days.map((day) => (
                  <div key={day.day} className="stack" style={{ gap: 'var(--spacing-2)' }}>
                    <span className="finalise-day-label">Day {day.day}</span>
                    <div className="stack" style={{ gap: 'var(--spacing-2)' }}>
                      {(day.items || []).map((item, index) => (
                        <div className="finalise-itinerary-row" key={index}>
                          <span>{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="finalise-section">
            <span className="finalise-section__title">Reservations needed</span>
            <div className="finalise-card">
              {hasReservations ? (
                <>
                  {acc && (
                    <div className="finalise-reservation-row">
                      <div>
                        <p className="finalise-reservation-row__name">{acc.name}</p>
                        <p className="finalise-reservation-row__note">
                          {formatDateRange(tripParams.startDate, tripParams.endDate)}
                          {nights ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}. Check availability and book
                          directly with the property.
                        </p>
                      </div>
                      {/* No onClick/href, not disabled - per Figma (node
                          273:16717) this renders as a normal-looking
                          secondary button, not a grayed-out one. There's
                          still no real booking integration behind it (the
                          place shown is a verified real one, not a live
                          bookable rate), so it stays a no-op rather than a
                          working link that would imply a booking flow that
                          doesn't exist - it just no longer looks inert. */}
                      <button type="button" className="pill-button pill-button--outline">
                        Book now
                      </button>
                    </div>
                  )}
                  {mealReservations.map((reservation) => (
                    <div className="finalise-reservation-row" key={reservation.key}>
                      <div>
                        <p className="finalise-reservation-row__name">{reservation.name}</p>
                        <p className="finalise-reservation-row__note">{reservation.note}</p>
                      </div>
                      <button type="button" className="pill-button pill-button--outline">
                        Book now
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <p className="page-intro">No reservations needed for this trip.</p>
              )}
            </div>
            <p className="finalise-note">
              Per-stop booking guidance beyond accommodation and Standard/Luxury meal reservations (tickets, tours)
              isn't wired up yet for arbitrary destinations - the app doesn't have a real data source for which other
              stops need advance booking, so this section is scoped to those two for now rather than guessing.
            </p>
          </section>

          <section className="finalise-section">
            <span className="finalise-section__title">Export &amp; Share</span>
            <div className="finalise-export-list">
              <div className="finalise-export-row">
                <span className="finalise-export-row__label">
                  <CalendarIcon />
                  Add to Google Calendar
                </span>
                {calendarLink ? (
                  <a className="pill-button pill-button--outline" href={calendarLink} target="_blank" rel="noopener noreferrer">
                    Add
                  </a>
                ) : (
                  <button type="button" className="pill-button pill-button--outline" disabled>
                    Add
                  </button>
                )}
              </div>
              <div className="finalise-export-row">
                <span className="finalise-export-row__label">
                  <DownloadIcon />
                  Download as PDF
                </span>
                <button type="button" className="pill-button pill-button--outline" onClick={() => window.print()}>
                  Save
                </button>
              </div>
              <div className="finalise-export-row">
                <span className="finalise-export-row__label">
                  <ShareIcon />
                  Share Link
                </span>
                <button type="button" className="pill-button pill-button--outline" onClick={handleCopyLink}>
                  {copyState === 'copied' ? 'Copied' : 'Share'}
                </button>
              </div>
            </div>
            <p className="finalise-note">
              Share copies this page's current address - there's no saved-trip backend yet, so a link opened by
              someone else won't reconstruct this itinerary for them.
            </p>
          </section>

          <section className="finalise-section">
            <span className="finalise-section__title">Rate your trip</span>
            <div className="finalise-stars">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={`finalise-star-button${value <= rating ? ' finalise-star-button--filled' : ''}`}
                  aria-label={`Rate ${value} star${value === 1 ? '' : 's'}`}
                  onClick={() => setRating(value)}
                >
                  <StarIcon filled={value <= rating} />
                </button>
              ))}
            </div>
            <textarea
              className="finalise-rating-input"
              placeholder="Add a note about your experience..."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </section>

          <button type="button" className="button-primary button-full" onClick={handleSaveTrip}>
            {saveState === 'saved' ? 'Saved' : 'Save to My trips'}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  )
}
