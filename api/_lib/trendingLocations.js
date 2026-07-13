// Curated editorial copy for the Home screen's "Trending locations" carousel.
// This isn't itinerary data, so it doesn't go through the verify/resolve
// pipeline, but the photo for each is still a real Google Places photo (via
// the same server-side proxy pattern as everywhere else), not a stock image.
//
// searchQuery targets a specific well-known landmark within the destination
// (rather than the bare destination name) so the photo Google returns is a
// recognisable, picturesque shot instead of whatever a generic place-name
// search happens to surface first (which was sometimes an unremarkable or
// even unflattering photo of an unrelated building).
const CURATED_LOCATIONS = [
  {
    name: 'Phu Quoc, Vietnam',
    description: "Vietnam's largest island, with white sand beaches and coral reefs",
    // A specific, unambiguous named beach (matches the description's "white
    // sand beaches"). Earlier attempts used vaguer queries that collided with
    // unrelated businesses/theme-park structures. Google's own listing uses
    // the English "Sao Beach" rather than the Vietnamese "Bai Sao", which is
    // why the earlier query/match kept coming back empty.
    searchQuery: 'Sao Beach, Phu Quoc, Vietnam',
    expectedNameMatch: 'sao beach',
  },
  {
    name: 'Santorini, Greece',
    description: 'Whitewashed clifftop villages overlooking the Aegean',
    // Dropped the word "sunset" from the query: it literally matched a
    // restaurant named "Sunset" instead of the town of Oia.
    searchQuery: 'Oia, Santorini, Greece',
    expectedNameMatch: 'oia',
  },
  {
    name: 'Kyoto, Japan',
    description: 'Ancient temples, quiet gardens, and centuries of tradition',
    searchQuery: 'Fushimi Inari Taisha, Kyoto, Japan',
    expectedNameMatch: 'fushimi inari',
  },
  {
    name: 'Bali, Indonesia',
    description: 'Lush rice terraces, surf breaks, and laid-back beach towns',
    // "Tegalalang"/"Tegallalang" (both spellings are used) turned out to be
    // an area, not a single spot, Google Maps' own pin for it resolves to
    // "Uma Ceking Terrace", a specific business with a waterfall rather than
    // the classic rice-terrace vista. Switched to a singular, unambiguous
    // landmark instead.
    searchQuery: 'Tanah Lot Temple, Bali, Indonesia',
    expectedNameMatch: 'tanah lot',
  },
];

const PHOTO_WIDTH_PX = 1200;

// Vietnamese (and other) place names often keep their native diacritics in
// Google's data (e.g. "Bãi Sao" rather than "Bai Sao"), so a plain
// lowercase substring check can wrongly reject a correct match. Strip
// diacritics before comparing, same approach as verifyPlace.js.
function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

async function fetchPhoto(location) {
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.photos',
      },
      body: JSON.stringify({ textQuery: location.searchQuery }),
    });
    if (!response.ok) {
      return { photoUrl: null, matchedName: null };
    }
    const data = await response.json();
    const place = data.places?.[0];
    const photos = place?.photos;
    if (!photos || photos.length === 0) {
      return { photoUrl: null, matchedName: place?.displayName?.text || null };
    }

    // Trust Google's own default photo ordering (its first/"cover" photo is
    // generally the most representative one) rather than re-sorting by
    // resolution, which turned out to surface odd, unrepresentative shots.
    const photoUrl = '/api/place-photo?ref=' + encodeURIComponent(photos[0].name) + '&maxWidth=' + PHOTO_WIDTH_PX;
    return { photoUrl, matchedName: place.displayName?.text || null };
  } catch {
    return { photoUrl: null, matchedName: null };
  }
}

export async function getTrendingLocations() {
  return Promise.all(
    CURATED_LOCATIONS.map(async (location) => {
      const { photoUrl, matchedName } = await fetchPhoto(location);

      // Guard against a text-search collision (e.g. a business literally
      // named after a search word) silently attaching the wrong photo to a
      // curated landmark. If the matched place's name doesn't resemble what
      // we searched for, drop the photo rather than show something random.
      const nameLooksRight =
        !location.expectedNameMatch ||
        (matchedName && normalize(matchedName).includes(normalize(location.expectedNameMatch)));

      return {
        name: location.name,
        description: location.description,
        photoUrl: nameLooksRight ? photoUrl : null,
      };
    })
  );
}
