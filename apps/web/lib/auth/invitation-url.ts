export function invitationSignupUrl(
  baseUrl: string,
  invitationToken: string,
): string {
  const nextPath = `/invite/${invitationToken}`;
  return `${baseUrl.replace(/\/$/, '')}/signup?next=${encodeURIComponent(nextPath)}`;
}

export function invitationTokenFromNextPath(nextPath: string): string | null {
  const match = /^\/invite\/([0-9a-f]{64})$/.exec(nextPath);
  return match?.[1] ?? null;
}
