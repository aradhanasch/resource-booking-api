const pool = require('../db/pool');
const { istDayBounds } = require('../utils/istTime');

// Finds other resources of the SAME TYPE as the requested one,
// that are free for the exact requested time window.
const findAlternativeResources = async (resourceId, start, end) => {
  const result = await pool.query(
    `SELECT r.* FROM resources r
     WHERE r.type = (SELECT type FROM resources WHERE id = $1)
       AND r.id != $1
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.resource_id = r.id
           AND b.status = 'CONFIRMED'
           AND b.start_time < $3
           AND b.end_time > $2
       )
     LIMIT 5`,
    [resourceId, start, end]
  );
  return result.rows;
};

// Finds the next few free slots for the SAME resource, on the same IST
// calendar day, matching the requested duration. Scans forward in 30-minute
// steps from the requested start time until the end of that IST day.
const findAlternativeTimes = async (resourceId, start, end) => {
  const durationMs = end - start;
  const STEP_MS = 30 * 60 * 1000; // 30-minute increments
  const MAX_SUGGESTIONS = 3;

  // The IST calendar day of the requested slot. NOT the server's local day,
  // which would be wrong on a UTC host.
  const { startOfDay, endOfDay } = istDayBounds(start);

  // Pull every confirmed booking for this resource on this day ONCE,
  // rather than querying the DB inside the loop below.
  const existing = await pool.query(
    `SELECT start_time, end_time FROM bookings
     WHERE resource_id = $1
       AND status = 'CONFIRMED'
       AND start_time < $2 AND end_time > $3`,
    [resourceId, endOfDay, startOfDay]
  );

  const isFree = (candidateStart, candidateEnd) => {
    return !existing.rows.some(
      (b) => candidateStart < new Date(b.end_time) && candidateEnd > new Date(b.start_time)
    );
  };

  const suggestions = [];
  // The first candidate is the requested slot itself, which is known to
  // conflict, so isFree rejects it and the scan moves on.
  let candidateStart = new Date(start.getTime());

  while (candidateStart.getTime() + durationMs <= endOfDay.getTime() && suggestions.length < MAX_SUGGESTIONS) {
    const candidateEnd = new Date(candidateStart.getTime() + durationMs);

    if (isFree(candidateStart, candidateEnd)) {
      suggestions.push({
        start_time: candidateStart.toISOString(),
        end_time: candidateEnd.toISOString(),
      });
    }

    candidateStart = new Date(candidateStart.getTime() + STEP_MS);
  }

  return suggestions;
};

module.exports = { findAlternativeResources, findAlternativeTimes };