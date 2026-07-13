// Shared page footer, added below every screen in the latest Figma pass
// (source: file Z6y8zocU1df1OAwxwEJT6n, e.g. node 313:30350 on the
// Accommodation frame). Matches Figma's structure exactly: three static link
// columns, a divider, and a copyright line. The columns aren't wired to real
// navigation yet - Figma renders them as plain text, not links, and several
// (Help, About, Settings) have no corresponding screen built yet.
export default function Footer() {
  return (
    <footer className="app-footer">
      {/* Mirrors the .screen > .container box model used by every other
          screen (32px padding, then a 760px-max centered column), so the
          footer's content lines up with the content above it instead of
          spanning full-bleed while the page content is constrained. */}
      <div className="app-footer__screen">
        <div className="container app-footer__inner">
          <div className="app-footer__columns">
            <div className="app-footer__column">
              <span className="app-footer__heading">Explore</span>
              <span className="app-footer__link">Plan a trip</span>
              <span className="app-footer__link">Map view</span>
            </div>
            <div className="app-footer__column">
              <span className="app-footer__heading">Support</span>
              <span className="app-footer__link">Help</span>
              <span className="app-footer__link">About</span>
            </div>
            <div className="app-footer__column">
              <span className="app-footer__heading">Account</span>
              <span className="app-footer__link">Settings</span>
            </div>
          </div>
          <div className="app-footer__divider" />
          {/* Figma's copy still says "Wayfinder" (the old project name, before
              the Roam rename) - shown here as "Roam" to match the rest of the
              app. */}
          <p className="app-footer__copyright">© Roam. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
