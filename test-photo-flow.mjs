async function main() {
  const verifyRes = await fetch('http://localhost:3000/api/verify-place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Guvat Restaurant',
      destination: 'Ksamil, Albania',
      type: 'restaurant'
    })
  });

  const verifyData = await verifyRes.json();
  console.log('verify-place status:', verifyData.status);
  console.log('photoUrl returned:', verifyData.photoUrl);

  if (!verifyData.photoUrl) {
    console.log('No photoUrl in response, stopping.');
    return;
  }

  const photoRes = await fetch('http://localhost:3000' + verifyData.photoUrl);
  console.log('photo proxy status:', photoRes.status);
  console.log('photo content-type:', photoRes.headers.get('content-type'));

  const buffer = Buffer.from(await photoRes.arrayBuffer());
  console.log('photo byte length:', buffer.length);

  if (photoRes.headers.get('content-type')?.startsWith('image/')) {
    const fs = await import('fs');
    fs.writeFileSync('test-photo-2.jpg', buffer);
    console.log('Saved a real image to test-photo-2.jpg');
  } else {
    console.log('Response body (likely an error):', buffer.toString('utf-8'));
  }
}

main().catch((err) => console.error('Script failed:', err));
