import { describe, expect, it } from 'vitest';

import { normalizeGoogleReviewUrl } from './google-review-url';

describe('normalizeGoogleReviewUrl', () => {
  it('treats an empty value as "no review link"', () => {
    expect(normalizeGoogleReviewUrl('')).toEqual({ ok: true, url: null });
    expect(normalizeGoogleReviewUrl('   ')).toEqual({ ok: true, url: null });
    expect(normalizeGoogleReviewUrl(null)).toEqual({ ok: true, url: null });
  });

  it('accepts the links Google gives a business', () => {
    for (const link of [
      'https://g.page/r/CbXyZ123abc/review',
      'https://search.google.com/local/writereview?placeid=ChIJ123',
      'https://maps.app.goo.gl/AbCdEf123',
      'https://www.google.com/maps/place/ABC+HVAC',
    ]) {
      expect(normalizeGoogleReviewUrl(link)).toEqual({ ok: true, url: link });
    }
  });

  it('adds https when the owner pastes the link without it', () => {
    expect(normalizeGoogleReviewUrl('g.page/r/CbXyZ123abc/review')).toEqual({
      ok: true,
      url: 'https://g.page/r/CbXyZ123abc/review',
    });
  });

  it('rejects links that are not Google or not secure', () => {
    for (const link of [
      'https://example.com/review',
      'http://g.page/r/abc/review',
      'https://g.page.evil.com/r/abc',
      'https://user:pass@g.page/r/abc',
      'https://g.page:8443/r/abc',
      'javascript:alert(1)',
      `https://g.page/r/${'a'.repeat(600)}`,
    ]) {
      expect(normalizeGoogleReviewUrl(link)).toEqual({ ok: false });
    }
  });
});
