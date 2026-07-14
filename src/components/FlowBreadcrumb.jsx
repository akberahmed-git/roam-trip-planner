import { Link } from 'react-router-dom'

const STEPS = [
  { label: 'Home', to: '/' },
  { label: 'Plan', to: '/trip-input' },
  { label: 'Stay', to: '/accommodation' },
  { label: 'Itinerary', to: '/comparison' },
]

// `extra` is an optional array of { label, to } steps inserted between the
// fixed STEPS base and `current` — used when a screen can be reached via
// different paths (e.g. Map reached via Swap vs. directly from Itinerary).
// Only pass `extra` when the user actually navigated through that branch;
// don't include it by default.
export default function FlowBreadcrumb({ current, extra = [] }) {
  const currentIndex = STEPS.findIndex((step) => step.label === current)
  const visible =
    currentIndex !== -1
      ? STEPS.slice(0, currentIndex + 1)
      : [...STEPS, ...extra, { label: current, to: '#' }]

  return (
    <nav className="flow-breadcrumb">
      {visible.map((step, index) => (
        <span key={step.label}>
          {index > 0 && <span className="flow-breadcrumb__sep"> / </span>}
          {index === visible.length - 1 ? (
            <span className="flow-breadcrumb__current">{step.label}</span>
          ) : (
            <Link className="flow-breadcrumb__link" to={step.to}>{step.label}</Link>
          )}
        </span>
      ))}
    </nav>
  )
}
