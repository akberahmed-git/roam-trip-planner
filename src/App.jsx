import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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

// iOS-style parallax slide: entering screen slides fully from right (or left
// on back), exiting screen drifts back ~30% while fading. Direction is read
// from the history index React Router sets on every navigation — positive
// means forward, negative means back.
const variants = {
  enter: (dir) => ({ x: dir >= 0 ? '100%' : '-100%', opacity: 1 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir >= 0 ? '-30%' : '30%', opacity: 0 }),
}

const enterTransition = {
  duration: 0.32,
  ease: [0, 0, 0.2, 1], // --easing-decelerate: enters settle smoothly
}

const exitTransition = {
  duration: 0.22,
  ease: [0.4, 0, 1, 1], // --easing-accelerate: exits leave quickly
}

function AnimatedRoutes() {
  const location = useLocation()

  // React Router sets window.history.state.idx on every navigation.
  // Comparing current vs previous index tells us which direction to slide.
  const prevIdxRef = useRef(window.history.state?.idx ?? 0)
  const dirRef = useRef(1)
  const currentIdx = window.history.state?.idx ?? 0
  if (currentIdx !== prevIdxRef.current) {
    dirRef.current = currentIdx > prevIdxRef.current ? 1 : -1
    prevIdxRef.current = currentIdx
  }

  return (
    // overflow-hidden clips both screens during the slide so neither pokes
    // outside the viewport. min-h-screen keeps the container tall enough
    // that popLayout can size the exiting element correctly.
    <div style={{ position: 'relative', overflowX: 'hidden', minHeight: '100vh' }}>
      <AnimatePresence mode="popLayout" custom={dirRef.current} initial={false}>
        <motion.div
          key={location.pathname}
          custom={dirRef.current}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={enterTransition}
          // Exit transition is faster than enter so the old screen gets
          // out of the way crisply while the new one eases in.
          style={{ width: '100%' }}
          // Override the exit transition independently
          onAnimationStart={() => {}}
        >
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
        </motion.div>
      </AnimatePresence>
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
