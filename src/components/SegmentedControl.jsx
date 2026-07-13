export default function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={`segmented__option ${option === value ? 'segmented__option--active' : ''}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
