import { computeTravelTimes } from './_lib/travelTime.js';
import {
  fillMissingTravelTimes,
  realignScheduleTimes,
  roundStayDurations,
  snapArrivalsToGrid,
  stretchPreDinnerGap
} from './_lib/scheduleRealign.js';

// Called after a swap or reorder on the Detail screen (see TripContext.jsx's
// swapDayItem/reorderDayItem) - both clear travelToNext on the legs they
// affect immediately, client-side, so a stale number is never shown as if
// it's still current. But clearing isn't the same as fixing: neither action
// can get a fresh, honest travel time on its own, since that needs a live
// Google Routes API call the client can't make directly, and without a new
// number the schedule realignment from generate-resolved-itinerary.js has
// nothing to reconcile against either. This is that missing step, run
// against just the one affected day rather than regenerating the whole
// trip.
//
// Deliberately does NOT re-run the >2 hour drive-cap backstop
// (enforceDriveCap in generate-resolved-itinerary.js) - that can substitute
// in an entirely different place, which needs the full itinerary's
// usedPlaceIds to avoid picking a duplicate already shown elsewhere in the
// trip. A day-scoped recompute doesn't have that context. If a swap or
// reorder produces a genuinely unreasonable drive, it'll still show as a
// real, honest number - just not auto-corrected the way the initial
// generation is.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const destination = req.body.destination;
  const transport = req.body.transport;
  const items = req.body.items;

  if (!destination || !Array.isArray(items)) {
    return res.status(400).json({ error: 'destination and items are required' });
  }

  try {
    const day = { items };
    await computeTravelTimes(day.items, transport);
    await fillMissingTravelTimes(day, transport, destination);
    // Same reconciliation tail as initial generation (see
    // generate-resolved-itinerary.js), so a swapped or reordered day reads
    // identically to a freshly generated one: reconcile against real travel,
    // fill any pre-dinner gap by stretching the afternoon (which keeps dinner
    // parked in its evening window rather than sliding earlier when a swap
    // frees up time), round stays to the 15-minute grid, re-cascade, then snap
    // arrivals to the grid and fill any leg the swap left without a travel time
    // (which would otherwise show as a gap on the affected day).
    realignScheduleTimes(day);
    stretchPreDinnerGap(day);
    roundStayDurations(day);
    realignScheduleTimes(day);
    snapArrivalsToGrid(day, transport);
    res.status(200).json({ items: day.items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
