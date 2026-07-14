import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useRef, useState, useLayoutEffect } from 'react'
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

function AnimatedRoutes() {
  const location = useLocation()

  // Track history index to determine slide direction
  const prevIdxRef = useRef(window.history.state?.idx ?? 0)
  const dirRef = useRef('forward')
  const currentIdx = window.history.state?.idx ?? 0
  if (currentIdx !== prevIdxRef.current) {
    dirRef.current = currentIdx > prevIdxRef.current ? 'forward' : 'back'
    prevIdxRef.current = currentIdx
  }

  const [animKey, setAnimKey] = useState(location.key)
  const [dir, setDir] = useState('forward')

  useLayoutEffect(() => {
    setDir(dirRef.current)
    setAnimKey(location.key)
  }, [location.key])

  const className =
    dir === 'forward' ? 'route-slide route-slide--forward' : 'route-slide route-slide--back'

  return (
    <div style={{ overflowX: 'hidden' }}>
      <div key={animKey} className={className}>
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
        </Routes>
      </div>
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
