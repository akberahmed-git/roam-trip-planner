// Three beacons per visit, so the owner can see how long a plan takes from
// blank screen to saved and where people drop out. Session id is random and
// lives in sessionStorage only: it identifies a visit, not a person, and dies
// with the tab. Sent with sendBeacon so it survives navigation, and every
// failure is swallowed, since nothing about the app depends on it.

const SESSION_KEY = 'roam:session'
const LANDED_KEY = 'roam:landedAt'
const LANDED_SENT_KEY = 'roam:landedSent'

type TrackEvent = 'landed' | 'plan_started' | 'generate' | 'generated' | 'rate_limited' | 'saved' | 'swap'

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
}

function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = randomId()
      sessionStorage.setItem(SESSION_KEY, id)
      sessionStorage.setItem(LANDED_KEY, String(Date.now()))
    }
    return id
  } catch {
    return null
  }
}

export function track(event: TrackEvent, extra: { destination?: string } = {}) {
  try {
    const session = sessionId()
    if (!session) return
    const landedAt = Number(sessionStorage.getItem(LANDED_KEY)) || Date.now()
    const payload = JSON.stringify({
      session,
      event,
      elapsedMs: Date.now() - landedAt,
      path: window.location.pathname,
      ...extra,
    })
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/stats', new Blob([payload], { type: 'application/json' }))
    } else {
      fetch('/api/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // Never let tracking touch the app.
  }
}

// Once per session, on first mount.
export function trackLanded() {
  try {
    if (sessionStorage.getItem(LANDED_SENT_KEY)) return
    sessionStorage.setItem(LANDED_SENT_KEY, '1')
  } catch {
    return
  }
  track('landed')
}
