import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import type { MembershipRole, TenantContext } from '@crewflow/types';

export interface ActiveMembership {
  readonly id: string;
  readonly role: MembershipRole;
  readonly tenantId: string;
  readonly userId: string;
}

export interface MembershipRepository {
  findActiveByUserId(userId: string): Promise<readonly ActiveMembership[]>;
}

@Injectable()
export class TenantContextService {
  constructor(private readonly memberships: MembershipRepository) {}

  async resolveForUser(userId: string): Promise<TenantContext> {
    const activeMemberships = await this.memberships.findActiveByUserId(userId);

    if (activeMemberships.length === 0) {
      throw new ForbiddenException('No active company membership');
    }

    if (activeMemberships.length !== 1) {
      throw new InternalServerErrorException(
        'Single-company membership invariant violated',
      );
    }

    const membership = activeMemberships[0];
    if (!membership) {
      throw new InternalServerErrorException('Membership resolution failed');
    }

    return {
      actorUserId: userId,
      membershipId: membership.id,
      role: membership.role,
      tenantId: membership.tenantId,
    };
  }

  assertResourceTenant(context: TenantContext, resourceTenantId: string): void {
    if (context.tenantId !== resourceTenantId) {
      // Do not reveal whether a cross-tenant resource exists.
      throw new ForbiddenException('Resource is unavailable');
    }
  }
}
