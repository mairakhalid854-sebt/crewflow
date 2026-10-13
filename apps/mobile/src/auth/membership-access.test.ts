import { describe, expect, it } from 'vitest';

import {
  type MobileMembership,
  resolveMembershipAccess,
} from './membership-access';

function membership(
  overrides: Partial<MobileMembership> = {},
): MobileMembership {
  return {
    role: 'technician',
    status: 'active',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ...overrides,
  };
}

describe('resolveMembershipAccess', () => {
  it.each(['owner', 'office', 'technician'] as const)(
    'allows an active %s membership',
    (role) => {
      const access = resolveMembershipAccess([membership({ role })]);

      expect(access.allowed).toBe(true);
      if (access.allowed) expect(access.membership.role).toBe(role);
    },
  );

  it('rejects invited and deactivated memberships', () => {
    expect(
      resolveMembershipAccess([
        membership({ status: 'invited' }),
        membership({ status: 'deactivated' }),
      ]),
    ).toEqual({ allowed: false, reason: 'inactive' });
  });

  it('fails closed if the one-active-tenant invariant is violated', () => {
    expect(
      resolveMembershipAccess([
        membership(),
        membership({ tenant_id: 'tenant-2' }),
      ]),
    ).toEqual({ allowed: false, reason: 'multiple_active_memberships' });
  });
});
