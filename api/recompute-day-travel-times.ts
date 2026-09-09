import { computeTravelTimes } from './_lib/travelTime.js';
import { fillMissingTravelTimes } from './_lib/scheduleRealign.js';
import { applyFixedSchedule } from './_lib/fixedSchedule.js';
import { checkRateLimit, rateLimitResponse } from './_lib/rateLimit.js';

// Kept in step with generate-resolved-itinerary.js's own floor for Slow days.
const SLOW_MIN_STAY_MINUTES = 75;

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

  // Routes calls are cached per coordinate pair, so a real user rarely bills
  // here, but a script posting random coordinates would. The client keeps the
  // last travel times on a 429.
  const limit = await checkRateLimit('travel', req);
  if (!limit.allowed) {
    return rateLimitResponse(res, limit);
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
    // The same single pass initial generation runs, so a swapped day reads
    // identically to a freshly generated one: the meals stay on their fixed
    // times and the stop durations absorb whatever the swap did to the travel.
    //
    // No cutoff is passed because this route is given one day in isolation and
    // cannot know whether nightlife was chosen or whether this is the last day
    // of the trip. The practical effect is that dinner here never gives ground
    // to an end-of-day limit, which is the right default for a single edit: a
    // swap should not silently drop the stop the traveller just chose.
    // Which variant this day belongs to, inferred from its meals: the Slow
    // plan sets every meal to 120 minutes and every other variant to 60. The
    // client posts only the day's items, and refitting a Slow day with the
    // Packed floor would let a swap quietly shrink a stop back to 45 minutes.
    const slow = day.items.some((item) => item.mealType && item.durationMinutes >= 120);
    applyFixedSchedule(day, {
      cutoffMinutes: null,
      transport,
      minStayMinutes: slow ? SLOW_MIN_STAY_MINUTES : undefined,
    });
    res.status(200).json({ items: day.items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
