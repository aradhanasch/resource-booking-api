const axios = require('axios');

const TOKEN = process.env.TEST_TOKEN;
const BASE_URL = 'http://localhost:5000';
const CONCURRENT_REQUESTS = 12; // more than the pool size (10)

if (!TOKEN) {
  console.error('Set TEST_TOKEN first: $env:TEST_TOKEN="<jwt>"');
  process.exit(1);
}

// Fixed slot (5 days ahead, 10:00 UTC) so re-running the script reuses it.
const start = new Date(Date.now() + 5 * 86400000);
start.setUTCHours(10, 0, 0, 0);
const end = new Date(start.getTime() + 60 * 60 * 1000);

const payload = {
  resource_id: 2,
  start_time: start.toISOString(),
  end_time: end.toISOString(),
};
const headers = { Authorization: `Bearer ${TOKEN}` };

async function fire(index) {
  try {
    const res = await axios.post(`${BASE_URL}/api/bookings`, payload, { headers, timeout: 15000 });
    return { index, status: res.status };
  } catch (err) {
    return { index, status: err.response?.status ?? err.code };
  }
}

async function main() {
  console.log(`Slot: ${payload.start_time} to ${payload.end_time}`);

  // Step 1: make sure the slot is already booked (201 first run, 409 on re-runs; both fine).
  const setup = await fire(-1);
  console.log(`Setup request -> ${setup.status}`);

  // Step 2: hit the booked slot with 12 simultaneous requests.
  console.log(`\nFiring ${CONCURRENT_REQUESTS} simultaneous requests at the BOOKED slot...`);
  const began = Date.now();
  const results = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => fire(i)));
  const seconds = ((Date.now() - began) / 1000).toFixed(1);

  const counts = {};
  results.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  console.log(`Finished in ${seconds}s. Status counts:`, counts);

  if (counts[409] === CONCURRENT_REQUESTS) {
    console.log('\nPASS: all requests were cleanly rejected with 409.');
  } else {
    console.log('\nFAIL: some requests did not return 409 (timeouts mean the pool is starved).');
  }
}

main();