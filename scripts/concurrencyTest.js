const axios = require('axios');

// You need a valid JWT here — log in via Postman first and paste the token.
const TOKEN = process.env.TEST_TOKEN || 'PASTE_A_VALID_TOKEN_HERE';
const BASE_URL = 'http://localhost:5000';
const CONCURRENT_REQUESTS = 10;

// Pick a resource_id and a time slot that's definitely free right now.
const bookingPayload = {
  resource_id: 2,
  start_time: '2026-09-28T16:00:00+05:30',
  end_time: '2026-09-28T17:00:00+05:30',
};

async function fireOneRequest(index) {
  try {
    const res = await axios.post(`${BASE_URL}/api/bookings`, bookingPayload, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    return { index, status: res.status, result: 'SUCCESS' };
  } catch (err) {
    // axios throws on non-2xx, so a 409 lands here — that's expected for 9 of 10
    return {
      index,
      status: err.response?.status,
      result: err.response?.data?.message || 'ERROR',
    };
  }
}

async function runConcurrencyTest() {
  console.log(`Firing ${CONCURRENT_REQUESTS} simultaneous booking requests...\n`);

  // Promise.all fires all requests essentially simultaneously — none of
  // them wait for a previous one to finish before starting.
  const promises = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => fireOneRequest(i));
  const results = await Promise.all(promises);

  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);
  const unexpected = results.filter((r) => r.status !== 201 && r.status !== 409);

  console.log('--- Results ---');
  results.forEach((r) => console.log(`Request ${r.index}: ${r.status} — ${r.result}`));

  console.log('\n--- Summary ---');
  console.log(`Successful bookings: ${successes.length}`);
  console.log(`Correctly rejected (409): ${conflicts.length}`);
  console.log(`Unexpected results: ${unexpected.length}`);

  if (successes.length === 1 && conflicts.length === CONCURRENT_REQUESTS - 1) {
    console.log('\n PASS — exactly one booking succeeded, concurrency protection works.');
  } else {
    console.log('\n FAIL — expected exactly 1 success and 9 conflicts.');
  }
}

runConcurrencyTest();