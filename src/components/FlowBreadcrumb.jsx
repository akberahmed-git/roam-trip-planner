import { Link } from 'react-router-dom'

const STEPS = [
  { label: 'Home', to: '/' },
  { label: 'Plan', to: '/trip-input' },
  { label: 'Stay', to: '/accommodation' },
  { label: 'Itinerary', to: '/comparison' },
  { label: 'Swap', to: '/detail' },
]

// Map and Swap both branch off Details (Figma: "Home / Plan / Accomodation /
// Itinerary / Details / Map view" and ".../ Details / Swap") rather than
// chaining after each other, so they're appended on top of the fixed base
// list instead of being separate STEPS entries - two branches at the same
// depth, not a 7th sequential step.
export default function FlowBreadcrumb({ current }) {
  const currentIndex = STEPS.findIndex((step) => step.label === current)
  const visible =
    currentIndex !== -1
      ? STEPS.slice(0, currentIndex + 1)
      : [...STEPS, { label: current, to: '#' }]

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
