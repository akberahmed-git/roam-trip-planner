async function main() {
  const res = await fetch('http://localhost:3001/api/place-autocomplete?input=Bar');
  console.log('HTTP status:', res.status);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => console.error('Script failed:', err));
