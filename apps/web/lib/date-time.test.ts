import { describe, expect, it } from 'vitest';

import { isoToLocalDateTime, localDateTimeToIso } from './date-time';

describe('business-local date time conversion', () => {
  it('converts Pacific local time to UTC and back', () => {
    const iso = localDateTimeToIso('2026-10-14T09:30', 'America/Los_Angeles');
    expect(iso).toBe('2026-10-14T16:30:00.000Z');
    expect(isoToLocalDateTime(iso, 'America/Los_Angeles')).toBe(
      '2026-10-14T09:30',
    );
  });

  it('handles a daylight-saving offset', () => {
    expect(localDateTimeToIso('2026-01-14T09:30', 'America/New_York')).toBe(
      '2026-01-14T14:30:00.000Z',
    );
  });

  it('rejects invalid and nonexistent local times', () => {
    expect(localDateTimeToIso('not-a-date', 'America/Chicago')).toBeNull();
    expect(
      localDateTimeToIso('2026-03-08T02:30', 'America/New_York'),
    ).toBeNull();
  });
});
