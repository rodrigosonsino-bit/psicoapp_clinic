async function check(port) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { method: 'GET' });
    console.log(`Port ${port} /health: status = ${res.status}`);
    const text = await res.text();
    console.log(`Port ${port} /health response:`, text);
  } catch (e) {
    console.log(`Port ${port} failed: ${e.message}`);
  }
}

async function run() {
  await check(3333);
  await check(3334);
  await check(3335);
  await check(3336);
}

run().catch(console.error);
