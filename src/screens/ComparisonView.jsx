import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../context/TripContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import FlowBreadcrumb from '../components/FlowBreadcrumb'
import SegmentedControl from '../components/SegmentedControl'
import PlacePhoto from '../components/PlacePhoto'
import ConfirmDialog from '../components/ConfirmDialog'

function WalkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M8.82682 4.0203C9.67541 4.0203 10.3633 3.33238 10.3633 2.48379C10.3633 1.63519 9.67541 0.947266 8.82682 0.947266C7.97822 0.947266 7.2903 1.63519 7.2903 2.48379C7.2903 3.33238 7.97822 4.0203 8.82682 4.0203Z"
        fill="var(--color-teal-600)"
      />
      <path
        d="M13.491 8.91103C12.7747 8.58165 11.2994 8.11266 10.8965 7.42256C10.3583 6.50088 9.89799 4.35519 8.00714 4.36724C7.18141 4.37262 5.83736 5.73765 4.88861 6.35333C4.44711 6.63977 4.46143 7.41037 4.38347 7.87086C4.28128 8.47379 4.17924 9.07672 4.07691 9.67965C3.975 10.2797 4.47971 10.5514 4.97563 10.2831C5.24733 10.1362 5.36624 9.76355 5.41372 9.48321C5.53632 8.76023 5.69988 8.19571 5.82248 7.47273L6.69385 6.76549C6.39791 8.53544 6.13018 9.58114 5.85848 11.9669C5.77812 12.673 5.68132 13.3962 5.51478 13.6133C4.97634 14.3151 4.56432 15.0051 4.01823 15.701C3.24536 16.6858 4.62116 17.4422 5.32869 16.5406C5.81256 15.9239 6.29643 15.3074 6.78017 14.6909C7.46615 13.8165 7.43667 12.3907 7.61554 11.3219C8.15809 12.4936 8.7005 13.6652 9.24305 14.8367C9.4942 15.3794 9.74549 15.9221 9.99678 16.4648C10.4659 17.4778 11.9116 16.9532 11.4189 15.8896C10.7198 14.3799 10.1626 12.87 9.46344 11.3605C9.24517 10.8889 8.90303 10.43 8.97744 9.91719C9.09947 9.07714 9.2215 8.23724 9.34339 7.39733C9.54508 7.74273 9.72083 8.21541 9.99154 8.50752C10.1837 8.83691 10.9087 9.04384 11.2405 9.19634C11.7592 9.43502 12.278 9.67341 12.7967 9.91195C13.6277 10.2945 14.3732 9.31667 13.491 8.91103Z"
        fill="var(--color-teal-600)"
      />
    </svg>
  )
}

function TrainIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M14.4775 4.39175C14.4775 4.06988 14.345 3.76649 14.1364 3.55858C12.0904 1.56961 8.83245 1.79677 8.70004 1.81601C5.38508 1.91072 3.83197 2.91483 3.24437 3.52085C3.0357 3.72952 2.9225 4.01366 2.9225 4.31629V12.7834C2.9225 13.7113 3.68021 14.469 4.60809 14.469H5.66918L4.53262 15.8705C4.47565 15.9275 4.47565 16.0029 4.51339 16.0792C4.55112 16.1546 4.6081 16.1931 4.68357 16.1931H6.27445C6.33143 16.1931 6.3884 16.1739 6.42614 16.1176L7.71439 14.4698H9.68404L10.9723 16.1176C11.01 16.1746 11.067 16.1931 11.124 16.1931H12.7149C12.7903 16.1931 12.8665 16.1554 12.885 16.0792C12.9228 16.0037 12.9043 15.9275 12.8658 15.8705L11.7293 14.469H12.7711C13.699 14.469 14.4567 13.7113 14.4567 12.7834L14.4582 4.39168L14.4775 4.39175ZM5.34735 12.8212C4.8168 12.8212 4.38097 12.3854 4.38097 11.8548C4.38097 11.3243 4.8168 10.8885 5.34735 10.8885C5.87789 10.8885 6.31372 11.3243 6.31372 11.8548C6.31298 12.3854 5.8964 12.8212 5.34735 12.8212ZM7.97999 8.1996C7.97999 8.42676 7.79057 8.61618 7.56341 8.61618H4.74133C4.51417 8.61618 4.32475 8.42676 4.32475 8.1996L4.32401 5.13108C4.32401 4.90392 4.51343 4.7145 4.74059 4.7145L7.56342 4.71376C7.79058 4.71376 7.98001 4.90318 7.98001 5.13034L7.97999 8.1996ZM11.9009 12.8212C11.3704 12.8212 10.9345 12.3854 10.9345 11.8548C10.9345 11.3243 11.3704 10.8885 11.9009 10.8885C12.4315 10.8885 12.8673 11.3243 12.8673 11.8548C12.8673 12.3854 12.4315 12.8212 11.9009 12.8212ZM13.0567 8.1996C13.0567 8.42676 12.8673 8.61618 12.6401 8.61618H9.83644C9.60928 8.61618 9.41986 8.42676 9.41986 8.1996V5.13108C9.41986 4.90392 9.60928 4.7145 9.83644 4.7145H12.6585C12.8857 4.7145 13.0751 4.90392 13.0751 5.13108L13.0758 8.1996H13.0567Z"
        fill="var(--color-teal-600)"
      />
    </svg>
  )
}

function DriveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.32797 7.40336L4.37211 4.57654C4.75412 3.838 5.33985 3.37959 6.02746 3.15039H12.5725C13.2601 3.37959 13.8203 3.838 14.2278 4.57654L15.2719 7.40336H16.6217C16.7236 7.40336 16.8 7.47976 16.8 7.58163V8.1419C16.8 8.24377 16.7236 8.34564 16.6217 8.34564H15.8322C16.0614 8.62577 16.2906 8.95684 16.5198 9.38978C16.5198 11.0961 16.5453 12.8023 16.5453 14.5341C16.5453 14.967 16.1887 15.349 15.7303 15.349H15.1701C14.7117 15.349 14.3551 14.967 14.3551 14.5341V13.4899H4.24478V14.5341C4.24478 14.967 3.88824 15.349 3.42984 15.349H2.86957C2.41116 15.349 2.05463 14.967 2.05463 14.5341C2.05463 12.8023 2.08009 11.0961 2.08009 9.38978C2.3093 8.95684 2.5385 8.62577 2.7677 8.34564H1.97823C1.87636 8.34564 1.79996 8.24377 1.79996 8.1419V7.58163C1.79996 7.47976 1.87636 7.40336 1.97823 7.40336H3.32797ZM6.1548 4.27093C5.72186 4.34733 5.44172 4.62747 5.28892 4.98401C4.98332 5.82441 4.65225 6.79216 4.37211 7.63256H14.2278C13.9477 6.79216 13.5911 5.82441 13.311 4.98401C13.1327 4.62747 12.8781 4.34733 12.4451 4.27093H6.1548ZM13.9477 9.46618C13.4383 9.46618 13.0309 9.87365 13.0309 10.383C13.0309 10.8923 13.4383 11.2998 13.9477 11.2998C14.4315 11.2998 14.839 10.8923 14.839 10.383C14.839 9.87365 14.4315 9.46618 13.9477 9.46618ZM4.65225 9.46618C5.16159 9.46618 5.56906 9.87365 5.56906 10.383C5.56906 10.8923 5.16159 11.2998 4.65225 11.2998C4.16838 11.2998 3.76091 10.8923 3.76091 10.383C3.76091 9.87365 4.16838 9.46618 4.65225 9.46618Z"
        fill="var(--color-teal-600)"
      />
    </svg>
  )
}

function TransportIndicator({ label }) {
  const lower = label.toLowerCase()
  const isWalk = lower.includes('walk')
  const isTrain = lower.includes('train')
  const Icon = isWalk ? WalkIcon : isTrain ? TrainIcon : DriveIcon

  return (
    <div className="transport-indicator">
      <span className="transport-indicator__line" />
      <Icon />
      <span className="transport-indicator__label">{label}</span>
    </div>
  )
}

function MealTag({ mealType }) {
  if (!mealType) return null
  const label = mealType.charAt(0).toUpperCase() + mealType.slice(1)
  return <span className={`meal-tag meal-tag--${mealType}`}>{label}</span>
}

function ComparisonCard({ item }) {
  return (
    <div className="comparison-card">
      <PlacePhoto src={item.photoUrl} alt={item.name} className="comparison-card__photo" />
      <div className="comparison-card__body">
        <span className="comparison-card__name">{item.name}</span>
        <div className="comparison-card__meta">
          {item.startTime && (
            <span>
              {item.startTime}
              {item.durationMinutes ? ` · ${item.durationMinutes} min` : ''}
            </span>
          )}
          <MealTag mealType={item.mealType} />
        </div>
        <p className="comparison-card__description">{item.description}</p>
      </div>
    </div>
  )
}

function DailyPaceCard({ plan }) {
  // pacingLevel (stopCount / 8, capped at 1) is computed once on the backend
  // against a fixed scale, not per-variant, so Packed and Slow bars stay
  // comparable to each other instead of each variant re-normalizing to its
  // own tallest day.
  const barFillClass = plan.pacingLabel === 'Relaxed' ? 'daily-pace-bar__fill--relaxed' : 'daily-pace-bar__fill--busy'

  return (
    <div className="daily-pace-card">
      <span className="daily-pace-card__label">Daily pace: {plan.pacingLabel}</span>
      <div className="daily-pace-card__rows">
        {plan.days.map((day) => (
          <div className="daily-pace-row" key={day.day}>
            <span className="daily-pace-row__label">Day {day.day}</span>
            <div className="daily-pace-bar">
              <div
                className={`daily-pace-bar__fill ${barFillClass}`}
                style={{ width: `${(day.pacingLevel ?? 0) * 100}%` }}
              />
            </div>
            <span className="daily-pace-row__count">
              {day.stopCount} stop{day.stopCount === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ComparisonView() {
  const navigate = useNavigate()
  const { tripParams, resolvedItinerary, setSelectedVariant, resetTrip } = useTrip()

  const availableVariants = resolvedItinerary
    ? ['packed', 'slow'].filter((key) => resolvedItinerary[key])
    : []

  const [variantKey, setVariantKey] = useState(null)
  const [dayIndex, setDayIndex] = useState(0)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Scrolled into view whenever the day changes (see selectDay below) - the
  // day tabs are duplicated above and below the itinerary card list, and
  // since the cards got much taller after the full-width-photo redesign
  // (9 Jul 2026), picking a new day from the bottom set of tabs left the
  // page scrolled to wherever those tabs happened to be, with the actual
  // new content invisible above the fold. Akber's bug report, 9 Jul 2026.
  //
  // Anchored to the top day-tab picker itself, not the day-heading below it
  // - an earlier version targeted the heading, which left the tabs (and the
  // breathing room above them) scrolled just out of view above the fold.
  // Akber's follow-up, 9 Jul 2026: land with the tabs themselves visible.
  const topTabsRef = useRef(null)

  useEffect(() => {
    if (!resolvedItinerary) {
      navigate('/trip-input', { replace: true })
    }
  }, [resolvedItinerary, navigate])

  useEffect(() => {
    if (!variantKey && availableVariants.length > 0) {
      setVariantKey(availableVariants[0])
    }
  }, [availableVariants, variantKey])

  if (!resolvedItinerary || !variantKey) {
    return null
  }

  const variant = resolvedItinerary[variantKey]
  const days = variant.days || []
  const day = days[dayIndex] || days[0]
  const dayLabels = days.map((d) => `Day ${d.day}`)
  const adults = tripParams?.adults ?? 1
  const isGroup = adults > 1

  function selectVariant(key) {
    setVariantKey(key)
    setDayIndex(0)
  }

  function selectDay(label) {
    const index = days.findIndex((d) => `Day ${d.day}` === label)
    if (index !== -1) {
      setDayIndex(index)
      // Scroll the top day-tab picker into view - matters most for the
      // bottom set of tabs (see topTabsRef comment above), but doing it
      // unconditionally for both keeps the behavior consistent and is a
      // no-op when already near the top.
      topTabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function handleExplore() {
    setSelectedVariant(variantKey)
    // Also pass the variant directly via navigation state, so DetailView has
    // an immediate source of truth on its very first render instead of only
    // relying on the TripContext update having landed by the time it mounts.
    navigate('/detail', { state: { variant: variantKey } })
  }

  // Opens the token-styled ConfirmDialog rather than deleting immediately -
  // this throws away everything generated for the trip with no way to get
  // it back (it was never saved, since that only happens explicitly on
  // Finalise & Save), so a stray click shouldn't be able to lose it
  // silently. Not in the Figma spec, but a bare-minimum safeguard for an
  // otherwise irreversible action.
  function handleDeleteConfirmed() {
    setDeleteDialogOpen(false)
    resetTrip()
    navigate('/')
  }

  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <FlowBreadcrumb current="Itinerary" />

          <div className="itinerary-header">
            <h1>
              {tripParams?.days} days in {tripParams?.destination}
            </h1>
            <div className="itinerary-actions">
              <button
                type="button"
                className="pill-button pill-button--outline"
                onClick={() => navigate('/trip-input')}
              >
                Refine request
              </button>
              <button
                type="button"
                className="pill-button pill-button--outline"
                onClick={() => navigate('/generating')}
              >
                Regenerate
              </button>
            </div>
          </div>

          <div className="pace-tabs">
            {availableVariants.map((key) => (
              <button
                type="button"
                key={key}
                className={`pace-tab ${variantKey === key ? 'pace-tab--active' : ''}`}
                onClick={() => selectVariant(key)}
              >
                {resolvedItinerary[key].label}
              </button>
            ))}
          </div>

          {isGroup ? (
            <p className="page-intro">Two plans for your group of {adults} — share both and pick the pace that works for everyone.</p>
          ) : (
            <p className="page-intro">Two itinerary styles, pick one to explore in detail.</p>
          )}

          <DailyPaceCard plan={variant} />

          {/* scrollMarginTop, not scrollIntoView block:'center' or similar -
              without it the tabs land flush against the very top edge of the
              viewport with zero breathing room above them. Akber's
              follow-up, 9 Jul 2026. */}
          <div ref={topTabsRef} style={{ scrollMarginTop: 'var(--spacing-4)' }}>
            <SegmentedControl options={dayLabels} value={`Day ${day?.day}`} onChange={selectDay} />
          </div>

          {day && (
            <div className="stack" style={{ gap: 'var(--spacing-3)' }}>
              <h2 className="day-heading">{day.theme}</h2>
              {/* Flat siblings, not a per-pair wrapper div - see DetailView.jsx
                  for why (the wrapper meant itinerary-card-list's gap only
                  ever applied on one side of each indicator). */}
              <div className="itinerary-card-list">
                {day.items.map((item, index) => (
                  <Fragment key={index}>
                    <ComparisonCard item={item} />
                    {item.travelToNext && <TransportIndicator label={item.travelToNext} />}
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          <SegmentedControl options={dayLabels} value={`Day ${day?.day}`} onChange={selectDay} />

          <button type="button" className="button-primary button-full" onClick={handleExplore}>
            Explore this itinerary
          </button>
          <button type="button" className="delete-itinerary-button" onClick={() => setDeleteDialogOpen(true)}>
            Delete itinerary
          </button>
        </div>
      </div>
      <Footer />

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Delete this itinerary?"
        description="This can't be undone. Your generated plan won't be saved anywhere."
        confirmLabel="Delete itinerary"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </div>
  )
}
