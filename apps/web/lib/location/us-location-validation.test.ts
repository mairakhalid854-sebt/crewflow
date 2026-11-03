import { describe, expect, it } from 'vitest';

import { US_STATES } from './us-locations';
import {
  formatUsPhone,
  normalizeUsPhone,
  optionalUsPhoneSchema,
} from './us-phone';
import {
  defaultTimeZoneForState,
  stateHasMultipleTimeZones,
} from './us-time-zones';
import { isUsZipForState } from './us-zip';

describe('normalizeUsPhone', () => {
  it.each([
    '3234553661',
    '(323) 455-3661',
    '323-455-3661',
    '323.455.3661',
    '+1 323 455 3661',
    '1-323-455-3661',
    '+13234553661',
  ])('accepts %s', (input) => {
    expect(normalizeUsPhone(input)).toBe('+13234553661');
  });

  it.each([
    ['too short', '323455366'],
    ['too long', '32345536612'],
    ['area code starting with 0', '0234553661'],
    ['area code starting with 1', '1234553661'],
    ['exchange starting with 1', '3231553661'],
    ['N11 service code as area code', '9114553661'],
    ['letters', '323-ABC-3661'],
    ['non-US country code', '+44 20 7946 0958'],
    ['Pakistan mobile', '+92 300 1234567'],
  ])('rejects %s', (_label, input) => {
    expect(normalizeUsPhone(input)).toBeNull();
  });

  it('formats stored numbers for display and leaves legacy values alone', () => {
    expect(formatUsPhone('+13234553661')).toBe('(323) 455-3661');
    expect(formatUsPhone('call office')).toBe('call office');
    expect(formatUsPhone(null)).toBe('');
  });

  it('keeps an empty optional phone empty and rejects invalid input', () => {
    expect(optionalUsPhoneSchema.parse('  ')).toBe('');
    expect(optionalUsPhoneSchema.parse('(323) 455-3661')).toBe('+13234553661');
    expect(optionalUsPhoneSchema.safeParse('12345').success).toBe(false);
  });
});

describe('isUsZipForState', () => {
  it.each([
    ['60083', 'IL'],
    ['60601', 'IL'],
    ['62701', 'IL'],
    ['62999', 'IL'],
    ['90210', 'CA'],
    ['10001', 'NY'],
    ['00501', 'NY'],
    ['06390', 'NY'],
    ['02108', 'MA'],
    ['05501', 'MA'],
    ['05401', 'VT'],
    ['20500', 'DC'],
    ['20101', 'VA'],
    ['73301', 'TX'],
    ['79901', 'TX'],
    ['88510', 'TX'],
    ['73102', 'OK'],
    ['85001', 'AZ'],
    ['96801', 'HI'],
    ['99501', 'AK'],
    ['00901', 'PR'],
    ['33101', 'FL'],
    ['30301', 'GA'],
    ['60083-1234', 'IL'],
  ])('accepts %s in %s', (zip, stateCode) => {
    expect(isUsZipForState(zip, stateCode)).toBe(true);
  });

  it.each([
    ['90210', 'IL'],
    ['63101', 'IL'],
    ['59901', 'IL'],
    ['60083', 'CA'],
    ['73301', 'OK'],
    ['05501', 'VT'],
    ['88510', 'NM'],
  ])('rejects %s in %s', (zip, stateCode) => {
    expect(isUsZipForState(zip, stateCode)).toBe(false);
  });

  it('has prefix data for every selectable state and territory', () => {
    for (const state of US_STATES) {
      expect(
        isUsZipForState('00000', state.abbreviation) === false,
        state.abbreviation,
      ).toBe(true);
    }
  });
});

describe('defaultTimeZoneForState', () => {
  it('suggests the main time zone for each state', () => {
    expect(defaultTimeZoneForState('IL')).toBe('America/Chicago');
    expect(defaultTimeZoneForState('NY')).toBe('America/New_York');
    expect(defaultTimeZoneForState('CO')).toBe('America/Denver');
    expect(defaultTimeZoneForState('AZ')).toBe('America/Phoenix');
    expect(defaultTimeZoneForState('CA')).toBe('America/Los_Angeles');
    expect(defaultTimeZoneForState('AK')).toBe('America/Anchorage');
    expect(defaultTimeZoneForState('HI')).toBe('Pacific/Honolulu');
  });

  it('covers all 50 states and DC', () => {
    const territories = new Set(['AS', 'GU', 'MP', 'PR', 'VI']);
    for (const state of US_STATES) {
      if (territories.has(state.abbreviation)) continue;
      expect(
        defaultTimeZoneForState(state.abbreviation),
        state.abbreviation,
      ).toBeDefined();
    }
  });

  it('flags states that span more than one time zone', () => {
    expect(stateHasMultipleTimeZones('TX')).toBe(true);
    expect(stateHasMultipleTimeZones('IL')).toBe(false);
  });
});
