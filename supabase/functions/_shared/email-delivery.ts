export const EMAIL_BATCH_SIZE = 10;
export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const EMAIL_PATTERN = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

export interface ClaimedEmailDelivery {
  readonly message_id: string;
  readonly lease_token: string;
  readonly to_email: string;
  readonly subject: string;
  readonly body: string;
  readonly sender_name: string | null;
  readonly reply_to_email: string | null;
}

export interface ResendEmailPayload {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly reply_to?: string;
  readonly tags: readonly { readonly name: string; readonly value: string }[];
}

export type DeliveryOutcome =
  | { readonly outcome: 'sent'; readonly providerMessageId: string }
  | {
      readonly outcome: 'retry' | 'failed';
      readonly errorCode: string;
    };

export interface ProviderSuppression {
  readonly email: string;
  readonly reason: 'hard_bounce' | 'complaint';
}

function validEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 3 &&
    value.length <= 320 &&
    EMAIL_PATTERN.test(value)
  );
}

/** Returns the bare sending address from `CREWFLOW_EMAIL_FROM_ADDRESS`. */
export function parseSenderAddress(value: string | undefined): string | null {
  const address = value?.trim().toLowerCase();
  return validEmail(address) ? address : null;
}

function displayName(value: string | null): string {
  const cleaned = (value ?? '')
    .replace(/["<>\\\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned.length > 0 ? `${cleaned} via CrewFlow` : 'CrewFlow';
}

export function buildResendEmail(
  delivery: ClaimedEmailDelivery,
  senderAddress: string,
  category = 'follow_up_transactional',
): ResendEmailPayload {
  const replyTo = delivery.reply_to_email?.trim().toLowerCase();
  return {
    from: `"${displayName(delivery.sender_name)}" <${senderAddress}>`,
    to: [delivery.to_email],
    subject: delivery.subject,
    text: delivery.body,
    ...(validEmail(replyTo) ? { reply_to: replyTo } : {}),
    tags: [{ name: 'category', value: category }],
  };
}

/** Resend retries are safe because every send carries this idempotency key. */
export function idempotencyKey(
  delivery: ClaimedEmailDelivery,
  prefix = 'follow-up',
): string {
  return `${prefix}-${delivery.message_id}`;
}

/**
 * Returns the trusted HTTPS origin from `CREWFLOW_WEB_APP_URL`. Links in
 * queued email are relative paths joined to this origin at send time, so
 * stored content can never point recipients at another host.
 */
export function parseAppOrigin(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    return null;
  }
  return url.origin;
}

const LINK_PATH_PATTERN =
  /^\/(quote\/|invoice\/|signup\?next=%2Finvite%2F)[0-9a-f]{64}$/;

/** Substitutes the single `{{link}}` placeholder with an absolute URL. */
export function renderLinkedBody(
  body: string,
  origin: string,
  linkPath: string,
): string | null {
  if (!LINK_PATH_PATTERN.test(linkPath)) return null;
  const parts = body.split('{{link}}');
  if (parts.length !== 2) return null;
  return `${parts[0]}${origin}${linkPath}${parts[1]}`;
}

export function classifyResendResponse(
  status: number,
  body: unknown,
): DeliveryOutcome {
  if (status >= 200 && status < 300) {
    const id = (body as { id?: unknown } | null)?.id;
    return typeof id === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(id)
      ? { outcome: 'sent', providerMessageId: id }
      : { outcome: 'retry', errorCode: 'resend_invalid_response' };
  }
  // Malformed requests and rejected recipients will never succeed. Credential
  // and domain errors (401/403) are operator-fixable, so they retry with
  // backoff instead of failing every queued message immediately.
  if (status === 400 || status === 422) {
    return { outcome: 'failed', errorCode: `resend_http_${status}` };
  }
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return { outcome: 'retry', errorCode: `resend_http_${status}` };
  }
  return { outcome: 'retry', errorCode: 'resend_invalid_response' };
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Verifies a Resend (Svix) webhook: HMAC-SHA256 over `id.timestamp.body` with
 * the base64 key after the `whsec_` prefix, within a bounded clock window.
 */
export async function verifyResendWebhook(
  rawBody: string,
  headers: {
    readonly id: string | null;
    readonly timestamp: string | null;
    readonly signature: string | null;
  },
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret?.startsWith('whsec_') || !id || !timestamp || !signature) {
    return false;
  }
  if (
    id.length > 200 ||
    signature.length > 2000 ||
    !/^\d{1,12}$/.test(timestamp)
  ) {
    return false;
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64ToBytes(secret.slice('whsec_'.length));
  } catch {
    return false;
  }
  if (keyBytes.length === 0) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
    ),
  );

  for (const candidate of signature.split(' ')) {
    const [version, value] = candidate.split(',', 2);
    if (version !== 'v1' || !value) continue;
    let supplied: Uint8Array;
    try {
      supplied = base64ToBytes(value);
    } catch {
      continue;
    }
    if (constantTimeEqual(supplied, expected)) return true;
  }
  return false;
}

/** Maps a verified webhook event to recipients that must be suppressed. */
export function suppressionsFromWebhookEvent(
  event: unknown,
): ProviderSuppression[] {
  const value = event as {
    type?: unknown;
    data?: { to?: unknown; bounce?: { type?: unknown } };
  } | null;
  let reason: ProviderSuppression['reason'];
  if (value?.type === 'email.complained') {
    reason = 'complaint';
  } else if (value?.type === 'email.bounced') {
    const bounceType = value.data?.bounce?.type;
    // Transient bounces (mailbox full, greylisting) must not suppress.
    if (bounceType !== undefined && bounceType !== 'Permanent') return [];
    reason = 'hard_bounce';
  } else {
    return [];
  }

  const recipients = Array.isArray(value.data?.to) ? value.data.to : [];
  const emails = new Set<string>();
  for (const recipient of recipients.slice(0, 50)) {
    const email =
      typeof recipient === 'string' ? recipient.trim().toLowerCase() : '';
    if (validEmail(email)) emails.add(email);
  }
  return [...emails].map((email) => ({ email, reason }));
}
