import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type ClaimedEmailDelivery,
  buildResendEmail,
  classifyResendResponse,
  idempotencyKey,
  parseSenderAddress,
  suppressionsFromWebhookEvent,
  verifyResendWebhook,
} from '../../../supabase/functions/_shared/email-delivery.js';

const delivery: ClaimedEmailDelivery = {
  message_id: '77000000-0000-4000-8000-000000000001',
  lease_token: '88000000-0000-4000-8000-000000000001',
  to_email: 'customer@example.com',
  subject: 'Invoice 1 is overdue',
  body: 'Your invoice is three days past due.',
  sender_name: 'Sparkle "Cleaning" <Co>',
  reply_to_email: 'Office@Sparkle.test',
};

const secretBytes = Buffer.from('crewflow-test-webhook-secret-bytes');
const secret = `whsec_${secretBytes.toString('base64')}`;

function sign(id: string, timestamp: string, body: string): string {
  return createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
}

describe('Resend email payloads', () => {
  it('accepts only a bare sender address', () => {
    expect(parseSenderAddress(' Notifications@Send.Example.com ')).toBe(
      'notifications@send.example.com',
    );
    expect(parseSenderAddress('CrewFlow <a@b.com>')).toBeNull();
    expect(parseSenderAddress(undefined)).toBeNull();
  });

  it('sanitizes the tenant display name and sets the business reply-to', () => {
    expect(buildResendEmail(delivery, 'notify@send.example.com')).toEqual({
      from: '"Sparkle Cleaning Co via CrewFlow" <notify@send.example.com>',
      to: ['customer@example.com'],
      subject: 'Invoice 1 is overdue',
      text: 'Your invoice is three days past due.',
      reply_to: 'office@sparkle.test',
      tags: [{ name: 'category', value: 'follow_up_transactional' }],
    });
  });

  it('falls back to the CrewFlow name and omits an invalid reply-to', () => {
    const payload = buildResendEmail(
      { ...delivery, sender_name: '\r\n', reply_to_email: 'not-an-email' },
      'notify@send.example.com',
    );
    expect(payload.from).toBe('"CrewFlow" <notify@send.example.com>');
    expect(payload).not.toHaveProperty('reply_to');
  });

  it('derives a stable idempotency key per message', () => {
    expect(idempotencyKey(delivery)).toBe(
      'follow-up-77000000-0000-4000-8000-000000000001',
    );
  });
});

describe('Resend response classification', () => {
  it('completes only with a bounded provider id', () => {
    expect(classifyResendResponse(200, { id: 're_123-abc' })).toEqual({
      outcome: 'sent',
      providerMessageId: 're_123-abc',
    });
    expect(classifyResendResponse(200, { id: 'bad id' })).toEqual({
      outcome: 'retry',
      errorCode: 'resend_invalid_response',
    });
  });

  it('fails permanently only for rejected requests', () => {
    expect(classifyResendResponse(422, null).outcome).toBe('failed');
    expect(classifyResendResponse(400, null).outcome).toBe('failed');
    expect(classifyResendResponse(403, null)).toEqual({
      outcome: 'retry',
      errorCode: 'resend_http_403',
    });
    expect(classifyResendResponse(429, null).outcome).toBe('retry');
    expect(classifyResendResponse(503, null).outcome).toBe('retry');
  });
});

describe('Resend webhook verification', () => {
  const body = '{"type":"email.bounced"}';
  const id = 'msg_2abc';
  const now = 1_793_000_000;
  const timestamp = String(now);

  it('accepts a valid signature among several', async () => {
    await expect(
      verifyResendWebhook(
        body,
        {
          id,
          timestamp,
          signature: `v1,${Buffer.from('wrong').toString('base64')} v1,${sign(id, timestamp, body)}`,
        },
        secret,
        now,
      ),
    ).resolves.toBe(true);
  });

  it('rejects tampering, stale timestamps, and missing secrets', async () => {
    const signature = `v1,${sign(id, timestamp, body)}`;
    await expect(
      verifyResendWebhook(
        `${body} `,
        { id, timestamp, signature },
        secret,
        now,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyResendWebhook(
        body,
        { id, timestamp, signature },
        secret,
        now + 301,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyResendWebhook(body, { id, timestamp, signature }, undefined, now),
    ).resolves.toBe(false);
    await expect(
      verifyResendWebhook(
        body,
        { id, timestamp, signature: signature.replace('v1,', 'v2,') },
        secret,
        now,
      ),
    ).resolves.toBe(false);
  });
});

describe('webhook suppression mapping', () => {
  it('suppresses permanent bounces and complaints only', () => {
    expect(
      suppressionsFromWebhookEvent({
        type: 'email.bounced',
        data: {
          to: ['A@Example.com', 'a@example.com', 'junk'],
          bounce: { type: 'Permanent' },
        },
      }),
    ).toEqual([{ email: 'a@example.com', reason: 'hard_bounce' }]);
    expect(
      suppressionsFromWebhookEvent({
        type: 'email.complained',
        data: { to: ['b@example.com'] },
      }),
    ).toEqual([{ email: 'b@example.com', reason: 'complaint' }]);
    expect(
      suppressionsFromWebhookEvent({
        type: 'email.bounced',
        data: { to: ['c@example.com'], bounce: { type: 'Transient' } },
      }),
    ).toEqual([]);
    expect(
      suppressionsFromWebhookEvent({
        type: 'email.delivered',
        data: { to: ['d@example.com'] },
      }),
    ).toEqual([]);
  });
});
