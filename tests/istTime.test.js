const { istDayBounds } = require('../src/utils/istTime');

const iso = (d) => d.toISOString();

describe('istDayBounds', () => {
  test('10:00 IST falls in that IST calendar day', () => {
    const { startOfDay, endOfDay } = istDayBounds(new Date('2026-10-08T10:00:00+05:30'));
    expect(iso(startOfDay)).toBe('2026-10-07T18:30:00.000Z');
    expect(iso(endOfDay)).toBe('2026-10-08T18:29:59.999Z');
  });

  test('00:30 IST is still the same IST day, even though UTC says the previous day', () => {
    const { startOfDay } = istDayBounds(new Date('2026-10-08T00:30:00+05:30'));
    expect(iso(startOfDay)).toBe('2026-10-07T18:30:00.000Z');
  });

  test('23:45 IST belongs to the day that is ending', () => {
    const { endOfDay } = istDayBounds(new Date('2026-10-08T23:45:00+05:30'));
    expect(iso(endOfDay)).toBe('2026-10-08T18:29:59.999Z');
  });

  test('midnight IST starts a new day', () => {
    const { startOfDay } = istDayBounds(new Date('2026-10-09T00:00:00+05:30'));
    expect(iso(startOfDay)).toBe('2026-10-08T18:30:00.000Z');
  });

  test('a day is 24 hours long, to the millisecond', () => {
    const { startOfDay, endOfDay } = istDayBounds(new Date('2026-10-08T12:00:00+05:30'));
    expect(endOfDay - startOfDay).toBe(24 * 60 * 60 * 1000 - 1);
  });
});