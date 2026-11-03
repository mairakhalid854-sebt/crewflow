import { z } from 'zod';

// North American Numbering Plan: area code and exchange both start with 2-9.
const NANP_DIGITS = /^([2-9]\d{2})([2-9]\d{2})(\d{4})$/;
const ALLOWED_CHARACTERS = /^\+?[\d\s().-]*$/;
const E164_US = /^\+1(\d{3})(\d{3})(\d{4})$/;

export const US_PHONE_ERROR = 'Enter a valid 10-digit US phone number.';

/**
 * Returns the number as `+1XXXXXXXXXX`, or null when it is not a valid US
 * number. Accepts common input styles such as `(323) 455-3661`,
 * `323.455.3661`, `+1 323 455 3661`, and `1-323-455-3661`.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || !ALLOWED_CHARACTERS.test(trimmed)) return null;

  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);

  const match = NANP_DIGITS.exec(digits);
  if (!match) return null;
  // N11 codes (211, 311, 411, 911, ...) are service codes, not area codes.
  if (match[1]?.endsWith('11')) return null;

  return `+1${digits}`;
}

/** Formats a stored `+1XXXXXXXXXX` number as `(323) 455-3661`. */
export function formatUsPhone(value: string | null | undefined): string {
  if (!value) return '';
  const match = E164_US.exec(value);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value;
}

/** Optional phone field: empty stays empty, anything else must be valid. */
export const optionalUsPhoneSchema = z
  .string()
  .trim()
  .default('')
  .transform((value, context) => {
    if (!value) return '';
    const normalized = normalizeUsPhone(value);
    if (!normalized) {
      context.addIssue({ code: 'custom', message: US_PHONE_ERROR });
      return z.NEVER;
    }
    return normalized;
  });
