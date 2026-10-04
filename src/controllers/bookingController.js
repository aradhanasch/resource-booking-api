const pool = require('../db/pool');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { findAlternativeResources, findAlternativeTimes } = require('../services/alternativeService');

const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 4 * 60; // 4 hours
const MIN_NOTICE_MINUTES = 15;
const MAX_ADVANCE_DAYS = 90; // bookings can't be made further ahead than this

// Shared guard for every :id route — req.params.id is always a raw string.
function parseId(rawId, label) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(`Invalid ${label}`, 400);
  }
  return id;
}

// POST /api/bookings
const createBooking = asyncHandler(async (req, res) => {
  const { resource_id, start_time, end_time } = req.body;
  const userId = req.userId; // set by isAuthenticated

  // ---- Cheap, in-memory checks first: no DB connection used for bad input ----
  if (!resource_id || !start_time || !end_time) {
    throw new AppError('resource_id, start_time, and end_time are required', 400);
  }

  // Rejects "abc", 1.5, -3, etc. before they reach Postgres (which would
  // otherwise throw a raw 22P02 and surface as a 500).
  const resourceId = parseId(resource_id, 'resource_id');

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

  const maxAdvanceMs = MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000;
  if (start - now > maxAdvanceMs) {
    throw new AppError(`Bookings can be made at most ${MAX_ADVANCE_DAYS} days in advance`, 400);
  }

  // ---- Database work starts here ----

  // Confirm the resource actually exists before booking it
  const resourceCheck = await pool.query('SELECT id FROM resources WHERE id = $1', [resourceId]);
  if (resourceCheck.rows.length === 0) {
    throw new AppError('Resource not found', 404);
  }

  const client = await pool.connect();
  let booking = null; // stays null if there was a conflict

  try {
    await client.query('BEGIN');

    // Serializes all booking attempts on this resource.
    await client.query('SELECT pg_advisory_xact_lock($1)', [resourceId]);

    const overlapCheck = await client.query(
      `SELECT id FROM bookings
       WHERE resource_id = $1
         AND status = 'CONFIRMED'
         AND start_time < $3
         AND end_time > $2`,
      [resourceId, start, end]
    );

    if (overlapCheck.rows.length > 0) {
      // Conflict: just end the transaction. We do NOT build the response
      // here, because we must give the connection back first.
      await client.query('ROLLBACK');
    } else {
      const result = await client.query(
        `INSERT INTO bookings (user_id, resource_id, start_time, end_time)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, resourceId, start, end]
      );
      await client.query('COMMIT'); // releases the advisory lock
      booking = result.rows[0];
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // 23P01 = exclusion_violation: the EXCLUDE constraint caught an overlap.
    // Treat it exactly like a normal conflict (falls through to the alternatives below).
    if (err.code !== '23P01') {
      throw err;
    }
  } finally {
    client.release(); // connection is back in the pool BEFORE we need any other one
  }

  if (booking) {
    return res.status(201).json({ success: true, booking });
  }

  // Conflict path. We hold NO connection at this point, so these queries can
  // always get one from the pool.
  const [alternativeResources, alternativeTimes] = await Promise.all([
    findAlternativeResources(resourceId, start, end),
    findAlternativeTimes(resourceId, start, end),
  ]);

  return res.status(409).json({
    success: false,
    message: 'This resource is already booked for the requested time',
    alternatives: {
      other_resources: alternativeResources,
      other_times: alternativeTimes,
    },
  });
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

// GET /api/bookings/:id
const getBookingById = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'booking id');

  const result = await pool.query(
    `SELECT b.*, r.name AS resource_name, r.location AS resource_location
     FROM bookings b
     JOIN resources r ON r.id = b.resource_id
     WHERE b.id = $1`,
    [id]
  );
  const booking = result.rows[0];

  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  if (booking.user_id !== req.userId) {
    throw new AppError('You can only view your own bookings', 403);
  }

  res.json({ success: true, booking });
});

// DELETE /api/bookings/:id
const cancelBooking = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const id = parseId(req.params.id, 'booking id');

  const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
  const booking = result.rows[0];

  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  // Ownership check — a user can only cancel their own bookings.
  // Checked explicitly (not folded into the UPDATE's WHERE clause) so we
  // can return a clear 403 instead of a misleading 404.
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

module.exports = { createBooking, getMyBookings, getBookingById, cancelBooking };