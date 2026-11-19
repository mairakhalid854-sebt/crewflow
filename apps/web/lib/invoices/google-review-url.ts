// The Google review link a business prints on every invoice. Only Google-owned
// HTTPS hosts are accepted; the database enforces the same rule.

const googleReviewHosts = new Set([
  'www.google.com',
  'search.google.com',
  'maps.google.com',
  'business.google.com',
  'g.page',
  'maps.app.goo.gl',
  'goo.gl',
  'g.co',
]);

export const GOOGLE_REVIEW_URL_MAX_LENGTH = 500;

export type GoogleReviewUrlResult =
  { readonly ok: true; readonly url: string | null } | { readonly ok: false };

export function normalizeGoogleReviewUrl(
  value: unknown,
): GoogleReviewUrlResult {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return { ok: true, url: null };

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !googleReviewHosts.has(url.hostname)
    ) {
      return { ok: false };
    }
    const href = url.href;
    if (href.length > GOOGLE_REVIEW_URL_MAX_LENGTH || /\s/.test(href)) {
      return { ok: false };
    }
    return { ok: true, url: href };
  } catch {
    return { ok: false };
  }
}
