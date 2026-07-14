import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import FlowBreadcrumb from '../components/FlowBreadcrumb'
import Checklist from '../components/Checklist'
import CurrencySelect from '../components/CurrencySelect'
import PlacePhoto from '../components/PlacePhoto'
import { nightsBetween } from '../utils/date'
import {
  currencyOptionsFor,
  fetchExchangeRates,
  convertAmount,
  formatCompactRange,
  formatExactRange,
} from '../utils/currency'

const BUDGET_OPTIONS = ['Economy', 'Standard', 'Luxury']

// Exact SVG supplied for the selected-note checkmark - pasted verbatim
// rather than approximated, per the "ask for the real SVG" rule for
// flattened icons. Native viewBox is 28x28, scaled down to fit this 16x16
// context; fill converted from the supplied literal #0C869D to its
// equivalent token (--color-teal-600) for theming consistency with the
// rest of the app's icons.
function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 28 28" fill="none">
      <path
        d="M0 14C0 6.26801 6.26801 0 14 0V0C21.732 0 28 6.26801 28 14V14C28 21.732 21.732 28 14 28V28C6.26801 28 0 21.732 0 14V14Z"
        fill="var(--color-teal-600)"
      />
      <path
        d="M18.6661 10.5L12.2501 16.9162L9.33374 13.9997"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

// Price Range display's icon (Figma node 345:31150) - built from native
// rectangles in the Figma file (not a flattened image), so this is an exact
// reproduction, not an approximation.
// Exact SVG supplied for the Price Range field icon (Figma node 345:31158) -
// pasted verbatim rather than approximated, per the "ask for the real SVG"
// rule for flattened icons. Replaces the earlier hand-drawn approximation.
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

function RangeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M16.9542 4.33789L17.1759 4.34961C18.2696 4.4626 19.1239 5.38565 19.1251 6.50879V14.2002L19.1134 14.4219C19.0014 15.5158 18.0772 16.3688 16.9542 16.3711H3.67493C2.47708 16.3688 1.50515 15.3984 1.50403 14.2002V6.50879L1.51575 6.28711C1.62791 5.19327 2.552 4.34006 3.67493 4.33789H16.9542ZM2.83997 14.2002C2.8411 14.6613 3.21476 15.0342 3.6759 15.0352H16.9532C17.4144 15.0342 17.7881 14.6613 17.7892 14.2002V8.49121L2.83997 8.3916V14.2002ZM3.6759 5.67383C3.21461 5.67475 2.84089 6.04849 2.83997 6.50977V7.05664L17.7892 7.15527V6.50977L17.7853 6.42383C17.7417 6.00274 17.3856 5.67469 16.9532 5.67383H3.6759Z"
        fill="var(--text-disabled)"
        stroke="var(--text-disabled)"
        strokeWidth="0.25"
      />
      <path
        d="M7.6001 12.4805C7.96918 12.4805 8.26807 12.7794 8.26807 13.1484C8.268 13.5175 7.96915 13.8164 7.6001 13.8164H4.88623C4.51719 13.8164 4.21833 13.5175 4.21826 13.1484C4.21826 12.7794 4.51714 12.4805 4.88623 12.4805H7.6001Z"
        fill="var(--text-disabled)"
        stroke="var(--text-disabled)"
        strokeWidth="0.25"
      />
    </svg>
  )
}

// Mirrors the real order of work in api/_lib/hotelSearch.js:
// 1. searchTier() runs three Google Places text searches in parallel
//    ("budget hotel in X" / "hotel in X" / "luxury hotel in X") - rating,
//    priceLevel, priceRange and photos all come back in this same call, no
//    separate per-hotel pricing step anymore (see hotelSearch.js's history
//    comment for why that changed).
// 2. Hotels are banded into Economy/Standard/Luxury by priceLevel first,
//    falling back to which tier-biased query found them.
// As with Generating, there's no live progress signal from a single
// request/response, so this is a timed simulation - but every label
// describes a real step, in the order it actually happens.
const STEPS = [
  'Searching hotels in your destination',
  'Checking ratings, prices and photos',
  'Sorting by rating and value',
]

const STEP_INTERVAL_MS = 3200

export default function Accommodation() {
  const navigate = useNavigate()
  const { tripParams, setTripParams } = useTrip()

  const [optionsByTier, setOptionsByTier] = useState({})
  const [priceRangeByTier, setPriceRangeByTier] = useState({})
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [status, setStatus] = useState('loading') // loading | success | error
  const [activeStep, setActiveStep] = useState(0)
  // Bumped by the error state's "Try again" button to re-run the fetch
  // effect below without a full page reload - it's otherwise only keyed on
  // tripParams.destination, which won't have changed on a plain retry.
  const [retryToken, setRetryToken] = useState(0)

  // Places' priceRange comes back in the destination's own local currency
  // (sourceCurrency) - exchangeRates converts that into whatever the user
  // picks from the CurrencySelect dropdown. Keyed by currency code, always
  // relative to sourceCurrency (see fetchExchangeRates).
  const [sourceCurrency, setSourceCurrency] = useState(null)
  const [selectedCurrency, setSelectedCurrency] = useState(null)
  const [exchangeRates, setExchangeRates] = useState({})

  // Single request now, not one per tier: tier assignment depends on real
  // prices pooled across all three budget searches (a hotel's confirmed price
  // decides which tier it lands in, not just the search query), so they have
  // to be computed together server-side rather than fetched independently.
  useEffect(() => {
    if (!tripParams?.destination) {
      navigate('/trip-input', { replace: true })
      return
    }

    let cancelled = false
    setStatus('loading')
    setActiveStep(0)

    fetch('/api/accommodation-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: tripParams.destination,
        checkInDate: tripParams.startDate,
        checkOutDate: tripParams.endDate,
      }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Request failed'))))
      .then((data) => {
        if (cancelled) return
        const nextOptions = data.options || {}
        const nextRanges = data.priceRangeByTier || {}
        setOptionsByTier(nextOptions)
        setPriceRangeByTier(nextRanges)
        setSelectedIndex(0)
        setStatus('success')

        // The destination's own local currency - comes from the backend's
        // country-code lookup now, not from priceRange (some destinations,
        // e.g. Newcastle, come back with zero priceRange hits across every
        // sampled hotel - that used to leave the whole selector empty).
        const currency = data.destinationCurrency || null
        setSourceCurrency(currency)
        setSelectedCurrency(currency)
        setExchangeRates(currency ? { [currency]: 1 } : {})
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [tripParams?.destination, navigate, retryToken])

  function handleRetry() {
    setRetryToken((t) => t + 1)
  }

  // Fetches conversion rates once we know the destination's local currency -
  // separate effect from the main load so a currency-only failure doesn't
  // affect anything else (the UI just falls back to showing the local range).
  useEffect(() => {
    if (!sourceCurrency) return
    let cancelled = false
    fetchExchangeRates(sourceCurrency, currencyOptionsFor(sourceCurrency))
      .then((rates) => {
        if (!cancelled) setExchangeRates(rates)
      })
      .catch(() => {
        // Leave exchangeRates as just { [sourceCurrency]: 1 } - the selector
        // still works, it just can't convert into other currencies yet.
      })
    return () => {
      cancelled = true
    }
  }, [sourceCurrency])

  // Advances the checklist on a timer while status is 'loading', same
  // clamped-not-looping approach as Generating - see STEPS above for why
  // each label was chosen.
  useEffect(() => {
    if (status !== 'loading') return
    const interval = setInterval(() => {
      setActiveStep((current) => Math.min(current + 1, STEPS.length - 1))
    }, STEP_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [status])

  function handleGenerate() {
    const selected = options[selectedIndex]
    setTripParams((prev) => ({
      ...prev,
      budget,
      accommodation: selected ? selected.name : undefined,
      // Finalise & Save needs the full hotel card (photo, rating, category,
      // price), not just the name generateRawItinerary.js uses as a routing
      // anchor - captured here since this is the only point that has both
      // the selected hotel and its resolved price range/currency together.
      accommodationDetails: selected
        ? {
            name: selected.name,
            categoryTag: selected.categoryTag,
            address: selected.address,
            rating: selected.rating,
            ratingCount: selected.ratingCount,
            photoUrl: selected.photoUrl,
            priceLevelLabel: selected.priceLevelLabel,
            budget,
            nights,
            priceRange: displayRange,
            // placeId/location weren't captured before 9 Jul 2026 - needed
            // now so the itinerary generator can use the real, selected
            // hotel as a routing anchor to bookend every day (see
            // generate-resolved-itinerary.js's applyAccommodationBookends).
            placeId: selected.placeId,
            location: selected.location,
          }
        : undefined,
    }))
    navigate('/generating')
  }

  // Budget is now chosen on Trip Input and fully determines which tier loads
  // here - no more live tab-switching (see TripInput.jsx). Falls back to
  // 'Standard' only defensively, in case this screen is ever reached without
  // going through the updated Trip Input first.
  const budget = tripParams?.budget || 'Standard'
  const options = optionsByTier[budget] || []
  // Still tracked so the empty-state copy can tell "nothing anywhere" apart
  // from "nothing in this specific tier, but other tiers have hotels" - the
  // latter now needs to send the user back to Trip Input to change budget,
  // since there's no switcher on this screen anymore.
  const availableTiers = BUDGET_OPTIONS.filter((tier) => (optionsByTier[tier]?.length || 0) > 0)
  const onlyChosenTierEmpty = options.length === 0 && availableTiers.length > 0
  const currentRange = priceRangeByTier[budget]
  const currencyOptions = currencyOptionsFor(sourceCurrency)
  const nights = nightsBetween(tripParams?.startDate, tripParams?.endDate)
  // Cosmetic label only - doesn't change the price shown, we still don't
  // model needing multiple rooms for larger groups (a deliberate call, see
  // BUILD-LOG.md open threads). Adults + children combined per Akber's
  // choice, so e.g. 1 adult + 1 child reads as "double", not "single".
  const totalTravellers = (tripParams?.adults ?? 1) + (tripParams?.children ?? 0)
  const roomTypeLabel = totalTravellers <= 1 ? 'Single' : 'Double'

  // Converts the tier's range (in sourceCurrency) into whatever the user
  // picked in CurrencySelect. Falls back to the untouched local range if the
  // rate for that currency hasn't loaded yet (or failed) - never blocks the
  // screen on a third-party rates call.
  const rate = selectedCurrency ? exchangeRates[selectedCurrency] : null
  const displayRange = currentRange
    ? {
        min: convertAmount(currentRange.min, rate) ?? currentRange.min,
        max: convertAmount(currentRange.max, rate) ?? currentRange.max,
        currencyCode: rate != null ? selectedCurrency : currentRange.currencyCode,
        estimated: currentRange.estimated,
      }
    : null

  // Deliberately no currency code/symbol here (unlike Finalise & Save, where
  // the price shows standalone) - the CurrencySelect right next to this
  // field already states the currency explicitly. Repeating it was always a
  // little redundant, and for currencies without a compact symbol in the
  // 'en' locale (PKR, AED, SAR, and plenty of others - Intl.NumberFormat
  // falls back to the 3-letter ISO code for those), it was long enough to
  // overflow this field and get ellipsis-truncated. formatCompactRange /
  // formatExactRange live in utils/currency.js (shared with Finalise &
  // Save's price note) - this screen just calls them with no currencyCode.
  function formatRange(range) {
    return formatCompactRange(range)
  }

  return (
    <div className="app-page">
      <Header />
      <div className={`screen ${status === 'loading' ? 'checklist-loading-screen' : ''}`}>
        {status === 'loading' && (
          <div className="checklist-loading-content">
            <div className="checklist-loading-heading">
              <h1 className="checklist-loading-heading__title">Finding places to stay</h1>
              <p className="checklist-loading-heading__subtext">
                Checking highly rated hotels in {tripParams?.destination}.
              </p>
            </div>
            <Checklist steps={STEPS} activeIndex={activeStep} />
          </div>
        )}

        {status === 'error' && (
          <div className="container stack">
            <p className="error-banner">Couldn't load accommodation options. Check your connection and try again.</p>
            <div className="stack" style={{ flexDirection: 'row', gap: 'var(--spacing-3)' }}>
              <button type="button" className="button-primary" onClick={handleRetry}>
                Try again
              </button>
              <button type="button" className="button-secondary" onClick={() => navigate('/trip-input')}>
                Change trip details
              </button>
            </div>
          </div>
        )}

        {status === 'success' && (
          <div className="container stack">
            <FlowBreadcrumb current="Stay" />

            {/* itinerary-header, not a bare div - matches every other
                screen's heading block (ComparisonView/DetailView/MapView/
                FinaliseSave), so .page-location's spacing is consistent
                everywhere via the same flex/gap-3 column rather than a
                one-off margin here. */}
            <div className="itinerary-header">
              <h1>Where are you staying?</h1>
              {tripParams?.destination && <p className="page-location">{tripParams.destination}</p>}
              <p className="page-intro">Recommendations based on your budget. Itinerary routes start from here.</p>
            </div>

            {availableTiers.length === 0 ? (
              <div className="stack">
                <p className="error-banner">
                  We couldn't find any accommodation with a confirmed real price in {tripParams?.destination}.
                  Try a nearby destination, or check back later.
                </p>
                <button type="button" className="button-secondary" onClick={() => navigate('/trip-input')}>
                  Change trip details
                </button>
              </div>
            ) : onlyChosenTierEmpty ? (
              <div className="stack">
                <p className="error-banner">
                  We couldn't find {budget.toLowerCase()} accommodation in {tripParams?.destination}, though other
                  budgets have options. Go back to Trip details to change your budget.
                </p>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => navigate('/trip-input')}
                >
                  Change trip details
                </button>
              </div>
            ) : (
              <>
                <div className="accommodation-secondary-fields">
                  <div className="price-range-field price-range-field--price">
                    <span className="form-label">{roomTypeLabel} room/night</span>
                    <div className="price-range-field__box">
                      <RangeIcon />
                      <span
                        className="price-range-field__value"
                        aria-label={displayRange ? formatExactRange(displayRange) : undefined}
                      >
                        {displayRange ? formatRange(displayRange) : 'Not available'}
                      </span>
                    </div>
                  </div>
                  <div className="price-range-field price-range-field--currency">
                    <span className="form-label">Currency</span>
                    <CurrencySelect
                      id="currency"
                      value={selectedCurrency || sourceCurrency}
                      options={currencyOptions}
                      onChange={setSelectedCurrency}
                    />
                  </div>
                </div>

                <div className="stack">
                  {options.map((option, index) => {
                    const isSelected = index === selectedIndex
                    return (
                      <button
                        type="button"
                        key={option.placeId || option.name}
                        className={`hotel-card ${isSelected ? 'hotel-card--selected' : ''}`}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <PlacePhoto src={option.photoUrl} alt={option.name} className="hotel-card__photo" />
                        <div className="hotel-card__body">
                          <div className="hotel-card__content">
                            <span className="hotel-card__name">{option.name}</span>
                            <div className="hotel-card__meta">
                              <span>{option.categoryTag}</span>
                              <span className="rating-inline">
                                <RatingStarIcon /> {option.rating?.toFixed(1)} ({option.ratingCount?.toLocaleString()})
                              </span>
                            </div>
                            {option.address && <p className="hotel-card__description">{option.address}</p>}
                          </div>
                          <div className="hotel-card__tags">
                            <span className="hotel-card__tag">{budget}</span>
                            {option.priceLevelLabel && (
                              <span className="hotel-card__price-tag">{option.priceLevelLabel}</span>
                            )}
                          </div>
                          {isSelected && (
                            <span className="hotel-card__selected-note">
                              <CheckCircleIcon />
                              {nights
                                ? `Selected · ${nights} night${nights === 1 ? '' : 's'} · Exact price at booking site`
                                : 'Selected · Exact price at booking site'}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  className="button-primary button-full"
                  onClick={handleGenerate}
                  disabled={options.length === 0}
                >
                  Continue
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
