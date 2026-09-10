import { Link, useLocation } from 'react-router-dom'

function RoamLogoIcon() {
  return (
    <svg width="19" height="24" viewBox="0 0 19 24" fill="none">
      <path
        d="M9.39648 0C14.5644 6.8881e-05 18.793 4.0724 18.793 9.08398C18.7929 11.0676 18.1136 12.9467 16.9131 14.5127L9.81445 23.8057C9.76239 23.8577 9.76173 23.8574 9.70996 23.9092C9.50121 24.0658 9.13519 24.0143 8.97852 23.8057L1.87891 14.5127C0.678471 12.9467 9.31617e-05 11.0675 0 9.08398C0 4.07236 4.22849 0 9.39648 0ZM9.39648 4.17773C8.54007 7.36747 7.36908 8.53987 4.17578 9.39746C7.36556 10.2539 8.53891 11.4247 9.39648 14.6182C10.2529 11.4284 11.423 10.2551 14.6162 9.39746C11.4268 8.54104 10.254 7.37088 9.39648 4.17773Z"
        fill="#10A2BC"
      />
    </svg>
  )
}

export default function Header() {
  // Both controls go Home. On Home itself that is a navigation to the page
  // already showing, which only replays the screen's enter animation, so
  // there they are plain elements instead (Akber, 10 Sep 2026).
  const onHome = useLocation().pathname === '/'
  return (
    <header className="app-header">
      {onHome ? (
        <span className="app-header__logo">
          <RoamLogoIcon />
          Roam
        </span>
      ) : (
        <Link to="/" className="app-header__logo">
          <RoamLogoIcon />
          Roam
        </Link>
      )}
      {onHome ? (
        <span className="app-header__menu" aria-label="Menu">
          <span />
          <span />
          <span />
        </span>
      ) : (
        <Link to="/" className="app-header__menu" aria-label="Menu">
          <span />
          <span />
          <span />
        </Link>
      )}
    </header>
  )
}
