// Reads the opening hours Google returns as human sentences, because that is the
// only form the Places API offers them in: regularOpeningHours.weekdayDescriptions
// is an array of seven strings like "Monday: 9:00 AM – 6:00 PM".
//
// Until now nothing in the app read them, and not because the code was missing:
// the field is Enterprise-tier and had been cut from the field mask to save
// money, so hasHours came back false for every place ever verified. The app had
// no idea when anything opened or closed, which is how the Tokyo demo sent a
// traveller to the Metropolitan Government Building at 22:15, two hours after its
// observation decks shut (Akber, 7 Sep 2026).

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Google uses an en dash, but a hyphen and an ordinary dash both turn up in the
// wild and cost nothing to accept.
const RANGE_SPLIT = /\s*[–—-]\s*/;

// "9:00 AM", "9 AM", "12:30 PM", and the 24-hour forms some locales return.
function parseClock(text, inheritedMeridiem) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = (match[3] || inheritedMeridiem || '').toLowerCase();

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 && !meridiem) return null;

  return hours * 60 + minutes;
}

// One day's ranges, in minutes from midnight. A range that ends before it starts
// runs past midnight and is returned with an end beyond 1440, so a bar open
// "6:00 PM – 2:00 AM" is open at 00:30 the following morning.
export function parseDayRanges(description) {
  if (!description) return null;

  const body = description.slice(description.indexOf(':') + 1).trim();
  if (/closed/i.test(body)) return [];
  if (/24\s*hours|open 24/i.test(body)) return [[0, 24 * 60]];

  const ranges: number[][] = [];
  for (const part of body.split(',')) {
    const [rawFrom, rawTo] = part.split(RANGE_SPLIT);
    if (!rawFrom || !rawTo) continue;

    // "11:00 – 2:00 PM" leaves the opening time without a meridiem of its own,
    // so it borrows the closing one.
    const trailingMeridiem = (/\b(am|pm)\b/i.exec(rawTo) || [])[1];
    const from = parseClock(rawFrom, trailingMeridiem);
    const to = parseClock(rawTo, null);
    if (from == null || to == null) continue;

    ranges.push([from, to <= from ? to + 24 * 60 : to]);
  }
  return ranges.length > 0 ? ranges : null;
}

// The description for a given weekday, matched by name rather than by position:
// the array is documented as starting on Monday, and relying on that silently
// shifts every check by a day if it ever does not.
function descriptionFor(weekdayDescriptions, weekdayIndex) {
  const name = DAY_NAMES[weekdayIndex];
  return (weekdayDescriptions || []).find((line) =>
    String(line).toLowerCase().startsWith(name)
  ) || null;
}

// Unknown hours are treated as open. This decides whether to DROP a stop, and
// throwing away a real place because Google had nothing to say about it would be
// worse than the occasional closed door.
export function isOpenAt(weekdayDescriptions, weekdayIndex, minutes) {
  const ranges = parseDayRanges(descriptionFor(weekdayDescriptions, weekdayIndex));
  if (ranges == null) return true;
  if (ranges.length === 0) return false;

  return ranges.some(([from, to]) =>
    (minutes >= from && minutes < to) ||
    // A stop scheduled after midnight belongs to the previous day's late range.
    (minutes + 24 * 60 >= from && minutes + 24 * 60 < to)
  );
}

// Which weekday a given day of the trip falls on. Returns null rather than
// guessing when there is no check-in date to count from.
export function weekdayForDay(checkInDate, dayNumber) {
  if (!checkInDate) return null;
  const start = new Date(`${checkInDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  start.setUTCDate(start.getUTCDate() + Math.max(0, (dayNumber || 1) - 1));
  return start.getUTCDay();
}
