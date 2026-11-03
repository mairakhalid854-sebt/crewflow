export const US_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const;

export type UsTimeZone = (typeof US_TIME_ZONES)[number];

const EASTERN = 'America/New_York';
const CENTRAL = 'America/Chicago';
const MOUNTAIN = 'America/Denver';
const PACIFIC = 'America/Los_Angeles';

/** The time zone most of each state's population uses. */
const DEFAULT_TIME_ZONE_BY_STATE: Readonly<Record<string, UsTimeZone>> = {
  AK: 'America/Anchorage',
  AL: CENTRAL,
  AR: CENTRAL,
  AZ: 'America/Phoenix',
  CA: PACIFIC,
  CO: MOUNTAIN,
  CT: EASTERN,
  DC: EASTERN,
  DE: EASTERN,
  FL: EASTERN,
  GA: EASTERN,
  HI: 'Pacific/Honolulu',
  IA: CENTRAL,
  ID: MOUNTAIN,
  IL: CENTRAL,
  IN: EASTERN,
  KS: CENTRAL,
  KY: EASTERN,
  LA: CENTRAL,
  MA: EASTERN,
  MD: EASTERN,
  ME: EASTERN,
  MI: EASTERN,
  MN: CENTRAL,
  MO: CENTRAL,
  MS: CENTRAL,
  MT: MOUNTAIN,
  NC: EASTERN,
  ND: CENTRAL,
  NE: CENTRAL,
  NH: EASTERN,
  NJ: EASTERN,
  NM: MOUNTAIN,
  NV: PACIFIC,
  NY: EASTERN,
  OH: EASTERN,
  OK: CENTRAL,
  OR: PACIFIC,
  PA: EASTERN,
  RI: EASTERN,
  SC: EASTERN,
  SD: CENTRAL,
  TN: CENTRAL,
  TX: CENTRAL,
  UT: MOUNTAIN,
  VA: EASTERN,
  VT: EASTERN,
  WA: PACIFIC,
  WI: CENTRAL,
  WV: EASTERN,
  WY: MOUNTAIN,
};

/** States where some areas keep a different time zone from the default. */
const MULTI_TIME_ZONE_STATES = new Set([
  'AK',
  'FL',
  'ID',
  'IN',
  'KS',
  'KY',
  'MI',
  'ND',
  'NE',
  'NV',
  'OR',
  'SD',
  'TN',
  'TX',
]);

export function defaultTimeZoneForState(
  stateCode: string,
): UsTimeZone | undefined {
  return DEFAULT_TIME_ZONE_BY_STATE[stateCode.toUpperCase()];
}

export function stateHasMultipleTimeZones(stateCode: string): boolean {
  return MULTI_TIME_ZONE_STATES.has(stateCode.toUpperCase());
}
