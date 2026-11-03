import { describe, expect, it } from 'vitest';

import { parseClamAvScanResponse, parseClamAvVersion } from '../src/clamav.js';

describe('ClamAV response parser', () => {
  it('accepts only terminal clean or infected results', () => {
    expect(parseClamAvScanResponse('stream: OK\0')).toBe('clean');
    expect(parseClamAvScanResponse('stream: Eicar-Signature FOUND\0')).toBe(
      'infected',
    );
    expect(() => parseClamAvScanResponse('stream: scan error ERROR\0')).toThrow(
      'clamav_invalid_scan_response',
    );
  });

  it('extracts a bounded engine version', () => {
    expect(
      parseClamAvVersion('ClamAV/1.4.3/12345/Mon Oct 27 00:00:00 2026\0'),
    ).toBe('1.4.3');
    expect(() => parseClamAvVersion('unexpected')).toThrow(
      'clamav_invalid_version_response',
    );
  });
});
