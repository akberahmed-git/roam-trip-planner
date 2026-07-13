import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted (bundled via node_modules, not fetched from Google's CDN at
// runtime) - see index.html for why this replaced the old <link> tag.
// Only the four weights actually used anywhere in the app (see tokens.css's
// --font-weight-* values): 400 regular, 500 medium, 600 semibold, 700 bold.
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
