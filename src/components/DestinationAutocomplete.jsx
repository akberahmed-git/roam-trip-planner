import { useEffect, useRef, useState } from 'react'

const DEBOUNCE_MS = 300
const MIN_INPUT_LENGTH = 2

// Exact SVG supplied for the Destination field icon (Figma node 50:27) -
// pasted verbatim rather than approximated, per the "ask for the real SVG"
// rule for flattened icons.
function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M10.5008 18.1662C12.0508 16.8278 16.6666 12.4945 16.6666 8.33366C16.6666 6.56555 15.9643 4.86986 14.714 3.61961C13.4638 2.36937 11.7681 1.66699 9.99998 1.66699C8.23187 1.66699 6.53618 2.36937 5.28593 3.61961C4.03569 4.86986 3.33331 6.56555 3.33331 8.33366C3.33331 12.4945 7.94915 16.8278 9.49915 18.1662C9.64354 18.2747 9.81931 18.3335 9.99998 18.3335C10.1806 18.3335 10.3564 18.2747 10.5008 18.1662Z"
        stroke="var(--text-disabled)"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 10.833C11.3807 10.833 12.5 9.71372 12.5 8.33301C12.5 6.9523 11.3807 5.83301 10 5.83301C8.61929 5.83301 7.5 6.9523 7.5 8.33301C7.5 9.71372 8.61929 10.833 10 10.833Z"
        stroke="var(--text-disabled)"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HighlightedText({ text, matches }) {
  if (!matches || matches.length === 0) {
    return <span className="autocomplete-item__rest">{text}</span>
  }

  const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset)
  const segments = []
  let cursor = 0

  sorted.forEach((match, index) => {
    const start = match.startOffset ?? 0
    const end = match.endOffset ?? start
    if (start > cursor) {
      segments.push({ key: `plain-${index}`, text: text.slice(cursor, start), bold: false })
    }
    segments.push({ key: `bold-${index}`, text: text.slice(start, end), bold: true })
    cursor = end
  })

  if (cursor < text.length) {
    segments.push({ key: 'plain-end', text: text.slice(cursor), bold: false })
  }

  return segments.map((segment) => (
    <span key={segment.key} className={segment.bold ? 'autocomplete-item__match' : 'autocomplete-item__rest'}>
      {segment.text}
    </span>
  ))
}

// Real destination search, backed by Google Places Autocomplete (New) via
// /api/place-autocomplete, matching the "every place shown is real" rule
// used everywhere else in the app.
export default function DestinationAutocomplete({ id, value, onChange, placeholder, autoFocus }) {
  const [suggestions, setSuggestions] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef(null)
  const debounceRef = useRef(null)
  const requestIdRef = useRef(0)
  // Set right before selectSuggestion calls onChange below - picking a
  // suggestion changes `value` (this is a controlled input), which re-runs
  // this same effect exactly like a keystroke would, with no way to tell the
  // two apart otherwise. Without this guard, selecting a suggestion closed
  // the dropdown for a moment and then immediately searched again for the
  // now-full destination text and reopened it - a real bug Akber caught
  // (9 Jul 2026), not intended debounce/search behavior.
  const justSelectedRef = useRef(false)

  useEffect(() => {
    const trimmed = value.trim()
    clearTimeout(debounceRef.current)

    if (justSelectedRef.current) {
      justSelectedRef.current = false
      setSuggestions([])
      setIsOpen(false)
      return
    }

    if (trimmed.length < MIN_INPUT_LENGTH) {
      setSuggestions([])
      setIsOpen(false)
      return
    }

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current
      fetch(`/api/place-autocomplete?input=${encodeURIComponent(trimmed)}`)
        .then((response) => (response.ok ? response.json() : { suggestions: [] }))
        .then((data) => {
          if (requestId !== requestIdRef.current) return
          const next = data.suggestions || []
          setSuggestions(next)
          setIsOpen(next.length > 0)
          setActiveIndex(-1)
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return
          setSuggestions([])
          setIsOpen(false)
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(debounceRef.current)
  }, [value])

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectSuggestion(suggestion) {
    // Must be set before onChange - onChange's value update is what
    // re-triggers the suggestions effect above, so the flag needs to already
    // be in place by the time that happens, not after.
    justSelectedRef.current = true
    // Second arg tells the caller this was a deliberate pick (click or
    // Enter), not a keystroke - TripInput.jsx uses that to skip its
    // interest-suggestions debounce, since there's nothing left to debounce
    // against once a specific destination has been chosen outright.
    onChange(suggestion.text, true)
    setSuggestions([])
    setIsOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyDown(event) {
    if (!isOpen || suggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0) {
        event.preventDefault()
        selectSuggestion(suggestions[activeIndex])
      }
    } else if (event.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div className="autocomplete" ref={containerRef}>
      <div className="autocomplete-input-wrap">
        <span className="autocomplete-icon">
          <PinIcon />
        </span>
        <input
          id={id}
          className="form-input autocomplete-input"
          type="text"
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true)
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
        />
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul className="autocomplete-list" id={`${id}-listbox`} role="listbox">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.placeId || suggestion.text}
              role="option"
              aria-selected={index === activeIndex}
              className={`autocomplete-item ${index === activeIndex ? 'autocomplete-item--active' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault()
                selectSuggestion(suggestion)
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="autocomplete-item__text">
                <HighlightedText text={suggestion.text} matches={suggestion.matches} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
