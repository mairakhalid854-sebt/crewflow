/** Signed marketing unsubscribe token: `<customer uuid>.<hex HMAC>`. */
const UNSUBSCRIBE_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/;

export function isUnsubscribeToken(value: string): boolean {
  return UNSUBSCRIBE_TOKEN_PATTERN.test(value);
}
