import { useEffect, useRef, useState } from 'react'

// Exact SVG supplied for the Currency field icon (Figma node 345:31209
// collapsed / 345:31118 expanded) - pasted verbatim rather than
// approximated, per the "ask for the real SVG" rule for flattened icons.
// Replaces the earlier hand-drawn approximation.
function CoinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M10 1.9502C14.439 1.9502 18.0498 5.56096 18.0498 10C18.0498 14.439 14.439 18.0498 10 18.0498C5.56096 18.0498 1.9502 14.439 1.9502 10C1.9502 5.56096 5.56096 1.9502 10 1.9502ZM10 3.19238C6.24686 3.19238 3.19238 6.24686 3.19238 10C3.19238 13.7539 6.24686 16.8076 10 16.8076C13.7539 16.8076 16.8076 13.7539 16.8076 10C16.8076 6.24686 13.7539 3.19238 10 3.19238ZM10.6211 4.23535V5.41406C11.9066 5.58065 12.9072 6.66906 12.9072 8V8.0498H11.6641V8C11.6641 7.35556 11.2198 6.81342 10.6211 6.66309V9.41406C11.9066 9.58065 12.9072 10.6691 12.9072 12C12.9072 13.3315 11.9065 14.4183 10.6211 14.585V15.7637H9.37891V14.585C8.09349 14.4183 7.09284 13.3309 7.09277 12V11.9502H8.33594V12C8.336 12.6443 8.78036 13.1855 9.37891 13.3359V10.585C8.09348 10.4183 7.09282 9.33081 7.09277 8C7.09277 6.66911 8.09341 5.58066 9.37891 5.41406V4.23535H10.6211ZM10.6211 13.3359C11.2196 13.1856 11.664 12.6443 11.6641 12C11.6641 11.3556 11.2197 10.8138 10.6211 10.6641V13.3359ZM9.37891 6.66309C8.78023 6.81341 8.33594 7.35556 8.33594 8C8.33598 8.64433 8.78043 9.18518 9.37891 9.33496V6.66309Z"
        fill="var(--text-disabled)"
        stroke="var(--text-disabled)"
        strokeWidth="0.1"
      />
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--duration-fast) var(--easing-standard)' }}
    >
      <path d="M4 6l4 4 4-4" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Currency picker for the Accommodation price-range display (Figma node
// 345:31118). A plain custom dropdown, not a <select>, to match the exact
// list-panel styling in the design (rounded top/bottom only on the end
// items, selected row highlighted). Shows 3-letter codes only (both
// collapsed and expanded), not full currency names - updated per the
// 345:31118 Figma refresh, confirmed the expanded list drops full names too.
// currencyDisplayName() in utils/currency.js is left in place, unused for
// now, in case a full-name display is needed again somewhere else.
export default function CurrencySelect({ id, value, options, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectOption(code) {
    onChange(code)
    setIsOpen(false)
  }

  return (
    <div className="currency-select" ref={containerRef}>
      <button
        type="button"
        id={id}
        className={`currency-select__control ${isOpen ? 'currency-select__control--open' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <CoinIcon />
        <span className="currency-select__value">{value}</span>
        <ChevronIcon open={isOpen} />
      </button>

      {isOpen && (
        <ul className="currency-select__list" role="listbox">
          {options.map((code) => (
            <li
              key={code}
              role="option"
              aria-selected={code === value}
              className={`currency-select__option ${code === value ? 'currency-select__option--selected' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault()
                selectOption(code)
              }}
            >
              {code}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
