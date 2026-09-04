import { Analytics } from '@vercel/analytics/react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { TripProvider } from './context/TripContext'
import ScrollToTop from './components/ScrollToTop'
import Home from './screens/Home'
import TripInput from './screens/TripInput'
import Accommodation from './screens/Accommodation'
import VoiceConfirmation from './screens/VoiceConfirmation'
import Generating from './screens/Generating'
import ComparisonView from './screens/ComparisonView'
import SwapPlaces from './screens/SwapPlaces'
import SwapThisPlace from './screens/SwapThisPlace'
import MapView from './screens/MapView'
import FinaliseSave from './screens/FinaliseSave'
import MyTrips from './screens/MyTrips'
import Complete from './screens/Complete'

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <div key={location.key} className="route-transition">
      <Routes location={location}>
        <Route path="/" element={<Home />} />
        <Route path="/trip-input" element={<TripInput />} />
        <Route path="/accommodation" element={<Accommodation />} />
        <Route path="/voice-confirmation" element={<VoiceConfirmation />} />
        <Route path="/generating" element={<Generating />} />
        <Route path="/comparison" element={<ComparisonView />} />
        <Route path="/swap_place" element={<SwapPlaces />} />
        <Route path="/swap" element={<SwapThisPlace />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/finalise" element={<FinaliseSave />} />
        <Route path="/my-trips" element={<MyTrips />} />
        <Route path="/complete" element={<Complete />} />
        {/* The flow breadcrumb reads "Home / Plan / Stay / Itinerary", so /plan
            is the URL people type or guess. It never existed - the screen lives
            at /trip-input - and vercel.json's SPA rewrite meant it served
            index.html to a router with no matching route, rendering a blank
            white page rather than a 404. */}
        <Route path="/plan" element={<Navigate to="/trip-input" replace />} />
        {/* Same failure mode for any other unmatched path. Home is a better
            landing than nothing at all. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function App() {
  return (
    <TripProvider>
      <BrowserRouter>
        <ScrollToTop />
        <AnimatedRoutes />
      </BrowserRouter>
      <Analytics />
    </TripProvider>
  )
}

export default App
