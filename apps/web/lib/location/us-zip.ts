type Zip3Range = readonly [first: number, last: number];

/**
 * USPS three-digit ZIP prefixes assigned to each state and territory. A ZIP
 * code's first three digits identify its sectional center, which never
 * crosses a state line, so this catches a ZIP typed for the wrong state
 * without a full ZIP database or a paid lookup.
 */
const ZIP3_RANGES_BY_STATE: Readonly<Record<string, readonly Zip3Range[]>> = {
  AK: [[995, 999]],
  AL: [[350, 369]],
  AR: [[716, 729]],
  AS: [[967, 967]],
  AZ: [[850, 865]],
  CA: [[900, 961]],
  CO: [[800, 816]],
  CT: [[60, 69]],
  DC: [
    [200, 200],
    [202, 205],
    [569, 569],
  ],
  DE: [[197, 199]],
  FL: [[320, 349]],
  GA: [
    [300, 319],
    [398, 399],
  ],
  GU: [[969, 969]],
  HI: [[967, 968]],
  IA: [[500, 528]],
  ID: [[832, 838]],
  IL: [[600, 629]],
  IN: [[460, 479]],
  KS: [[660, 679]],
  KY: [[400, 427]],
  LA: [[700, 714]],
  MA: [
    [10, 27],
    [55, 55],
  ],
  MD: [[206, 219]],
  ME: [[39, 49]],
  MI: [[480, 499]],
  MN: [[550, 567]],
  MO: [[630, 658]],
  MP: [[969, 969]],
  MS: [[386, 397]],
  MT: [[590, 599]],
  NC: [[270, 289]],
  ND: [[580, 588]],
  NE: [[680, 693]],
  NH: [[30, 38]],
  NJ: [[70, 89]],
  NM: [[870, 884]],
  NV: [[889, 898]],
  NY: [
    [5, 5],
    [63, 63],
    [100, 149],
  ],
  OH: [[430, 459]],
  OK: [
    [730, 732],
    [734, 749],
  ],
  OR: [[970, 979]],
  PA: [[150, 196]],
  PR: [
    [6, 7],
    [9, 9],
  ],
  RI: [[28, 29]],
  SC: [[290, 299]],
  SD: [[570, 577]],
  TN: [[370, 385]],
  TX: [
    [733, 733],
    [750, 799],
    [885, 885],
  ],
  UT: [[840, 847]],
  VA: [
    [201, 201],
    [220, 246],
  ],
  VI: [[8, 8]],
  VT: [
    [50, 54],
    [56, 59],
  ],
  WA: [[980, 994]],
  WI: [[530, 549]],
  WV: [[247, 268]],
  WY: [[820, 831]],
};

/**
 * True when the ZIP code's prefix belongs to the state. Unknown state codes
 * return true so this check never blocks a state it has no data for; format
 * validation stays the caller's job.
 */
export function isUsZipForState(zip: string, stateCode: string): boolean {
  const ranges = ZIP3_RANGES_BY_STATE[stateCode.toUpperCase()];
  if (!ranges) return true;

  const prefix = Number.parseInt(zip.trim().slice(0, 3), 10);
  if (Number.isNaN(prefix)) return false;

  return ranges.some(([first, last]) => prefix >= first && prefix <= last);
}
