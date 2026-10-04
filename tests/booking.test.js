const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/db/pool');
const { istDayBounds, IST_OFFSET_MS } = require('../src/utils/istTime');

let token;
let resourceId;

// Test day: 75 days ahead, as an IST calendar date (YYYY-MM-DD).
// - Always in the future and inside the 90-day booking window, so this file
//   never goes stale as the calendar moves on.
// - Far outside the days used by the Postman collection (3-52 days ahead)
//   and the manual scripts (2-21 days ahead), so they can never collide.
const testDate = new Date(Date.now() + 75 * 24 * 60 * 60 * 1000 + IST_OFFSET_MS)
  .toISOString()
  .slice(0, 10);

const book = (body) =>
  request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(body);

// Removes every booking on the test day (IST calendar day).
const clearTestDay = async () => {
  const { startOfDay, endOfDay } = istDayBounds(new Date(`${testDate}T12:00:00+05:30`));
  await pool.query(
    `DELETE FROM bookings WHERE start_time >= $1 AND start_time <= $2`,
    [startOfDay, endOfDay]
  );
};

beforeAll(async () => {
  // Wipe any bookings a prior (possibly crashed) run left on the test day,
  // so the suite is idempotent no matter how many times it's re-run.
  await clearTestDay();

  // Register a fresh test user (unique email per run)
  const email = `test_${Date.now()}@example.com`;
  await request(app).post('/api/auth/register').send({
    name: 'Test Runner',
    email,
    password: 'password123',
  });

  const loginRes = await request(app).post('/api/auth/login').send({
    email,
    password: 'password123',
  });
  token = loginRes.body.token;

  const resourcesRes = await request(app).get('/api/resources');
  resourceId = resourcesRes.body.resources[0].id; // use whatever resource exists first
});

afterAll(async () => {
  await clearTestDay(); // leave no test bookings behind
  await pool.end();
});

describe('Booking conflict detection', () => {
  test('creates a valid booking', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T10:00:00+05:30`,
      end_time: `${testDate}T11:00:00+05:30`,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('rejects an identical, overlapping booking', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T10:00:00+05:30`,
      end_time: `${testDate}T11:00:00+05:30`,
    });
    expect(res.status).toBe(409);
    expect(res.body.alternatives).toBeDefined();
  });

  test('rejects a partially overlapping booking (10:30-11:30 vs existing 10:00-11:00)', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T10:30:00+05:30`,
      end_time: `${testDate}T11:30:00+05:30`,
    });
    expect(res.status).toBe(409);
  });

  test('allows an adjacent booking (11:00-12:00, right after existing ends)', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T11:00:00+05:30`,
      end_time: `${testDate}T12:00:00+05:30`,
    });
    expect(res.status).toBe(201);
  });

  test('allows a booking before the existing one (9:00-10:00, right before it starts)', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T09:00:00+05:30`,
      end_time: `${testDate}T10:00:00+05:30`,
    });
    expect(res.status).toBe(201);
  });
});

describe('Booking validation', () => {
  test('rejects a booking under 30 minutes', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T14:00:00+05:30`,
      end_time: `${testDate}T14:15:00+05:30`,
    });
    expect(res.status).toBe(400);
  });

  test('rejects a booking over 4 hours', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T15:00:00+05:30`,
      end_time: `${testDate}T20:00:00+05:30`,
    });
    expect(res.status).toBe(400);
  });

  test('rejects a booking too far in advance', async () => {
    const far = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const farEnd = new Date(far.getTime() + 60 * 60 * 1000);
    const res = await book({
      resource_id: resourceId,
      start_time: far.toISOString(),
      end_time: farEnd.toISOString(),
    });
    expect(res.status).toBe(400);
  });

  test('rejects a non-numeric resource_id', async () => {
    const res = await book({
      resource_id: 'abc',
      start_time: `${testDate}T18:00:00+05:30`,
      end_time: `${testDate}T19:00:00+05:30`,
    });
    expect(res.status).toBe(400);
  });

  test('returns 404 for a resource that does not exist', async () => {
    const res = await book({
      resource_id: 999999,
      start_time: `${testDate}T18:00:00+05:30`,
      end_time: `${testDate}T19:00:00+05:30`,
    });
    expect(res.status).toBe(404);
  });
});

describe('Get booking by id', () => {
  let bookingId;

  test('creates a booking to fetch', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T12:00:00+05:30`,
      end_time: `${testDate}T13:00:00+05:30`,
    });
    expect(res.status).toBe(201);
    bookingId = res.body.booking.id;
  });

  test('owner can fetch their booking', async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(bookingId);
  });

  test('returns 404 for a booking that does not exist', async () => {
    const res = await request(app)
      .get('/api/bookings/999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('returns 400 for a non-numeric booking id', async () => {
    const res = await request(app)
      .get('/api/bookings/not-a-number')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test("another user cannot fetch someone else's booking (403)", async () => {
    const email = `other_${Date.now()}@example.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other User', email, password: 'password123' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });

    const res = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(403);
  });
});

describe('Cancellation frees the slot', () => {
  let bookingId;

  test('creates a booking to cancel', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T16:00:00+05:30`,
      end_time: `${testDate}T17:00:00+05:30`,
    });
    expect(res.status).toBe(201);
    bookingId = res.body.booking.id;
  });

  test('cancels the booking', async () => {
    const res = await request(app)
      .delete(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('the same slot can now be re-booked', async () => {
    const res = await book({
      resource_id: resourceId,
      start_time: `${testDate}T16:00:00+05:30`,
      end_time: `${testDate}T17:00:00+05:30`,
    });
    expect(res.status).toBe(201);
  });

  test('returns 400 for a non-numeric booking id on cancel', async () => {
    const res = await request(app)
      .delete('/api/bookings/not-a-number')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});