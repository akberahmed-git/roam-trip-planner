// Shared progress checklist (currently used by the Generating screen; the
// same shape could back Accommodation's loading state too, since it takes
// its labels as a prop rather than hardcoding them).
//
// Exact SVG supplied for the "done" checkmark - pasted verbatim rather than
// approximated, per the "ask for the real SVG" rule for flattened icons.
// Native 28x28, so it fills .checklist-step__icon exactly; its own circle
// fill (--color-teal-600) matches what .checklist-step__icon--done was
// already painting underneath, so no change needed there.
function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
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

// `steps` is an array of label strings, in the real order the backend does
// the work (see the caller for why each label was chosen). `activeIndex` is
// the index currently in progress - everything before it renders as done,
// everything after as pending. There's usually no live signal from the
// backend for exactly which phase is running (a single request/response,
// not a stream), so callers typically drive `activeIndex` with a timer -
// but the labels themselves should always describe real steps, not
// decorative ones invented to fill space.
export default function Checklist({ steps, activeIndex }) {
  return (
    <div className="checklist">
      {steps.map((label, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
        return (
          <div className="checklist-step" key={label}>
            <span className={`checklist-step__icon checklist-step__icon--${state}`}>
              {state === 'done' && <CheckIcon />}
              {state === 'active' && <span className="checklist-step__dot" />}
            </span>
            <p className={`checklist-step__label checklist-step__label--${state}`}>{label}</p>
          </div>
        )
      })}
    </div>
  )
}
