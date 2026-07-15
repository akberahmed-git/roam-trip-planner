# Roam Trip Planner — Complete Project Handoff

Covers the entire project from inception through post-launch bug fixes. Written for whoever (human or Claude) picks this up next. Replaces `HANDOFF.md`, `HANDOFF-2026-07-08.md`, and `HANDOFF-2026-07-14.md` — those files are kept for historical reference but this is the one to read.

---

## Stack

- **Frontend:** React 19 + Vite, `react-router-dom` v7 (`BrowserRouter`, `useNavigate`, `useLocation`)
- **Backend:** Vercel serverless functions under `/api`
- **Local dev:** `npx vercel dev` on port 3000 (auto-increments if taken — always check the actual "Local:" line it prints, not just port 3000)
- **Design:** Figma file key `Z6y8zocU1df1OAwxwEJT6n`. Design tokens in `src/styles/tokens.css`
- **AI:** Anthropic API — Claude Haiku (`claude-haiku-4-5`) for raw itinerary generation, Claude Sonnet (`claude-sonnet-4-5`) for description refresh and travel time estimates
- **Places:** Google Places API (v1 `searchText`), Google Routes API (distance matrix)
- **Repo on disk:** `/Users/bismaharrisahmad/Desktop/roam-trip-planner`

---

## Architecture overview

### Generation pipeline (the important part)

Every itinerary request goes through this sequence in `api/generate-resolved-itinerary.js`:

1. **`generateRawItinerary`** (`api/_lib/generateRawItinerary.js`) — two parallel Claude Haiku calls, one per variant (Packed & Varied, Slow & Immersive). Returns `{ packed: {...}, slow: {...} }`, each with `days[].items[]`.
2. Both variants enter **`resolveItinerary`** in parallel via `Promise.all`. Each call is fully independent — separate `allItems` arrays, separate `usedPlaceIds` Sets, no shared mutable state.
3. Inside `resolveItinerary`:
   - **Sort by startTime** — items sorted chronologically before anything else runs (Claude occasionally returns them out of order).
   - **`verifyPlace`** — Google Places lookup per item; substitutes real place data (name, address, rating, photo, coordinates).
   - **`refreshDescriptions`** — batched Claude Sonnet call audits every item's description and meal tag for consistency with the real place name.
   - **`enforceMealConstraints`** — clamps every meal's startTime to its window and fixes duration to 60 min.
   - **`ensureDinner`** — injects a placeholder dinner at 19:30 if Claude forgot to include one.
   - **`applyAccommodationBookends`** — adds hotel departure/return stops to each day.
   - **`enforceEarliestStart`** — nothing starts before 09:00.
   - **`computeTravelTimes`** — Google Routes API for each consecutive pair with known coordinates.
   - **`enforceDriveCap`** — replaces any stop that's more than 60 minutes from the previous one; tries same-name nearby first, then falls back to category search.
   - **`fillMissingTravelTimes`** — Claude Sonnet estimate for any pair where routing returned null (parallel, not sequential).
   - **`realignScheduleTimes`** — cascades startTimes forward using final travelToNext durations. Meals have a 60-minute drift tolerance before being snapped back.
   - **`stretchPreDinnerGap`** — distributes any gap before dinner across post-lunch activities (capped at 150 min each). Then `realignScheduleTimes` runs again.
4. `raw` (now mutated in place) is returned as `res.status(200).json(raw)`.

### Meal windows (enforced server-side, not trusted from Claude)
```
breakfast: 09:00 – 10:30
lunch:     12:00 – 14:00
dinner:    19:00 – 21:00
```

### Key constants
```js
MEAL_DRIFT_TOLERANCE_MINUTES = 60   // scheduleRealign.js
MAX_SAME_DAY_TRAVEL_MINUTES = 60    // generate-resolved-itinerary.js
MAX_SINGLE_ACTIVITY_DURATION_MINUTES = 150
MIN_GAP_TO_STRETCH_MINUTES = 30
PRE_DINNER_BUFFER_MINUTES = 15
MAX_BROAD_DISTANCE_METERS = 50000   // verifyPlace.js
```

### TripContext (`src/context/TripContext.jsx`)

Stores `resolvedItinerary` as `{ packed: {...}, slow: {...} }` — the raw API response. Key state and methods:

- `tripParams` / `setTripParams` — form values from TripInput
- `resolvedItinerary` — both variants, set by `generateItinerary` or `loadSavedItinerary`
- `selectedVariant` / `setSelectedVariant` — `'packed'` or `'slow'`
- `status` — `'idle' | 'loading' | 'success' | 'error'`
- `generateItinerary(params)` — POSTs to `/api/generate-resolved-itinerary`, sets state
- `loadSavedItinerary(data)` — sets the same success state synchronously from bundled data
- `reorderDayItem(variantKey, dayIndex, itemIndex, direction)` — swaps adjacent items, clears stale travelToNext, fires background recompute
- `swapDayItem(variantKey, dayIndex, itemIndex, replacement)` — replaces one item, clears travelToNext for swapped item and the one before it, fires background recompute
- `isDayRecomputing(variantKey, dayIndex)` — returns true while a background recompute is in flight for that day
- `resetTrip()` — wipes everything back to initial state (used by "Delete itinerary")
- `pendingRecomputes` — Set keyed by `"variantKey:dayIndex"`, tracks in-flight recomputes
- `recomputeRequestIds` — useRef map; monotonically increasing ID per day guards against stale responses overwriting newer data

---

## Full build history

### Phase 1 — Scaffold to functional app

**Trip input → generation**
- Interests selected on TripInput now influence itinerary generation. Wired through `TripInput.jsx` → `generate-resolved-itinerary.js` → `generateRawItinerary.js`, which adds an interests line to the Claude prompt.
- "Landmarks" added as the first interest chip.

**Critical bug: truncated itineraries on longer trips**
- `generateRawItinerary.js` had `max_tokens: 4096`, too low for a 5-day two-variant itinerary. Claude's JSON was getting cut off mid-object, causing silent failures for 4+ day trips. Fixed by raising to `8192`. A 6-7 day spot-check is still technically pending but no failures have been reported in practice.

**Accommodation screen**
- Hotel search restructured to bucket by price across tiers in one combined request instead of per-tier requests (`hotelSearch.js`, `accommodation-options.js`, `Accommodation.jsx`).
- Empty-tier UX: if a budget tier has fewer than `MIN_PRICED_BEFORE_WIDENING = 6` priced hotels, the search widens automatically before hiding that tier.
- Default tier on load is the first one with results, not a hardcoded "Standard".
- Hotel cards rebuilt to match Figma exactly (nodes 66:1915 / 66:1916).

**Loading states**
- Both Generating and Accommodation use `Checklist.jsx` (checklist-style progress with a spinning active-step indicator). Copy describes real pipeline steps, not invented ones.

**Layout / design-system**
- Global footer (`Footer.jsx`) added across all screens. Copyright: "© Roam. All rights reserved."
- Sticky-footer flex layout (`.app-page` / `.screen`) so footer sits at the bottom of short pages without `position: fixed`.
- `--surface-subtle` (`#F8FAFC`) background applied to every screen via the base `.screen` rule.
- Calendar: selected-date hover uses `--interactive-primary-hover`; in-range highlight changed to circular `--color-teal-100` fill.
- Trending-places card on Home rebuilt with correct border/padding (Figma node 297:30059).
- Sparkle, pin, and chevron icons on Home replaced with exact Figma SVGs.

**Home / saved trips**
- Saved-trip cards on Home are clickable and route correctly with breadcrumbs.
- "5 days in Tokyo" loads a real pre-captured itinerary from `src/data/savedTrips/tokyo.js` (`TOKYO_5_DAYS`, ~100KB, both variants, all 5 days, real Places data). Captured once via `curl` against a live `vercel dev` instance.
- `TripContext.jsx` gained `loadSavedItinerary(data)`.
- "3 days in Ksamil" was removed later (see Phase 2) — it had no pre-captured data so opening it silently triggered live regeneration, contradicting the "never a new one" requirement.

---

### Phase 2 — Polish and pre-launch fixes

**Map screen (`/map`) — was completely broken, fixed**
Three stacked issues diagnosed via the browser Network tab and server logs:
1. Maps Static API wasn't enabled on the Google Cloud project — it's a separate API from Places/Routes, needs independent enablement.
2. Billing wasn't attached to the Cloud project.
3. `.env`'s `GOOGLE_PLACES_API_KEY` was stale — didn't match the key in the Cloud Console (a new key had been generated and never synced to `.env`). This was the real fix; the first two were red herrings.

`api/static-map.js` improved to forward Google's actual error text + status code in its JSON response and log server-side, instead of a bare generic 502.

Interactive pan/zoom was deliberately not built — would require exposing a client-side Google Maps JS key or switching to Leaflet/OSM. Kept as a static image.

**Home screen**
- "Plan a trip" sparkle icon and saved-trip pin icon recolored to `var(--text-disabled)` (`#94A3B8`).
- Bottom "Menu" section renamed to "More", trimmed from 4 items to 3 (Settings / Help / About). "Map view" is no longer in this menu — where it should live is still undecided (see Known Issues).
- Saved trips capped at 1 (`MAX_SAVED_TRIPS = 1`). Ksamil demo removed. Only the Tokyo demo remains plus whichever single trip the user most recently saved.
- `getSavedTrips()` slices to the cap on read, not just on write, so stale localStorage entries disappear immediately.

**Comparison screen — "Delete itinerary" flow**
- `TripContext.jsx` gained `resetTrip()`.
- New `src/components/ConfirmDialog.jsx` — token-styled confirm/cancel modal (no native `window.confirm`). Correct Figma spec (node 427:32757, "DeleteCard"): white PlaceCard-style container, teal title, gray description, two equal-width pill buttons — ghost Cancel + outline Delete, no red anywhere.
- "Delete itinerary" (plain red-text link, `--diff-removed-fg`) sits below "Explore this itinerary"; opens dialog, confirms, then `resetTrip()` + navigate home.

**Finalise & Save — interest chips layout (multiple rounds)**
1. `.chip` was missing `white-space: nowrap` / `flex-shrink: 0` — long labels were wrapping internally and distorting chip size.
2. A wrong-turn: misread Figma's `py-px` Tailwind class as literal 1px padding and built a separate `.category-chip` class. Always check `get_metadata` for actual frame dimensions — the real component is 36px tall, identical to `.chip`. Reverted.
3. Remaining "text sitting at the top" symptom: `.chip` never had explicit `display: inline-flex; align-items: center; justify-content: center`. A `<button>` gets free vertical-centering from the UA stylesheet; a plain `<span>` doesn't. Fixed by making centering explicit.
4. The "one long chip alone, two short chips together" wrapping pattern is not a bug — it's inherent to `flex-wrap` with variable-length labels. No fix needed or made.
5. Added `flex: 0 0 auto; width: fit-content` as defensive hardening.
6. Finalise's chips render unselected/default style — deliberate deviation from Figma's dark-fill node.

**Other Finalise & Save fixes**
- `MapPinIcon` replaced with the same pin+circle asset used in `Home.jsx`.
- Empty/unselected star replaced with the exact literal SVG the user supplied (`#94A3B8` → `var(--text-disabled)`).
- `.hotel-card__selected-note` checkmark: `align-items: center` → `flex-start` + `flex-shrink: 0` + 2px top nudge. Was floating in the vertical middle of wrapped two-line text.
- Price range formatting: amounts ≥ 1000 now use `Intl.NumberFormat` compact notation (`800k – 6m`). EUR/USD untouched.
- "Book now" buttons: `disabled` attribute removed — they render as normal outline pills per Figma node 273:16717, functionally still no-ops.
- `.pill-button` base class gained `white-space: nowrap` / `flex-shrink: 0` — a long sibling title in a `justify-content: space-between` row was squeezing the button narrower than its label.
- `text-decoration: none` added to `.pill-button` base — the one `<a className="...">` in the codebase (Add to Google Calendar) was picking up the browser's default underline.
- Rating note textarea: background changed to `var(--surface-default)` (`#FFFFFF`).

**Button hover/pressed/focus states audit — complete**
Audited every `cursor: pointer` selector in `components.css` against three Figma specs (Large 52px / Medium 44px / Small 36px × Primary/Secondary/Ghost × Default/Hover/Pressed/Disabled/Focus). 12 gaps found and fixed:

`.trending-card--button`, `.carousel-arrow`, `.carousel-dot`, `.list-row` / `.list-row--button`, `.stepper-button`, `.chip` (plain/unselected), `.segmented__option`, `.hotel-card`, `.pace-tab`, `.finalise-star-button`

`.tab` was dead/unused CSS — intentionally left alone. Every touched selector uses `var(--duration-fast) var(--easing-standard)` transitions.

---

### Phase 3 — Post-launch bug fixes

**Bug: Swap places button navigated to a blank page**
`ComparisonView.jsx`'s "Swap places" button called `handleExplore`, which navigated to `/detail` — a route that doesn't exist. Fixed by navigating to `/swap_place` with `{ state: { variant: variantKey } }`.

**Bug: Pre-dinner gap showing as idle time / single activity stretched implausibly**
`stretchPreDinnerGap` was absorbing the entire pre-dinner gap into one activity with no cap, producing e.g. a 300-minute museum visit. Rewrote it to distribute the gap backwards across all post-lunch activities, each capped at 150 min. Works backwards from the last pre-dinner activity: if it can't absorb the full gap, the remainder spills to the one before it. Dinner's `startTime` is written directly afterwards (bypassing the drift-tolerance guard) so the schedule stays consistent.

**Bug: Days where AI omits dinner entirely**
Claude occasionally generates a day with no dinner item. Added `ensureDinner(day, destination)`: if no dinner item exists, injects a placeholder at 19:30 with a generic "find a local restaurant" description. Runs after `enforceMealConstraints` and before `applyAccommodationBookends`.

**Feature: Geographic routing logic + 60-minute travel time hard cap**

Prompt-side (`generateRawItinerary.js`) — CRITICAL ROUTING RULE added to both variant prompts:
> All stops every day must be within the destination city or its immediate urban area — no day trips to towns or attractions in other cities, even if they are famous. Group stops by neighbourhood or district so the traveller moves in one direction across the city rather than darting back and forth. Morning stops should cluster together, afternoon stops should cluster together near the lunch spot, and dinner should be near the last afternoon activity or en route back to the hotel. Travel time between any two consecutive stops must never exceed 60 minutes by any mode of transport — if a place would take longer than 60 minutes to reach from the previous stop, do not include it; choose something closer instead.

Server-side (`generate-resolved-itinerary.js`):
- `MAX_SAME_DAY_TRAVEL_MINUTES` reduced from 120 to 60.
- `enforceDriveCap` mode restriction removed — now catches walk legs too.
- `enforceDriveCap` gained a category fallback search: if no same-named nearby replacement exists, searches by `next.type` alone near the current stop's location.

**Bug: Pending recompute loading state missing after swap/reorder**
After a swap or reorder, travel times were being refetched silently. Fixed in two parts:
1. `TripContext.jsx` gained `pendingRecomputes` (a Set keyed by `"variantKey:dayIndex"`) and `recomputeRequestIds` (a useRef map). `isDayRecomputing(variantKey, dayIndex)` lets screens show a real loading state. Monotonically increasing request ID per day guards against stale responses overwriting newer data.
2. `fillMissingTravelTimes` in `scheduleRealign.js` parallelised from a sequential `for` loop to `Promise.all` — each gap's estimate is independent.

**Bug: Jumbled itinerary — time goes backwards, duplicate breakfasts, no lunch**
Claude occasionally returns a day's `items` array in non-chronological order. Every downstream step assumes items are in time order, so an out-of-order array cascades into a broken schedule.

Investigation note: this was initially suspected to be cross-variant data contamination. After reading every file in the pipeline, there is no cross-variant contamination in the code — both `resolveItinerary` calls are fully independent (separate `JSON.parse` outputs, separate local `allItems` arrays, separate `usedPlaceIds` Sets, no module-level shared mutable state anywhere). If this is ever reported again, look at the raw Claude response first before assuming a code bug.

Fix: sort-by-`startTime` added at the very top of `resolveItinerary`, before anything else runs:

```js
itinerary.days.forEach((day) => {
  day.items.sort((a, b) => {
    const aMin = timeToMinutes(a.startTime);
    const bMin = timeToMinutes(b.startTime);
    if (aMin == null && bMin == null) return 0;
    if (aMin == null) return 1;
    if (bMin == null) return -1;
    return aMin - bMin;
  });
});
```

**Bug: Phantom gap before lunch — schedule shows impossible times**
`stretchPreDinnerGap` was collecting all non-meal activities before dinner, including morning ones. If a morning activity was extended past lunchtime, `realignScheduleTimes` would push lunch's candidate time forward — but if the drift exceeded `MEAL_DRIFT_TOLERANCE_MINUTES = 60`, the guard snapped lunch back to its original time. Result: the card showed the traveller at lunch before they had physically left the morning stop (e.g. 3-hour ski session ends at 13:34, 29-minute drive = 14:03, but lunch locked at 13:00).

Fix: `stretchPreDinnerGap` now only collects activities that fall after lunch:

```js
const lunchIndex = day.items.findIndex((item) => item.mealType === 'lunch');
const afternoonStart = lunchIndex >= 0 ? lunchIndex + 1 : 0;
```

---

## File map (files that matter most)

| File | Role |
|---|---|
| `api/generate-resolved-itinerary.js` | Main server handler — entire resolution pipeline lives here |
| `api/_lib/generateRawItinerary.js` | Claude Haiku calls; both variant prompts; meal validation; pacing computation |
| `api/_lib/verifyPlace.js` | Google Places lookup, name similarity scoring, `findNearbyCandidates`, `geocodeDestination`, `haversineMeters` |
| `api/_lib/scheduleRealign.js` | `realignScheduleTimes`, `fillMissingTravelTimes`, `parseTravelMinutes`, `addMinutesToTime`, `timeToMinutes` |
| `api/_lib/travelTime.js` | `computeTravelTimes`, `travelBetween` — Google Routes API calls |
| `api/_lib/estimateTravelDuration.js` | Claude Sonnet fallback travel time estimate when routing returns null |
| `api/_lib/refreshDescriptions.js` | Batched Claude Sonnet audit of item descriptions and meal tags |
| `api/_lib/hotelSearch.js`, `api/_lib/hotelPricing.js` | Accommodation tier bucketing, price estimation |
| `api/_lib/swapSuggestions.js` | Alternatives for the Swap screen |
| `api/recompute-day-travel-times.js` | Background recompute after swap/reorder |
| `src/context/TripContext.jsx` | All trip state; `reorderDayItem`, `swapDayItem`, `isDayRecomputing`, `resetTrip` |
| `src/screens/ComparisonView.jsx` | Packed/Slow tab view, "Swap places" nav, "Delete itinerary" |
| `src/screens/Accommodation.jsx` | Hotel tier picker |
| `src/screens/Home.jsx` | Saved trips, trending, Tokyo pre-captured itinerary |
| `src/data/savedTrips/tokyo.js` | `TOKYO_5_DAYS` — real pre-captured itinerary, ~100KB |
| `src/styles/tokens.css` | All design tokens |
| `src/styles/components.css` | All component styles |
| `src/components/ConfirmDialog.jsx` | Reusable confirm/cancel modal |
| `src/components/Checklist.jsx` | Shared checklist-style loading state |
| `src/components/Footer.jsx` | Global footer |
| `src/utils/savedTrips.js` | `MAX_SAVED_TRIPS = 1`; `getSavedTrips()` slices on read |

---

## Conventions and lessons learned

**Figma**
- Always fetch the actual cited node (`get_design_context` / `get_metadata` / `get_screenshot`) rather than pattern-matching from memory or a similar-looking node. Two separate mistakes (category-chip height, delete-modal red-button assumption) came from skipping this.
- Don't trust hand-parsed Tailwind class names for sizing — check `get_metadata` for real frame dimensions.

**CSS**
- `align-items: center` + text that can wrap = a floating icon. This showed up twice (Finalise heart icon, hotel-card checkmark). `flex-start` is almost always correct for icon+text rows where text isn't guaranteed single-line.
- When a bug is reported multiple times and a fix "should" have worked, stop guessing from screenshots and ask for browser DevTools Computed styles panel output — that's what actually closed out the chip layout saga.

**Routing and SVGs**
- When the user supplies a literal SVG, paste it verbatim. Convert hardcoded hex to a matching CSS token where one exists exactly; otherwise leave it. When Figma serves flattened image assets instead of vector paths, hand-approximate and say so in a code comment.

**Server / pipeline**
- `stretchPreDinnerGap` must only touch post-lunch activities. Extending morning activities past lunchtime creates an impossible schedule that `MEAL_DRIFT_TOLERANCE_MINUTES` then permanently locks in. Do not revert this restriction.
- `MEAL_DRIFT_TOLERANCE_MINUTES = 60` is deliberately wide. It becomes a problem only when an activity's duration is artificially extended past a meal's window — fix whatever is causing that, not the tolerance value.
- Cross-variant contamination is not possible in the current architecture. If a jumbled itinerary is ever reported again, look at the raw Claude response for ordering issues before assuming a code bug.
- Both `resolveItinerary` calls run in parallel via `Promise.all` and are fully independent. `usedPlaceIds` is a local Set per call, not shared.

**Dev environment**
- `vercel dev` auto-increments its port — always check the actual "Local:" line, don't assume 3000.
- `.env` changes need a full `vercel dev` restart, not just a browser refresh.
- `curl -s` suppresses both progress and error output — drop `-s` or add `-v` if a request silently produces nothing.
- File deletion from the device bridge fails with "Operation not permitted" — workaround is overwriting with a deprecation-stub comment, or the user deletes directly in Finder/terminal.
- Sandbox network restrictions mean live API calls (Anthropic, Google Places/Routes) can't be made from the assistant side — any real data capture must run through the user's local `vercel dev`.
- **Git push must be done from the user's terminal**, not the device bridge shell. `git push` via the mounted path fails with a proxy error. The flow is: Claude writes files via `device_commit_files`, user runs `git add / git commit / git push` in their terminal. Lock file errors (`HEAD.lock`) are fixed with `rm -f .git/HEAD.lock` before re-running.

**Google Maps Platform**
- Places API and Maps Static API are separate APIs requiring separate enablement even under the same Cloud project/key.
- If a "key not authorized" error persists after enabling the API and attaching billing, check whether the key in `.env` actually matches the current key in the Cloud Console — keys can get regenerated without `.env` being updated.

---

## Known issues, still unresolved

- `--radius-md` referenced in `DetailView.jsx`'s `.place-card__photo` doesn't exist as a token.
- `DetailView`/breadcrumb flow deviates from Figma's persistent 5-tab nav — flagged early, never revisited.
- 6-7 day trip `max_tokens` headroom spot-check still pending — no production failures reported, but worth verifying.
- Pricing integration test against 2-3 real destinations still pending.
- "Map view" navigation — removed from Home's "More" menu, no new home decided yet.

## Suggested next steps

1. Decide on "Map view" navigation.
2. Spot-check a 6-7 day trip generation end-to-end.
3. Run pricing integration test against 2-3 real destinations.
4. Resolve the `--radius-md` token gap in `DetailView.jsx`.
5. Revisit `DetailView`/breadcrumb vs. persistent 5-tab nav if the app gets a navigation rework.
