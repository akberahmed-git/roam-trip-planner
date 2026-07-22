// Curated copy + photos for the Home screen's "Trending locations" carousel.
//
// The trending destinations are a fixed, hand-picked set, so their photos are
// now bundled as static assets in /public/trending rather than fetched live
// from Google Places on every page load. Previously each visit billed a
// Places text search + a Photo fetch per destination (four of each), which
// added up even when nobody used the planner. Static files cost nothing and
// load faster. To change a photo, drop a new file in /public/trending and
// update the photoUrl below.
const CURATED_LOCATIONS = [
  {
    name: 'Phu Quoc, Vietnam',
    description: "Vietnam's largest island, with white sand beaches and coral reefs",
    photoUrl: '/trending/phu-quoc.jpg',
  },
  {
    name: 'Santorini, Greece',
    description: 'Whitewashed clifftop villages overlooking the Aegean',
    photoUrl: '/trending/santorini.jpg',
  },
  {
    name: 'Kyoto, Japan',
    description: 'Ancient temples, quiet gardens, and centuries of tradition',
    photoUrl: '/trending/kyoto.jpg',
  },
  {
    name: 'Bali, Indonesia',
    description: 'Lush rice terraces, surf breaks, and laid-back beach towns',
    photoUrl: '/trending/bali.jpg',
  },
];

export async function getTrendingLocations() {
  return CURATED_LOCATIONS;
}
