# Roam Trip Planner — Session Handoff

Covers the extended build session that took Roam from a placeholder-screen scaffold to a design-accurate, functionally-wired app. Written for whoever (human or Claude) picks this up next.

## Stack recap

React 19 + Vite + react-router-dom 7, Vercel serverless functions under `/api`, run locally via `npx vercel dev` (not `npm run dev` — the API routes only work through Vercel's dev server). Figma file key `Z6y8zocU1df1OAwxwEJT6n`. Design tokens live in `src/styles/tokens.css`.

## What shipped this session

**Trip input → generation**
- Interests selected on Trip Input now actually influence itinerary generation (previously collected but unused). Wired through `TripInput.jsx` → `generate-resolved-itinerary.js` / `generate-itinerary.js` → `generateRawItinerary.js`, which adds an interests line to the Claude prompt.
- "Landmarks" added as the first interest chip.

**Critical bug fix — truncated itineraries on longer trips**
- `api/_lib/generateRawItinerary.js` had `max_tokens: 4096`, which was too low for a 5-day, two-variant (packed + slow) itinerary. Claude's JSON response was getting cut off mid-object, causing `"Claude did not return valid JSON"` errors. This was silent for shorter trips (3 days fit under the limit) but would have broken any 4+ day trip in production. Fixed by raising `max_tokens` to `8192`. Worth spot-checking a 6-7 day trip too, in case that pushes past the new ceiling.

**Accommodation**
- Hotel search restructured to bucket by price across tiers in one combined request instead of per-tier requests (`hotelSearch.js`, `accommodation-options.js`, `Accommodation.jsx`).
- Empty-tier UX decided and implemented: if a budget tier comes back with too few priced hotels (`MIN_PRICED_BEFORE_WIDENING = 6`), the search widens automatically (`places to stay in <destination>` query) before falling back to hiding that tier entirely from the segmented control. Default tier on load is the first one with results, not a hardcoded "Standard".
- Hotel cards rebuilt to match Figma exactly (nodes 66:1915 / 66:1916): padding moved to the card level (17px / 18px selected), independent border-radius on the photo, proper border visibility on all sides.

**Loading states**
- Both Generating and Accommodation now use a shared `Checklist.jsx` component (checklist-style progress with a spinning active-step indicator) instead of a plain spinner. Copy is backend-accurate — describes real pipeline steps (Places search, pricing confirmation, tier sorting, etc.), not invented ones.

**Layout / design-system fixes**
- Global footer added (`Footer.jsx`) and rolled out across all screens, matching a Figma update mid-session. Copyright text: "© Roam. All rights reserved."
- Sticky-footer flex layout added (`.app-page` / `.screen` flex pattern) so the footer sits at the bottom of short pages without being `position: fixed`.
- Footer and the checklist-loading content were initially full-bleed; both fixed to mirror the standard `.screen > .container` content-width box model (32px screen padding, 760px max-width, centered).
- Global `--surface-subtle` (`#F8FAFC`) background applied to every screen via the base `.screen` rule, not just Generating.
- Calendar: selected-date hover now uses `--interactive-primary-hover` (`#0A6E83`) instead of gray (had to match specificity of the existing `:hover:not(:disabled)` rule to win the cascade). In-range highlight changed from a gray square to a circular `--color-teal-100` (`#D0F4F9`) fill.
- Trending-places card on Home rebuilt with the same border/padding fix as the hotel cards (Figma node 297:30059).
- Sparkle, pin, and chevron icons on Home replaced with exact Figma SVGs; chevrons ultimately unified to reuse the existing carousel `ChevronIcon` component rather than a one-off custom icon, per final direction.

**Home / saved trips**
- Saved-trip cards on Home are now clickable and route correctly, with breadcrumbs leading back to Home.
- "5 days in Tokyo" now loads a **real, pre-captured itinerary** instead of regenerating live on every click. This was captured by running the actual pipeline once (`curl` against a live `vercel dev` instance — see troubleshooting below) and is stored in `src/data/savedTrips/tokyo.js` (`TOKYO_5_DAYS`, ~100KB, both packed and slow variants, all 5 days, real Places data — ratings, addresses, hours, coordinates, travel times).
- `TripContext.jsx` gained `loadSavedItinerary(data)`, which sets the same success state a live generation would, just synchronously from bundled data.
- "3 days in Ksamil" still uses the fresh-regeneration path — no saved data was requested for it. Worth flagging to Akber as an intentional asymmetry, not a bug, unless he wants it saved too.

## Files most touched this session

- `api/_lib/generateRawItinerary.js` — interests support, max_tokens fix
- `api/_lib/hotelSearch.js`, `api/_lib/hotelPricing.js` — tier bucketing, widen-search logic
- `api/generate-resolved-itinerary.js`, `api/generate-itinerary.js` — interests pass-through
- `src/screens/Generating.jsx`, `src/screens/Accommodation.jsx` — checklist loading states
- `src/screens/Home.jsx` — icons, saved-trip click-through, Tokyo saved-itinerary wiring
- `src/screens/TripInput.jsx` — interests UI, shared date util
- `src/components/Footer.jsx`, `src/components/Checklist.jsx` — new components
- `src/components/DateRangePicker.jsx` — in-range styling
- `src/context/TripContext.jsx` — `loadSavedItinerary`
- `src/data/savedTrips/tokyo.js` — real captured itinerary data
- `src/utils/date.js` — shared `toLocalISODate` (fixes a UTC-shift bug from `toISOString()`)
- `src/index.css`, `src/styles/components.css` — sticky footer, surface background, card fixes

## Known issues, flagged but not fixed

- `--radius-md` is referenced in `DetailView.jsx`'s `.place-card__photo` but doesn't exist as a token. Latent bug, low priority.
- `DetailView`/breadcrumb flow deviates from Figma's persistent 5-tab nav — flagged early in the engagement, still an open decision, not revisited.
- Task "Test pricing integration against 2-3 real destinations" is still pending — worth doing now that the max_tokens fix is in, since longer trips previously would have silently failed pricing/JSON parsing.
- Ksamil's saved-trip card uses live regeneration, Tokyo's doesn't (see above).

## Dev environment notes (useful if this stalls out again)

- `vercel dev` auto-increments its port if 3000/3001 are already taken by something else — always check the actual "Local:" line it prints rather than assuming 3000. This session lost significant time to that exact mismatch.
- `curl -s` suppresses **both** progress and error output — if a request silently produces nothing, drop `-s` or add `-v` to see what's actually happening (connection refused vs. real failure).
- The connected `~/Desktop/roam-trip-planner` folder has a FUSE restriction: file **deletion** from this side (the assistant) reliably fails with "Operation not permitted." Deleting stray files (e.g. `tokyo-raw.json`, an old `LoadingState.jsx`) has to be done by Akber directly in Finder or his own terminal.
- Sandbox network restrictions mean live calls to Anthropic/Google Places/Google Routes/Xotelo can't be made from this side — any "real" data capture has to run through Akber's local `vercel dev` and get pulled in as a file afterward.

## Suggested next steps

1. Spot-check the max_tokens fix against a 6-7 day trip to confirm 8192 has enough headroom.
2. Run the still-pending pricing integration test against 2-3 real destinations.
3. Decide whether Ksamil should also get a saved itinerary, for consistency.
4. Revisit the `DetailView`/breadcrumb-vs-persistent-nav deviation from Figma if it hasn't been resolved elsewhere.
