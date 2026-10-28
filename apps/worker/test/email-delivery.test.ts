import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type ClaimedEmailDelivery,
  buildResendEmail,
  classifyResendResponse,
  idempotencyKey,
  parseAppOrigin,
  parseSenderAddress,
  prepareMarketingEmail,
  renderLinkedBody,
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

describe('transactional email links', () => {
  const token = 'a'.repeat(64);

  it('accepts only a bare HTTPS origin', () => {
    expect(parseAppOrigin('https://app.crewflow.example/')).toBe(
      'https://app.crewflow.example',
    );
    expect(parseAppOrigin('http://app.crewflow.example')).toBeNull();
    expect(parseAppOrigin('https://app.crewflow.example/path')).toBeNull();
    expect(parseAppOrigin('https://user:pass@app.crewflow.example')).toBeNull();
    expect(parseAppOrigin('https://app.crewflow.example/?next=x')).toBeNull();
    expect(parseAppOrigin('not a url')).toBeNull();
    expect(parseAppOrigin(undefined)).toBeNull();
  });

  it('joins only known link paths to the trusted origin', () => {
    const origin = 'https://app.crewflow.example';
    expect(
      renderLinkedBody('Open {{link}} now.', origin, `/quote/${token}`),
    ).toBe(`Open ${origin}/quote/${token} now.`);
    expect(
      renderLinkedBody('{{link}}', origin, `/signup?next=%2Finvite%2F${token}`),
    ).toBe(`${origin}/signup?next=%2Finvite%2F${token}`);
    expect(renderLinkedBody('{{link}}', origin, `/report/${token}`)).toBe(
      `${origin}/report/${token}`,
    );
    expect(
      renderLinkedBody('{{link}}', origin, `//evil.example/${token}`),
    ).toBeNull();
    expect(renderLinkedBody('{{link}}', origin, '/quote/short')).toBeNull();
  });

  it('requires exactly one placeholder', () => {
    const origin = 'https://app.crewflow.example';
    expect(renderLinkedBody('no link', origin, `/invoice/${token}`)).toBeNull();
    expect(
      renderLinkedBody('{{link}} {{link}}', origin, `/invoice/${token}`),
    ).toBeNull();
  });

  it('passes link-free job emails through unchanged', () => {
    const origin = 'https://app.crewflow.example';
    expect(
      renderLinkedBody('Your appointment is confirmed.', origin, null),
    ).toBe('Your appointment is confirmed.');
    expect(renderLinkedBody('Open {{link}}', origin, null)).toBeNull();
  });

  it('prefixes idempotency keys per queue', () => {
    expect(idempotencyKey(delivery, 'transactional')).toBe(
      'transactional-77000000-0000-4000-8000-000000000001',
    );
  });
});

describe('marketing email compliance', () => {
  const origin = 'https://app.crewflow.example';
  const token = `44000000-0000-4000-8000-000000000002.${'f'.repeat(64)}`;
  const address = '12 Main St, Austin, TX 78701, US';

  it('adds the opt-out link, postal address, and one-click headers', () => {
    const prepared = prepareMarketingEmail(
      'Please review us.',
      origin,
      token,
      address,
      'Sparkle Cleaning',
    );
    expect(prepared?.text).toBe(
      'Please review us.\n\n--\n' +
        'You are receiving this because you agreed to hear from Sparkle Cleaning.\n' +
        `Unsubscribe: ${origin}/unsubscribe/${token}\n` +
        `Sparkle Cleaning, ${address}`,
    );
    expect(prepared?.headers).toEqual({
      'List-Unsubscribe': `<${origin}/api/unsubscribe/${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('refuses to build a marketing email without its required parts', () => {
    expect(
      prepareMarketingEmail('x', origin, null, address, 'Sparkle'),
    ).toBeNull();
    expect(
      prepareMarketingEmail('x', origin, 'not-a-token', address, 'Sparkle'),
    ).toBeNull();
    expect(
      prepareMarketingEmail('x', origin, token, null, 'Sparkle'),
    ).toBeNull();
    expect(
      prepareMarketingEmail('x', origin, token, 'TX', 'Sparkle'),
    ).toBeNull();
  });

  it('flattens control characters in footer values', () => {
    const prepared = prepareMarketingEmail(
      'x',
      origin,
      token,
      '12 Main St\r\nBcc: victim@example.com',
      'Sparkle\nCleaning',
    );
    expect(prepared?.text).toContain(
      'Sparkle Cleaning, 12 Main St Bcc: victim@example.com',
    );
    expect(prepared?.text.split('\n')).toHaveLength(6);
  });

  it('passes custom headers through to the provider payload', () => {
    const payload = buildResendEmail(
      delivery,
      'notify@send.example.com',
      'follow_up_marketing',
      { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    );
    expect(payload.headers).toEqual({
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(payload.tags).toEqual([
      { name: 'category', value: 'follow_up_marketing' },
    ]);
  });
});
