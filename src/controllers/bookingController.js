const pool = require('../db/pool');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { findAlternativeResources, findAlternativeTimes } = require('../services/alternativeService');

const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 4 * 60; // 4 hours
const MIN_NOTICE_MINUTES = 15;

// POST /api/bookings
const createBooking = asyncHandler(async (req, res) => {
  const { resource_id, start_time, end_time } = req.body;
  const userId = req.userId; // set by isAuthenticated

  if (!resource_id || !start_time || !end_time) {
    throw new AppError('resource_id, start_time, and end_time are required', 400);
  }

  const start = new Date(start_time);
  const end = new Date(end_time);
  const now = new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new AppError('Invalid date format', 400);
  }

  if (end <= start) {
    throw new AppError('end_time must be after start_time', 400);
  }

  const durationMinutes = (end - start) / (1000 * 60);
  if (durationMinutes < MIN_DURATION_MINUTES) {
    throw new AppError(`Booking must be at least ${MIN_DURATION_MINUTES} minutes`, 400);
  }
  if (durationMinutes > MAX_DURATION_MINUTES) {
    throw new AppError(`Booking cannot exceed ${MAX_DURATION_MINUTES / 60} hours`, 400);
  }

  const noticeMinutes = (start - now) / (1000 * 60);
  if (noticeMinutes < MIN_NOTICE_MINUTES) {
    throw new AppError(`Bookings require at least ${MIN_NOTICE_MINUTES} minutes notice`, 400);
  }

  // Confirm the resource actually exists before booking it
  const resourceCheck = await pool.query('SELECT id FROM resources WHERE id = $1', [resource_id]);
  if (resourceCheck.rows.length === 0) {
    throw new AppError('Resource not found', 404);
  }
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Serializes ALL booking attempts on this resource, regardless of
    // whether any overlapping row currently exists. A second concurrent
    // transaction trying to lock the SAME resource_id blocks here until
    // this transaction commits or rolls back. This is what closes the
    // phantom-row race that a plain SELECT ... FOR UPDATE would miss.
    await client.query('SELECT pg_advisory_xact_lock($1)', [resource_id]);

    // Now that we hold the lock, no other transaction on this resource
    // can be mid-flight — so this read is safe to trust.
    const overlapCheck = await client.query(
      `SELECT id FROM bookings
       WHERE resource_id = $1
         AND status = 'CONFIRMED'
         AND start_time < $3
         AND end_time > $2`,
      [resource_id, start, end]
    );

    if (overlapCheck.rows.length > 0) {
  await client.query('ROLLBACK');

  // Gather alternatives AFTER rolling back — these are read-only
  // queries and don't need to be part of the failed transaction.
  const [alternativeResources, alternativeTimes] = await Promise.all([
    findAlternativeResources(resource_id, start, end),
    findAlternativeTimes(resource_id, start, end),
  ]);

  return res.status(409).json({
    success: false,
    message: 'This resource is already booked for the requested time',
    alternatives: {
      other_resources: alternativeResources,
      other_times: alternativeTimes,
    },
  });
}

    const result = await client.query(
      `INSERT INTO bookings (user_id, resource_id, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, resource_id, start, end]
    );

    await client.query('COMMIT'); // releases the advisory lock automatically

    res.status(201).json({ success: true, booking: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {}); // safe even if already rolled back
    if (err.code === '23P01') {
    throw new AppError('This resource is already booked for the requested time', 409);
  }
    throw err;
  } finally {
    client.release(); // ALWAYS return the connection to the pool, success or failure
  }
});

// GET /api/bookings/my
const getMyBookings = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT b.*, r.name AS resource_name, r.location AS resource_location
     FROM bookings b
     JOIN resources r ON r.id = b.resource_id
     WHERE b.user_id = $1
     ORDER BY b.start_time DESC`,
    [req.userId]
  );

  res.json({ success: true, bookings: result.rows });
});



// DELETE /api/bookings/:id
const cancelBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
  const booking = result.rows[0];

  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  // Ownership check — a user can only cancel their own bookings.
  // We check this explicitly rather than filtering it into the WHERE
  // clause of the UPDATE, so we can give a clear 403 instead of a
  // misleading 404 when the booking exists but isn't theirs.
  if (booking.user_id !== userId) {
    throw new AppError('You can only cancel your own bookings', 403);
  }

  if (booking.status === 'CANCELLED') {
    throw new AppError('Booking is already cancelled', 400);
  }

  if (new Date(booking.start_time) <= new Date()) {
    throw new AppError('Cannot cancel a booking that has already started or passed', 400);
  }

  const updated = await pool.query(
    `UPDATE bookings SET status = 'CANCELLED' WHERE id = $1 RETURNING *`,
    [id]
  );

  res.json({ success: true, booking: updated.rows[0] });
});

module.exports = { createBooking, getMyBookings, cancelBooking }; // update this export line