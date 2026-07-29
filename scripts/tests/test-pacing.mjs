async function main() {
  const res = await fetch('http://localhost:3000/api/generate-itinerary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: 'Ksamil, Albania',
      days: 3,
      budget: 'mid-range',
      accommodation: 'Sunrise Boutique Hotel'
    })
  });

  const data = await res.json();

  for (const key of ['packed', 'slow']) {
    const itinerary = data[key];
    if (!itinerary) {
      console.log(key, '- missing from response');
      continue;
    }
    console.log(key, 'pacingLabel:', itinerary.pacingLabel);
    itinerary.days.forEach((day) => {
      console.log(
        '  day', day.day,
        '| stopCount:', day.stopCount,
        '| pacingLevel:', day.pacingLevel,
        '| items.length:', day.items.length
      );
    });
  }
}

main().catch((err) => console.error('Script failed:', err));
