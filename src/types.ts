// Central domain types for the Roam trip planner. Derived from the real data
// shapes bundled in src/data (demoTrips.ts, savedTrips/tokyo.ts) and from the
// request/response payloads the api/ handlers exchange with the client. Kept in
// one place so the context, screens and utilities all describe the same trip
// the same way rather than each re-guessing field names.
import type { Dispatch, SetStateAction } from 'react'

// A geographic point, as returned by Google Places/Geocoding and stored on
// every resolved place and accommodation.
export interface Coordinates {
  lat: number
  lng: number
}

// The three fixed budget tiers, chosen on Trip Input and used to pick which
// accommodation tier loads (see Accommodation).
export type Budget = 'Economy' | 'Standard' | 'Luxury'

// Interest chips are free-form labels - a fixed staple set plus a
// per-destination generated set (see TripInput / interestSuggestions).
export type Interest = string

// A hotel price band in some currency. Comes back from hotelSearch in the
// destination's local currency and is then converted for display.
export interface PriceRange {
  min: number
  max: number
  currencyCode: string | null
  estimated?: boolean
}

export type ItemType = 'accommodation' | 'activity' | 'meal'
export type MealType = 'breakfast' | 'lunch' | 'dinner'

// One stop on a day's plan. Most fields are nullable because a stop starts as
// a Claude draft and is progressively enriched (Places verification, travel
// times, schedule realignment) - any given field may not have resolved yet.
export interface ItineraryItem {
  type: ItemType
  name: string
  categoryTag?: string | null
  description?: string
  mealType?: MealType | null
  address?: string | null
  rating?: number | null
  ratingCount?: number | null
  photoUrl?: string | null
  hasHours?: boolean
  weekdayDescriptions?: string[] | null
  location?: Coordinates | null
  time?: string
  startTime?: string | null
  durationMinutes?: number | null
  travelToNext?: string | null
  placeId?: string
  // Legacy display fields carried on some items/alternatives: a review count
  // (distinct from ratingCount on older data) and a "busy at" note. Read by
  // the Swap screens' place cards.
  reviewCount?: number | null
  busyTime?: string | null
  // Set by the resolver when two proposed stops map to the same Google
  // listing; the flagged copy is dropped before display.
  _duplicatePlace?: boolean
}

// One day within a plan variant.
export interface DayPlan {
  day: number
  theme?: string
  breakfastAtAccommodation?: boolean
  breakfastTime?: string
  items: ItineraryItem[]
  stopCount?: number
  pacingLevel?: number
}

// One of the two generated options the user compares (e.g. "Packed & Varied"
// vs "Slow & Immersive").
export interface PlanVariant {
  label: string
  tagline?: string
  divergenceLabel?: string
  days: DayPlan[]
  pacingLabel?: string
}

// The full generation result: a map keyed by variant ("packed" / "slow") to
// the resolved plan for that variant. Keyed by string so screens can index it
// with the currently selected variant key.
export type ResolvedItinerary = Record<string, PlanVariant>

// A verified Google place, as returned by verifyPlace / findNearbyCandidates
// and adopted onto an ItineraryItem.
export interface Place {
  placeId: string
  name: string
  address?: string | null
  rating?: number | null
  ratingCount?: number | null
  photoUrl?: string | null
  hasHours?: boolean
  weekdayDescriptions?: string[] | null
  location?: Coordinates | null
  categoryTag?: string | null
}

// A hotel card as shown on the Accommodation screen (one row of a tier).
export interface AccommodationOption {
  name: string
  categoryTag?: string | null
  address?: string | null
  rating?: number | null
  ratingCount?: number | null
  photoUrl?: string | null
  priceLevelLabel?: string | null
  placeId?: string
  location?: Coordinates | null
}

// The chosen hotel, captured with the extra context (budget, nights, resolved
// price range) needed by Finalise & Save and the itinerary generator's
// day-bookending step.
export interface AccommodationDetails extends AccommodationOption {
  budget?: Budget | string
  nights?: number | null
  priceRange?: PriceRange | null
}

// Everything the user entered/selected for a trip, threaded through the flow
// via TripContext.
export interface TripParams {
  destination: string
  days: number
  adults: number
  children: number
  startDate: string
  endDate: string
  budget: string
  transport: string
  interests: string[]
  // The exact interest chip set shown, kept so "go back and edit" can restore
  // it without re-rolling generation.
  interestOptions?: string[]
  accommodation?: string
  accommodationDetails?: AccommodationDetails | null
}

// A curated Home-screen carousel entry (see trendingLocations).
export interface TrendingLocation {
  name: string
  description: string
  photoUrl: string
}

// The generation lifecycle state exposed by TripContext.
export type TripStatus = 'idle' | 'loading' | 'success' | 'error'

// The bundled demo trip shown in "My trips" (see data/demoTrips).
export interface DemoTrip {
  title: string
  subtitle: string
  destination: string
  days: number
  interests: string[]
  budget: string
  accommodation?: string
  accommodationDetails?: AccommodationDetails | null
  savedItinerary?: ResolvedItinerary
}

// A user-saved trip persisted to localStorage (see utils/savedTrips). Broad
// enough to also cover the bundled demo entries Home merges alongside it.
export interface SavedTrip {
  destination: string
  days: number
  interests?: string[]
  budget?: string
  transport?: string
  accommodation?: string
  accommodationDetails?: AccommodationDetails | null
  savedItinerary?: ResolvedItinerary | null
  selectedVariant?: string | null
  title?: string
  subtitle?: string
  savedAt?: string
}

// The full surface TripContext exposes to consumers. useTrip() returns this
// (non-null), so every screen gets full typing rather than property-on-null
// errors.
export interface TripContextValue {
  tripParams: TripParams | null
  setTripParams: Dispatch<SetStateAction<TripParams | null>>
  resolvedItinerary: ResolvedItinerary | null
  selectedVariant: string | null
  setSelectedVariant: Dispatch<SetStateAction<string | null>>
  status: TripStatus
  errorMessage: string | null
  generateItinerary: (params: TripParams) => Promise<ResolvedItinerary>
  loadSavedItinerary: (data: ResolvedItinerary) => void
  reorderDayItem: (variantKey: string, dayIndex: number, itemIndex: number, direction: number) => void
  swapDayItem: (
    variantKey: string,
    dayIndex: number,
    itemIndex: number,
    replacement: Partial<ItineraryItem>
  ) => void
  isDayRecomputing: (variantKey: string, dayIndex: number) => boolean
  resetTrip: () => void
}
