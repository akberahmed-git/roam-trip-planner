import { TOKYO_2_DAYS } from './savedTrips/tokyo'

// The fixed demo entry shown in "My trips" (Home and the dedicated My trips
// page) alongside the single most recent real save. Pre-captured from a real
// run through the live pipeline (Claude draft -> Places verification -> Routes
// travel times) and bundled here so clicking the card jumps straight to
// Comparison with no live generation call. Hotel Chinzanso Tokyo is the
// pre-selected Standard accommodation.
//
// Lives in its own module (not inside Home.jsx) so the My trips page can reuse
// the exact same demo without either screen owning the other's data.
export const DEMO_TRIPS = [
  {
    title: '2 days in Tokyo',
    subtitle: 'Feb 2026 · Temples & Shrines · Anime & Pop Culture · Nighte & Entertainment · Modern Architecture',
    destination: 'Tokyo',
    days: 2,
    interests: ['Temples & Shrines', 'Anime & Pop Culture', 'Nightlife & Entertainment', 'Modern Architecture'],
    budget: 'Standard',
    accommodation: 'Hotel Chinzanso Tokyo',
    accommodationDetails: {
      name: 'Hotel Chinzanso Tokyo',
      categoryTag: 'Hotel · Bunkyo City',
      address: '2-chōme-10-8 Sekiguchi, Bunkyo City, Tokyo 112-8680, Japan',
      rating: 4.4,
      ratingCount: 10408,
      photoUrl: '/api/place-photo?ref=places%2FChIJNxw8EQSNGGART8GbVls3c4A%2Fphotos%2FAWCwydiGolg6Ujhot7izHmXrY9R-ZVUVNdXAIQXV_VOFcbB4aNrfdYGnCdHO2RTi6jT2CVdPLwckL92Bew4Z4_I8A9TvGrpZ9dMUFjXUWmlTSaX4zza3Z_SpFRUdKLI6u27F0uzTBuuFD75husyZcMXZFczV6Y1UOcsN8pKXkn4C_bGoU5Wgci8I78lwSdkMg-ndg-tcgxkEIMmZO_KPIlC5CpIbHWzYoCJNH5-rYJmnK0AQHFcmtYVdZk_wUzf-VAwdSW_dRIQJdFweA68EZdlgGvlORfb8y0MRJ-1Y-TbhIJBe3JytcDMO8Nr5Ch4qy31vCTmlPSew3srerkhhx4xqNMERVBtX3gPJNwdh3hPDlIJZDDUJ36TAalRyJmllb3tWKx7GQ9vUFSTGnmibng3gAt3FIaeIVZyF3xUus1a_3cECOQ',
      priceLevelLabel: null,
      budget: 'Standard',
      nights: 2,
      priceRange: { min: 40000, max: 90000, currencyCode: 'JPY', estimated: true },
      placeId: 'ChIJNxw8EQSNGGART8GbVls3c4A',
      location: { lat: 35.7117779, lng: 139.7257143 },
    },
    savedItinerary: TOKYO_2_DAYS,
  },
]
