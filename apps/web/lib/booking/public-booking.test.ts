import { describe, expect, it } from 'vitest';

import {
  bookingErrorCode,
  formatDuration,
  formatPrice,
  groupSlotsByDay,
  normalizeBookingSlug,
} from './public-booking';

describe('normalizeBookingSlug', () => {
  it('turns a business name into a link', () => {
    expect(normalizeBookingSlug("  Joe's HVAC & Plumbing! ")).toBe(
      'joe-s-hvac-plumbing',
    );
    expect(normalizeBookingSlug('---Cool Air---')).toBe('cool-air');
  });
});

describe('groupSlotsByDay', () => {
  it('groups by the business time zone, not the visitor', () => {
    const groups = groupSlotsByDay(
      [
        // 11 PM Nov 20 in New York is already Nov 21 in UTC.
        { starts_at: '2026-11-21T04:00:00Z', ends_at: '2026-11-21T05:00:00Z' },
        { starts_at: '2026-11-21T14:00:00Z', ends_at: '2026-11-21T15:00:00Z' },
      ],
      'America/New_York',
      'en',
    );
    expect(groups.map((group) => group.day)).toEqual([
      '2026-11-20',
      '2026-11-21',
    ]);
    expect(groups[1]?.slots[0]?.time).toBe('9:00 AM');
  });

  it('skips invalid dates', () => {
    expect(
      groupSlotsByDay(
        [{ starts_at: 'nope', ends_at: 'nope' }],
        'America/Chicago',
        'en',
      ),
    ).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats prices and durations', () => {
    expect(formatPrice(12900, 'en')).toBe('$129.00');
    expect(formatDuration(90, 'en')).toBe('1 hr 30 min');
    expect(formatDuration(45, 'es')).toBe('45 min');
    expect(formatDuration(120, 'es')).toBe('2 h');
  });
});

describe('bookingErrorCode', () => {
  it('maps database errors to safe codes', () => {
    expect(bookingErrorCode('time no longer available')).toBe('taken');
    expect(bookingErrorCode('booking rate limited')).toBe('limited');
    expect(bookingErrorCode('invalid zip')).toBe('zip');
    expect(bookingErrorCode('duplicate key value violates…')).toBe('unknown');
    expect(bookingErrorCode(undefined)).toBe('unknown');
  });
});
