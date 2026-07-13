import { useEffect, useRef, useState } from 'react'

// Custom date-range picker. Native <input type="date"> calendar popups are
// rendered by the OS/browser outside the page's DOM, so they cannot be
// restyled with CSS at all - not even a little. This replaces the native
// popup with an in-page dropdown built entirely from Roam's design tokens,
// same idea as the destination autocomplete dropdown elsewhere in this app.

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2.5" y="3.5" width="13" height="12" rx="2" stroke="var(--text-tertiary)" strokeWidth="1.4" />
      <path d="M2.5 7H15.5" stroke="var(--text-tertiary)" strokeWidth="1.4" />
      <path d="M6 2V4.5M12 2V4.5" stroke="var(--text-tertiary)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon({ direction }) {
  const d = direction === 'left' ? 'M9.5 3.5 4.5 9l5 5.5' : 'M8.5 3.5 13.5 9l-5 5.5'
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path d={d} stroke="var(--text-brand)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })

function toISODate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromISODate(isoString) {
  const [year, month, day] = isoString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDisplay(isoString) {
  if (!isoString) return ''
  const [year, month, day] = isoString.split('-')
  return `${day}.${month}.${year}`
}

// Monday-first 6-week (42 cell) grid, including muted lead/trail days from
// the adjacent months so the grid height never jumps between months.
function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1)
  const leadingCount = (firstOfMonth.getDay() + 6) % 7 // getDay(): 0=Sun -> Monday-first offset
  const gridStart = new Date(year, month, 1 - leadingCount)

  const cells = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    cells.push({ date, inCurrentMonth: date.getMonth() === month })
  }
  return cells
}

function defaultRange() {
  const start = new Date()
  start.setDate(start.getDate() + 14)
  const end = new Date(start)
  end.setDate(end.getDate() + 3)
  return { start: toISODate(start), end: toISODate(end) }
}

// Days between two Date objects, inclusive count matching TripInput's own
// daysBetween() (same rounding, just operating on Date objects instead of
// ISO strings since the calendar grid already has real Date instances).
function daySpan(a, b) {
  const diffMs = b - a
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

export default function DateRangePicker({ startDate, endDate, onChange, maxDays }) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => fromISODate(startDate || toISODate(new Date())))
  const [draftStart, setDraftStart] = useState(startDate)
  const [draftEnd, setDraftEnd] = useState(endDate)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen])

  function openPicker() {
    setDraftStart(startDate)
    setDraftEnd(endDate)
    setViewDate(fromISODate(startDate || toISODate(new Date())))
    setIsOpen(true)
  }

  // A picker "edit" is transactional: opening snapshots the confirmed range
  // into draftStart/draftEnd, and only a completed second click (or Clear)
  // calls onChange - clicking away mid-selection just discards the draft,
  // so the field never ends up in a half-picked state.
  function handleDayClick(iso) {
    const hasCompleteRange = draftStart && draftEnd
    if (!draftStart || hasCompleteRange) {
      setDraftStart(iso)
      setDraftEnd(null)
      return
    }
    if (iso < draftStart) {
      setDraftStart(iso)
      setDraftEnd(null)
      return
    }
    setDraftEnd(iso)
    onChange(draftStart, iso)
    setIsOpen(false)
  }

  function handleClear() {
    const next = defaultRange()
    setDraftStart(next.start)
    setDraftEnd(next.end)
    onChange(next.start, next.end)
    setIsOpen(false)
  }

  // Matches the native picker's own "Today" behaviour: it only moves the
  // visible month, it doesn't change the selected range.
  function handleToday() {
    setViewDate(new Date())
  }

  function changeMonth(delta) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  const todayISO = toISODate(new Date())
  const cells = buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth())

  return (
    <div className="date-range-picker" ref={containerRef}>
      <div className="date-pair">
        <button type="button" className="date-box" onClick={openPicker} aria-label="Start date">
          <CalendarIcon />
          <span>{formatDisplay(startDate)}</span>
        </button>
        <button type="button" className="date-box" onClick={openPicker} aria-label="End date">
          <CalendarIcon />
          <span>{formatDisplay(endDate)}</span>
        </button>
      </div>

      {isOpen && (
        <div className="date-picker">
          <div className="date-picker__header">
            <button
              type="button"
              className="date-picker__nav-button"
              onClick={() => changeMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronIcon direction="left" />
            </button>
            <span className="date-picker__month-label">{MONTH_LABEL_FORMAT.format(viewDate)}</span>
            <button
              type="button"
              className="date-picker__nav-button"
              onClick={() => changeMonth(1)}
              aria-label="Next month"
            >
              <ChevronIcon direction="right" />
            </button>
          </div>

          <div className="date-picker__weekdays">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>

          <div className="date-picker__grid">
            {cells.map(({ date, inCurrentMonth }) => {
              const iso = toISODate(date)
              const isStart = iso === draftStart
              const isEnd = iso === draftEnd
              const isInRange = Boolean(draftStart && draftEnd && iso > draftStart && iso < draftEnd)
              const isToday = iso === todayISO

              // Once a start date is picked and we're waiting on an end date,
              // anything more than maxDays out is unselectable - keeps a trip
              // long enough to overflow the itinerary generator's token
              // budget from ever being chosen in the first place, rather
              // than rejecting it later at submit (see MAX_TRIP_DAYS).
              const pickingEnd = Boolean(draftStart && !draftEnd && iso !== draftStart)
              const tooFarFromStart =
                pickingEnd && maxDays != null && daySpan(fromISODate(draftStart), date) > maxDays
              // Picking a fresh start date is restricted to the month in
              // view (clicking a grayed lead/trail day to silently jump
              // months is confusing). But while picking an end date, those
              // same adjacent-month cells have to stay selectable when
              // they're within maxDays - otherwise a start date near the
              // end of a month (e.g. the 30th) can never reach a valid end
              // date at all, since every day within maxDays falls in the
              // grid's trailing "next month" cells.
              const isDisabled = pickingEnd ? tooFarFromStart : !inCurrentMonth

              return (
                <div key={iso} className="date-picker__cell">
                  <button
                    type="button"
                    className={[
                      'date-picker__day',
                      !inCurrentMonth ? 'date-picker__day--adjacent' : '',
                      isToday && !isStart && !isEnd ? 'date-picker__day--today' : '',
                      isInRange ? 'date-picker__day--in-range' : '',
                      isStart || isEnd ? 'date-picker__day--selected' : '',
                      tooFarFromStart ? 'date-picker__day--out-of-range' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={isDisabled}
                    onClick={() => handleDayClick(iso)}
                  >
                    {date.getDate()}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="date-picker__footer">
            <button type="button" className="date-picker__footer-button" onClick={handleClear}>
              Clear
            </button>
            <button type="button" className="date-picker__footer-button" onClick={handleToday}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
