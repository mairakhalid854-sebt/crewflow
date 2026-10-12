import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  type ActiveMembership,
  type MembershipRepository,
  TenantContextService,
} from '../src/tenancy/tenant-context.service.js';

class FakeMembershipRepository implements MembershipRepository {
  constructor(private readonly rows: readonly ActiveMembership[]) {}

  findActiveByUserId(userId: string): Promise<readonly ActiveMembership[]> {
    return Promise.resolve(
      this.rows.filter((membership) => membership.userId === userId),
    );
  }
}

const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const userA = '10000000-0000-4000-8000-000000000001';

function membership(
  overrides: Partial<ActiveMembership> = {},
): ActiveMembership {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    role: 'owner',
    tenantId: tenantA,
    userId: userA,
    ...overrides,
  };
}

describe('TenantContextService', () => {
  it('derives tenant context from the active membership', async () => {
    const service = new TenantContextService(
      new FakeMembershipRepository([membership()]),
    );

    await expect(service.resolveForUser(userA)).resolves.toEqual({
      actorUserId: userA,
      membershipId: '20000000-0000-4000-8000-000000000001',
      role: 'owner',
      tenantId: tenantA,
    });
  });

  it('rejects a user without an active company membership', async () => {
    const service = new TenantContextService(new FakeMembershipRepository([]));

    await expect(service.resolveForUser(userA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails closed if the v1 single-company invariant is violated', async () => {
    const service = new TenantContextService(
      new FakeMembershipRepository([
        membership(),
        membership({
          id: '20000000-0000-4000-8000-000000000002',
          tenantId: tenantB,
        }),
      ]),
    );

    await expect(service.resolveForUser(userA)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('blocks a guessed resource ID belonging to another tenant', async () => {
    const service = new TenantContextService(
      new FakeMembershipRepository([membership()]),
    );
    const context = await service.resolveForUser(userA);

    expect(() => service.assertResourceTenant(context, tenantB)).toThrow(
      ForbiddenException,
    );
    expect(() => service.assertResourceTenant(context, tenantA)).not.toThrow();
  });
});
