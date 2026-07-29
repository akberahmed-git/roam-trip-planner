import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const key = env.match(/GOOGLE_PLACES_API_KEY=(.*)/)[1].trim();

// Two points a few hundred meters apart in Ksamil, Albania, just to test the API is enabled.
const origin = { latitude: 39.7717, longitude: 19.9908 };
const destination = { latitude: 39.7745, longitude: 19.9925 };

const body = {
  origins: [{ waypoint: { location: { latLng: origin } } }],
  destinations: [{ waypoint: { location: { latLng: destination } } }],
  travelMode: 'WALK',
};

const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': key,
    'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
  },
  body: JSON.stringify(body),
});

const data = await response.json();
console.log('HTTP status:', response.status);
console.log(JSON.stringify(data, null, 2));
