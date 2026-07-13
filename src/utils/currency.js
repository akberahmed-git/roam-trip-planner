// Currency conversion for the Accommodation price-range selector. Google
// Places' `priceRange` (see api/_lib/hotelSearch.js) comes back in the
// destination's own local currency - this converts that into whichever
// currency the user picks from the dropdown.
//
// Picked frankfurter.dev deliberately after the Xotelo/RapidAPI quota
// exhaustion incident: free, no signup, no API key, ECB-backed daily rates,
// no published request limit that a low-traffic portfolio demo would ever
// hit. Exactly the "don't repeat that mistake" choice.
const RATES_BASE_URL = 'https://api.frankfurter.dev/v1/latest'

// The fixed list shown in the dropdown - matches the Figma reference
// (node 345:31118) exactly. A destination whose local currency isn't one of
// these gets added as an extra option (see currencyOptionsFor) so the user
// can still see the untouched local range.
export const MAJOR_CURRENCIES = ['GBP', 'CNY', 'EUR', 'JPY', 'USD']

const CURRENCY_NAMES = {
  GBP: 'British Pound Sterling',
  CNY: 'Chinese Yuan',
  EUR: 'Euro',
  JPY: 'Japanese Yen',
  USD: 'US Dollar',
}

export function currencyDisplayName(code) {
  if (!code) return ''
  if (CURRENCY_NAMES[code]) return CURRENCY_NAMES[code]
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code
  } catch {
    return code
  }
}

export function currencyOptionsFor(sourceCurrency) {
  if (sourceCurrency && !MAJOR_CURRENCIES.includes(sourceCurrency)) {
    return [sourceCurrency, ...MAJOR_CURRENCIES]
  }
  return MAJOR_CURRENCIES
}

// Rates are relative to `base` (the destination's local currency) - always
// includes the base itself at 1 so callers don't need a special case.
export async function fetchExchangeRates(base, targets) {
  const symbols = targets.filter((code) => code && code !== base)
  if (symbols.length === 0) return { [base]: 1 }

  const url = `${RATES_BASE_URL}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbols.join(','))}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Exchange rate request failed with status ' + response.status)
  }
  const data = await response.json()
  return { [base]: 1, ...(data.rates || {}) }
}

export function convertAmount(amount, rate) {
  if (amount == null || rate == null) return null
  return Math.round(amount * rate)
}

export function formatMoney(amount, currencyCode) {
  if (amount == null) return ''
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode || 'EUR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currencyCode || ''} ${amount}`.trim()
  }
}

// Compact k/mil/b formatting - originally written for Accommodation's price
// range field (large local-currency face values like IDR/VND overflowing
// the field), extracted here (9 Jul 2026) so Finalise & Save's price note
// can share it instead of re-implementing it. Ordered richest-to-smallest so
// unitFor always finds the largest bracket an amount qualifies for. Returns
// the same object reference for every amount in a bracket, so callers can
// compare units with !== rather than comparing suffix strings.
// "mil" rather than bare "m" - the app also shows real minute-values
// elsewhere (travel times like "34 minute drive"), and "m" alone reads
// ambiguously as million/minutes/metres. "k" for thousand doesn't have that
// problem (near-universally read as thousand already), so it's left as-is
// rather than lengthened to match for symmetry's sake alone.
const COMPACT_UNITS = [
  { value: 1e9, suffix: 'b' },
  { value: 1e6, suffix: 'mil' },
  { value: 1e3, suffix: 'k' },
]

function unitFor(amount) {
  return COMPACT_UNITS.find((candidate) => amount >= candidate.value) || null
}

// opts.unit forces a specific compact unit rather than the amount's own
// natural one - see formatCompactRange's cross-range unit matching below.
// opts.fractionDigits is adjustable for the same function's collision
// handling. opts.currencyCode, if given, prefixes the result ("LBP 10 mil")
// - omit it for contexts (like Accommodation's own price field) where the
// currency is already stated elsewhere nearby, so it isn't shown twice.
export function formatCompactAmount(amount, { unit, fractionDigits = 1, currencyCode } = {}) {
  if (amount == null) return ''
  const resolvedUnit = unit || unitFor(amount)
  let label
  if (resolvedUnit) {
    const scaled = amount / resolvedUnit.value
    const number = new Intl.NumberFormat('en', { maximumFractionDigits: fractionDigits }).format(scaled)
    // Single-letter suffixes ("k") read fine run straight into the number
    // ("3k"); a full word like "mil" run together ("3mil") reads like a
    // typo, so it gets a space ("3 mil") and single letters don't.
    const separator = resolvedUnit.suffix.length > 1 ? ' ' : ''
    label = `${number}${separator}${resolvedUnit.suffix}`
  } else {
    label = new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(amount)
  }
  return currencyCode ? `${currencyCode} ${label}` : label
}

// opts.currencyCode, if given, prefixes both ends ("LBP 10 mil – LBP 18
// mil") - matches the existing (pre-compact) Finalise & Save format, which
// already repeated the code on both sides via formatMoney.
export function formatCompactRange(range, { currencyCode } = {}) {
  if (!range) return null
  if (range.min === range.max) return formatCompactAmount(range.min, { currencyCode })

  // If both ends already need compacting but would naturally land on
  // different units (e.g. 800,000 -> "800k" next to 1,200,000 -> "1.2mil"),
  // force them onto the larger end's unit so the range reads consistently
  // instead of mixing "k" and "mil" in the same range. A range where only
  // one end is over 1,000 is left alone - forcing the smaller, already-short
  // number into fractional-unit notation would abbreviate something that
  // never needed abbreviating in the first place.
  const minUnit = unitFor(range.min)
  const maxUnit = unitFor(range.max)
  const sharedUnit = minUnit && maxUnit && minUnit !== maxUnit ? maxUnit : undefined

  let minLabel = formatCompactAmount(range.min, { unit: sharedUnit, currencyCode })
  let maxLabel = formatCompactAmount(range.max, { unit: sharedUnit, currencyCode })

  // A narrow range can round both ends to the same compact string, which
  // looks like a duplicate or a bug rather than a real, if tight, range.
  // Retry once with an extra fraction digit; if they still collide, fall
  // back to the exact numbers for this one pair instead of showing a
  // misleading "LBP 18 mil – LBP 18 mil".
  if (minLabel === maxLabel) {
    minLabel = formatCompactAmount(range.min, { unit: sharedUnit, fractionDigits: 2, currencyCode })
    maxLabel = formatCompactAmount(range.max, { unit: sharedUnit, fractionDigits: 2, currencyCode })
  }
  if (minLabel === maxLabel) {
    const exact = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
    const prefix = currencyCode ? `${currencyCode} ` : ''
    minLabel = `${prefix}${exact.format(range.min)}`
    maxLabel = `${prefix}${exact.format(range.max)}`
  }

  return `${minLabel} – ${maxLabel}`
}

// Screen readers get the real, unabbreviated number - "18 mil" can read
// ambiguously out loud, so the visible text stays compact for
// sighted/scanning users while assistive tech announces the full amount.
export function formatExactRange(range) {
  if (!range) return ''
  const exact = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
  const amount =
    range.min === range.max
      ? exact.format(range.min)
      : `${exact.format(range.min)} to ${exact.format(range.max)}`
  return range.currencyCode ? `${amount} ${range.currencyCode}` : amount
}
