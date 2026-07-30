// Shared loading treatment (spinner + heading + subtext), currently used by
// Generating and Accommodation. When Generating gets rebuilt to match the
// Figma checklist UI, update it here so every screen that "waits on real
// data" picks up the same look.
export default function LoadingState({ heading, subtext }) {
  return (
    <div className="container stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <div className="spinner" />
      {heading && <h1>{heading}</h1>}
      {subtext && <p className="page-intro">{subtext}</p>}
    </div>
  )
}
