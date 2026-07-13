async function main() {
  const res = await fetch('http://localhost:3001/api/accommodation-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: 'Ksamil, Albania',
      budget: 'Standard'
    })
  });

  console.log('HTTP status:', res.status);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => console.error('Script failed:', err));
