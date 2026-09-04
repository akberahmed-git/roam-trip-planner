import { TOKYO_2_DAYS, TOKYO_ACCOMMODATION } from './savedTrips/tokyo'
import type { DemoTrip } from '../types'

// The fixed demo entry shown in "My trips" (Home and the dedicated My trips
// page) alongside the single most recent real save. Pre-captured from a real
// run through the live pipeline (Claude draft -> Places verification -> Routes
// travel times) and bundled here so clicking the card jumps straight to
// Comparison with no live generation call.
//
// The accommodation is imported from the generated fixture rather than written
// out here. It used to be duplicated, and scripts/reseed-tokyo-demo.js could
// only rewrite one field of it (photoUrl) - so a re-seed that picked a
// different hotel left this block naming one hotel while the itinerary's own
// bookend stops named another, with a photo belonging to the second. One
// generated source of truth removes the possibility.
//
// Lives in its own module (not inside Home.jsx) so the My trips page can reuse
// the exact same demo without either screen owning the other's data.
export const DEMO_TRIPS: DemoTrip[] = [
  {
    title: '2 days in Tokyo',
    subtitle: 'Feb 2026 · Temples & Shrines · Anime & Pop Culture · Nightlife · Modern Architecture',
    destination: 'Tokyo',
    days: 2,
    interests: ['Temples & Shrines', 'Anime & Pop Culture', 'Nightlife', 'Modern Architecture'],
    budget: 'Standard',
    accommodation: TOKYO_ACCOMMODATION.name,
    accommodationDetails: TOKYO_ACCOMMODATION,
    savedItinerary: TOKYO_2_DAYS,
  },
]
