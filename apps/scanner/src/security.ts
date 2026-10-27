import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function bearerTokenIsValid(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  const prefix = 'Bearer ';
  const supplied = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : '';
  return timingSafeEqual(digest(supplied), digest(expectedToken));
}

export function sha256Matches(bytes: Buffer, expectedHex: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(expectedHex)) return false;
  const actual = createHash('sha256').update(bytes).digest();
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(actual, expected);
}
