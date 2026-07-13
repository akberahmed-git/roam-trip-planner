async function main() {
  const res = await fetch('http://localhost:3000/api/verify-place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Butrint National Park',
      destination: 'Ksamil, Albania',
      type: 'activity'
    })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => console.error('Script failed:', err));
