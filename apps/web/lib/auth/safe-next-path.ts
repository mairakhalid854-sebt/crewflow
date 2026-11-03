const invitePathPattern = /^\/invite\/[0-9a-f]{64}$/;
const appPathPattern = /^\/app(?:\/[^?#]*)?$/;

export function safeNextPath(
  value: FormDataEntryValue | string | string[] | null | undefined,
  fallback = '/onboarding',
): string {
  if (typeof value !== 'string') return fallback;

  if (
    value === '/onboarding' ||
    value === '/update-password' ||
    invitePathPattern.test(value) ||
    appPathPattern.test(value)
  ) {
    return value;
  }

  return fallback;
}
