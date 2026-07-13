import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// React Router (like most client-side routers) doesn't reset scroll
// position on navigation by default - since it's all one document, the
// browser just leaves the viewport wherever it was on the previous screen.
// Without this, navigating from partway down a long page (e.g. scrolled
// through Accommodation's hotel list) to a new screen would land you
// partway down that screen too, rather than at its top. Renders nothing;
// only exists to run this effect on every route change.
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
