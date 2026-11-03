import { describe, expect, it } from 'vitest';

import {
  notificationDeepLinkFromData,
  parseCrewFlowDeepLink,
} from './push-notification-policy';

const jobId = '3f65f405-7ef4-4bb7-8ddd-fc2b81853a4e';
const approvalId = '03f9a6f0-cb51-4a30-9c7a-ce5549a0e615';

describe('push notification deep links', () => {
  it('parses authorized job and approval routes', () => {
    expect(parseCrewFlowDeepLink(`crewflow://jobs/${jobId}`)).toEqual({
      jobId,
      kind: 'job',
    });
    expect(
      parseCrewFlowDeepLink(`crewflow://approvals/report/${approvalId}`),
    ).toEqual({
      approvalId,
      approvalKind: 'report',
      kind: 'approval',
    });
  });

  it.each([
    undefined,
    null,
    123,
    'https://crewflow.example.com/jobs/3f65f405-7ef4-4bb7-8ddd-fc2b81853a4e',
    'crewflow://jobs/not-a-uuid',
    `crewflow://approvals/admin/${approvalId}`,
    `crewflow://approvals/quote/${approvalId}?token=secret`,
  ])('rejects an unsupported or malformed route', (value) => {
    expect(parseCrewFlowDeepLink(value)).toBeUndefined();
  });

  it('reads only the bounded deepLink payload field', () => {
    expect(
      notificationDeepLinkFromData({
        deepLink: `crewflow://approvals/invoice/${approvalId}`,
        ignored: 'value',
      }),
    ).toEqual({
      approvalId,
      approvalKind: 'invoice',
      kind: 'approval',
    });
    expect(notificationDeepLinkFromData({ deepLink: { nested: true } })).toBe(
      undefined,
    );
  });
});
