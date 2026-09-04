// Strips travel times, visit durations and transport modes out of the
// descriptions Claude writes for each stop.
//
// Why: the description is written in the same pass that invents the itinerary,
// long before any place is verified, any route is measured or any stay length
// is finalised. So it happily asserts numbers that nothing checked, and they
// then sit on screen next to the numbers that *were* checked, contradicting
// them. From one Valencia run:
//
//   "Museo de las Ciencias ... 45-minute focused tour"   scheduled block: 1h 45m
//   "Port of Valencia ... explore for 50 minutes"        scheduled block: 1h 15m
//   "Hemisfèric ... 5 minutes from lunch"                travel chip: 15 min drive
//   "Malvarrosa ... 15 minutes by metro from hotel"      Roam has no transit mode
//
// Every one of those numbers has a real, computed counterpart already rendered
// on the same card. The description is the only place an unverified version can
// appear, so it should never carry one.
//
// This is the second line of defence. generateRawItinerary.js's prompt now
// forbids these outright; a prompt rule leaks, so this enforces it. Anything
// still matching after the strip is logged rather than mangled - a fragment
// like "Spain's oldest fine arts museum with Goya." is worse than the original
// sentence, so the bar for editing is that the result still reads as English.

// Numbers attached to a time or distance unit. Deliberately excludes bare "m"
// and "h" so "17 acres", "1910s café" and "3 Michelin stars" pass untouched.
const QUANTITY = String.raw`\d+\s*[-–—]?\s*(?:minute|min|hour|hr|kilometre|kilometer|km|metre|meter|mile)s?`;

// Transport modes the app never models. Roam only ever computes walking or
// driving, so a description promising a metro ride is unverifiable by
// construction.
const TRANSPORT = String.raw`\b(?:metro|tram|subway|underground|tube|bus|taxi|uber|ferry|train)\b`;

const OFFENDING = new RegExp(`(?:${QUANTITY})|(?:${TRANSPORT})`, 'i');

// Trailing prepositional phrases, the shape these claims almost always take.
// Anchored to the end so a pattern can only ever trim a tail, never punch a
// hole in the middle of a sentence and leave a fragment behind.
const TRAILING_CLAIMS = [
  new RegExp(String.raw`[,;]?\s*(?:just\s+)?(?:in|about|around|roughly|only)?\s*a?\s*${QUANTITY}\s*(?:walk|drive|ride|stroll|tour|visit|journey)\b[^.]*\.?$`, 'i'),
  new RegExp(String.raw`[,;]?\s*(?:and\s+)?(?:explore|visit|spend|allow|stay)\w*\s+(?:for\s+)?${QUANTITY}\b[^.]*\.?$`, 'i'),
  new RegExp(String.raw`[,;]?\s*${QUANTITY}\s*(?:by|via|on)\s+\w+[^.]*\.?$`, 'i'),
  // "... , 5 minutes from lunch" / "... 10 minutes from the hotel". Bounded to
  // six following words so it cannot run away to the end of a long sentence.
  new RegExp(String.raw`[,;]?\s*(?:just\s+)?(?:about|around|roughly|only)?\s*${QUANTITY}\s+(?:from|to)\b(?:\s+[\w'’&.-]+){0,6}\s*\.?$`, 'i'),
];

function tidy(text) {
  let out = text.replace(/\s+/g, ' ').trim();
  out = out.replace(/[;,]+$/, '').trim();
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

// Trims whatever the anchored patterns can reach off the end of one clause.
// Accepts a trim only if enough of the clause survives to still read as
// English - a greedy match that eats the whole thing is worse than leaving the
// claim in and logging it.
function trimTrailingClaims(segment) {
  let text = segment;
  for (const pattern of TRAILING_CLAIMS) {
    if (!OFFENDING.test(text)) break;
    const trimmed = text.replace(pattern, '').trim();
    if (trimmed.length >= 20) {
      text = trimmed;
    }
  }
  return text;
}

export function stripUnverifiedClaims(description) {
  if (typeof description !== 'string' || !description.trim()) {
    return { text: description, changed: false, residual: false };
  }

  const original = description;
  const segments = original.split(/\s*;\s*/);
  const kept: string[] = [];

  segments.forEach((segment, index) => {
    const trimmed = trimTrailingClaims(segment);

    if (!OFFENDING.test(trimmed)) {
      if (trimmed.trim()) kept.push(trimmed);
      return;
    }

    // The first clause carries the place's identity - what it actually is.
    // Dropping it leaves the leftovers ("exterior visit and plaza exploration")
    // standing in for the description, which is worse than keeping an
    // unverified number. So it is never dropped; it is reported as residual
    // instead and the prompt rule is left to prevent it upstream.
    if (index === 0) {
      kept.push(trimmed);
      return;
    }

    // A later clause is nearly always an appended aside, so dropping it whole
    // leaves a grammatical sentence behind.
  });

  const text = tidy(kept.length > 0 ? kept.join('; ') : original);

  return {
    text,
    changed: text !== original,
    residual: OFFENDING.test(text),
  };
}

export function sanitizeDescriptions(days) {
  let changed = 0;
  const residual: string[] = [];

  for (const day of days) {
    for (const item of day.items) {
      const result = stripUnverifiedClaims(item.description);
      if (result.changed) {
        item.description = result.text;
        changed += 1;
      }
      if (result.residual) {
        residual.push(item.name);
      }
    }
  }

  return { changed, residual };
}
