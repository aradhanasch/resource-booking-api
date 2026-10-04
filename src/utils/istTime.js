// IST is UTC+05:30 and has no daylight saving time, so a fixed offset is exact.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Returns the instants (as Dates) for 00:00:00.000 and 23:59:59.999 IST of the
// IST calendar day that contains `date`. Never uses the server's local timezone.
const istDayBounds = (date) => {
  // Shift so that UTC arithmetic reads like IST wall-clock time, floor to
  // midnight, then shift back.
  const istWallClockMs = date.getTime() + IST_OFFSET_MS;
  const startOfDayMs = Math.floor(istWallClockMs / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return {
    startOfDay: new Date(startOfDayMs),
    endOfDay: new Date(startOfDayMs + DAY_MS - 1),
  };
};

module.exports = { istDayBounds, IST_OFFSET_MS };