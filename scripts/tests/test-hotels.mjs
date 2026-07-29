async function fetchTier(destination, budget) {
  const res = await fetch('http://localhost:3001/api/accommodation-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination, budget }),
  })
  console.log(`\n--- ${budget} (HTTP ${res.status}) ---`)
  const data = await res.json()
  console.log(JSON.stringify(data, null, 2))
}

async function main() {
  const destination = 'Berlin, Germany'
  for (const budget of ['Economy', 'Standard', 'Luxury']) {
    await fetchTier(destination, budget)
  }
}

main().catch((err) => console.error('Script failed:', err))
