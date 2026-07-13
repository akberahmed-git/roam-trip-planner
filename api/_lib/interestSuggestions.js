// Generates interest chips for Trip Input, tailored to the specific
// destination, rather than checking a fixed universal list for
// availability. Replaces the old interestAvailability.js approach - that
// model assumed a near-universal base set existed and only needed to hide
// the occasional bad fit (e.g. "Nightlife" for a quiet rural town). It broke
// down for categories that aren't just occasionally unavailable but
// genuinely inappropriate for a whole class of destination - "Bars" has no
// sensible version in much of the Muslim world, for example.
//
// Three staples (STAPLE_INTERESTS below) are pinned and shown for every
// destination, in the same order, every time - they're the only categories
// universal enough not to need per-destination judgment at all. Everything
// else is generated fresh per destination, so most of the row is genuinely
// tailored to the place rather than a generic tag that happened to survive
// a filter.
//
// This is still a soft enhancement, not a gate: TripInput.jsx shows
// STAPLE_INTERESTS immediately (before any destination is typed) and
// reverts to it if this call is slow, errors, or returns something
// unusable, so a generation hiccup never leaves the Interests field empty.
//
// Deliberately no larger "fallback list" beyond the three staples: a fixed
// list of extra categories (Nightlife, etc.) can't be trusted to be
// appropriate for a destination we failed to actually classify - that's the
// exact failure mode this whole per-destination approach exists to avoid.
// So the only thing ever shown without generation having succeeded is the
// three categories that are safe unconditionally.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Always shown first, in this order, for every destination - the only
// categories universal enough that they never need a per-destination call.
// Also the fallback when generation is pending, fails, or returns something
// unusable - see the module comment above for why there's no larger fallback
// list. Mirrors TripInput.jsx's STAPLE_INTERESTS exactly - keep in sync.
export const STAPLE_INTERESTS = ['Landmarks', 'Cuisine', 'Shopping'];

const STAPLE_KEYS = new Set(STAPLE_INTERESTS.map((tag) => tag.toLowerCase()));

// Persisted to a JSON file on disk, not an in-memory Map (changed 9 Jul
// 2026) - the first version cached in a module-level Map, which relies on
// vercel dev keeping the same warm Node process between requests. Confirmed
// with Akber that it wasn't actually working: retyping the same destination
// was still generating a fresh set of chips every time, meaning either the
// function's module was being re-required per request (resetting the Map to
// empty) and/or genuine Claude sampling variance was showing through because
// no cache hit was ever actually landing. A file on disk survives either
// way, since it lives outside whatever gets reloaded. Read fresh (not kept
// as a module-level variable) on every call for the same reason - this
// function's own module identity can't be trusted to persist.
const CACHE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(CACHE_DIR, '.interest-suggestions-cache.json');
const MAX_CACHE_ENTRIES = 200;

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    // Missing file (first run ever) or corrupt JSON - either way, starting
    // fresh is no worse than an empty cache always is.
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch (error) {
    // Non-fatal - this request's own result is still returned correctly
    // below, it just won't be there on disk to speed up the next one.
    console.error('[interestSuggestions] failed to persist cache:', error.message);
  }
}

export async function getInterestSuggestions(destination) {
  const cacheKey = destination.trim().toLowerCase();
  const cache = loadCache();
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const prompt = `You are choosing interest categories for a trip-planning app's interest picker, for a specific destination.

Destination: ${destination}

Three staple categories are already shown for every destination, including this one, so don't include them or close synonyms of them: ${STAPLE_INTERESTS.join(', ')}.

Generate exactly 7 additional interest categories that are specifically well-suited to THIS destination. Follow these rules:

1. Every category must be genuinely relevant and culturally appropriate for this destination - not hypothetically possible somewhere nearby, and not something that would be a poor or awkward fit here (for example, don't suggest bar- or alcohol-centred categories for a destination where that's not part of the culture).
2. Favor categories that are specifically suited to this destination over generic ones (e.g. "Temples" for Kyoto, "Souks" for Marrakech, "Fjords" for Bergen, "Street food" for Bangkok) - the staples above already cover the broadly recognizable ground, so use these 7 slots to say something real and specific about this place.
3. Avoid generic filler or near-duplicates - each category should represent a distinct, real way to spend time here.
4. Each category should be 1-3 words, in the same short, scannable style as: Landmarks, Cuisine, Shopping, Museums, Markets, Nature, Architecture.
5. Do not include duplicates, and do not repeat the staple categories listed above.

Respond with ONLY valid JSON, no markdown formatting, no code fences, no commentary. Use this exact structure:

{
  "interests": ["Temples", "Street food", "Markets", "Nature", "Architecture", "Tea houses", "Gardens"]
}`;

  // Haiku, not Sonnet (changed 9 Jul 2026, addressing Akber's "still takes
  // some time" follow-up after the debounce-skip and caching fixes) -
  // picking 7 short, destination-appropriate category labels doesn't need
  // Sonnet-level reasoning, and Haiku's latency is meaningfully lower,
  // which matters here specifically because this call sits directly in the
  // middle of a first-time-destination interaction, with no cache or
  // debounce-skip able to help. The debounce-skip and cache fixes covered
  // "waiting on something that isn't needed anymore" - this is the one
  // remaining lever for "waiting on the actual generation call" itself.
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  let rawText = message.content[0].text.trim();
  if (rawText.startsWith('```')) {
    rawText = rawText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (parseError) {
    const err = new Error('Claude did not return valid JSON for interest suggestions');
    err.rawText = rawText;
    throw err;
  }

  // Defensive on shape (array of non-empty strings), on duplicates, on
  // accidentally re-suggesting a staple, and on a sane count - none of this
  // is guaranteed just because the prompt asked for it.
  const seen = new Set();
  let dynamic = (Array.isArray(parsed.interests) ? parsed.interests : [])
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => entry.trim())
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (STAPLE_KEYS.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 7);

  // A genuinely empty response just means the row is the three staples
  // alone - not ideal, but safer than guessing at generic extra categories
  // for a destination the model couldn't usefully classify. Cached like any
  // other result - a second request for the same destination should get the
  // same answer instantly, not pay for an identical generation call again.
  const result = { interests: [...STAPLE_INTERESTS, ...dynamic] };

  cache[cacheKey] = result;
  // Plain object keys preserve insertion order for string keys in JS, same
  // guarantee the old Map version relied on - oldest entry evicted first
  // once over the cap, so a long-running dev server doesn't grow this file
  // unbounded.
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    delete cache[keys[0]];
  }
  saveCache(cache);

  return result;
}
