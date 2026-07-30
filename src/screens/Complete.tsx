import Header from '../components/Header'
import Footer from '../components/Footer'

// Terminal "Task complete" screen (Figma node 721:17338). Finalise & Save
// redirects here right after the user saves their trip, so the end of the flow
// is unmistakable. The copy is written for the unmoderated UXtweak mobile test:
// it tells the respondent the task is finished and to return to the UXtweak app
// and tap "Task done" to continue. There is deliberately no in-app CTA - the
// next action happens back in the testing app, not in Roam. The trip itself is
// already saved to "My trips" before this screen shows.
export default function Complete() {
  return (
    <div className="app-page">
      <Header />
      <div className="screen">
        <div className="container stack">
          <div className="stack" style={{ gap: 'var(--spacing-2)' }}>
            <h1 className="home-section__title">Task complete</h1>
            <p style={{ color: 'var(--text-brand)', margin: 0, lineHeight: 1.5 }}>
              Please return to the UXtweak app.
              <br />
              Then tap ‘Task done’ to continue.
            </p>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
