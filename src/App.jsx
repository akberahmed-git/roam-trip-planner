import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
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
    </TripProvider>
  )
}

export default App
