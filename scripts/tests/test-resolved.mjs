async function main() {
  console.log('Requesting resolved itinerary, this may take 10-30 seconds...');

  const res = await fetch('http://localhost:3001/api/generate-resolved-itinerary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: 'Ksamil, Albania',
      days: 3,
      budget: 'mid-range',
      accommodation: 'Sunrise Boutique Hotel'
    })
  });

  console.log('HTTP status:', res.status);
  const data = await res.json();

  if (data.error) {
    console.log('Error response:', data.error);
    return;
  }

  let totalItems = 0;
  let itemsWithPhoto = 0;
  let itemsWithTravelTime = 0;
  let leakedConfidenceFields = 0;

  for (const key of ['packed', 'slow']) {
    const itinerary = data[key];
    if (!itinerary) {
      console.log(key, '- missing from response');
      continue;
    }
    console.log('\n===', key, '===');
    console.log('pacingLabel:', itinerary.pacingLabel, '| tagline:', itinerary.tagline);

    itinerary.days.forEach((day) => {
      console.log(' Day', day.day, '-', day.theme, '(' + day.stopCount + ' stops)');
      day.items.forEach((item) => {
        totalItems += 1;
        if (item.photoUrl) itemsWithPhoto += 1;
        if (item.travelToNext) itemsWithTravelTime += 1;
        if ('status' in item || 'nameMatchScore' in item || 'suggestions' in item) {
          leakedConfidenceFields += 1;
        }
        console.log(
          '   -', item.name,
          '|', item.categoryTag,
          '| rating:', item.rating,
          '| hasHours:', item.hasHours,
          '| photoUrl:', item.photoUrl ? 'yes' : 'no',
          '| travelToNext:', item.travelToNext || 'none'
        );
      });
    });
  }

  console.log('\n--- summary ---');
  console.log('total items:', totalItems);
  console.log('items with photo:', itemsWithPhoto);
  console.log('items with travel time:', itemsWithTravelTime);
  console.log('items with leaked confidence fields (should be 0):', leakedConfidenceFields);
}

main().catch((err) => console.error('Script failed:', err));
