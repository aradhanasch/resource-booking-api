const pool = require('../db/pool');

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

// Finds the next few free slots for the SAME resource, later the
// same day, matching the requested duration. Scans forward in
// 30-minute steps from the requested end_time until end of day.
const findAlternativeTimes = async (resourceId, start, end) => {
  const durationMs = end - start;
  const STEP_MS = 30 * 60 * 1000; // 30-minute increments
  const MAX_SUGGESTIONS = 3;

  // Don't scan past the end of the requested day
  const endOfDay = new Date(start);
  endOfDay.setHours(23, 59, 59, 999);

  // Pull every confirmed booking for this resource on this day ONCE,
  // rather than querying the DB inside the loop below.
  const startOfDay = new Date(start);
  startOfDay.setHours(0, 0, 0, 0); 
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
  let candidateStart = new Date(start.getTime()); // start scanning right after the requested slot

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