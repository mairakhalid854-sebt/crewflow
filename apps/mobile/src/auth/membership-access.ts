import type { Database } from '@crewflow/database';

type MembershipRow = Database['public']['Tables']['memberships']['Row'];

export type MobileMembership = Pick<
  MembershipRow,
  'role' | 'status' | 'tenant_id' | 'user_id'
>;

export type MembershipAccess =
  | { readonly allowed: true; readonly membership: MobileMembership }
  | {
      readonly allowed: false;
      readonly reason: 'inactive' | 'multiple_active_memberships';
    };

export function resolveMembershipAccess(
  memberships: readonly MobileMembership[],
): MembershipAccess {
  const active = memberships.filter(
    (membership) => membership.status === 'active',
  );

  if (active.length === 0) return { allowed: false, reason: 'inactive' };
  if (active.length > 1) {
    return { allowed: false, reason: 'multiple_active_memberships' };
  }

  return { allowed: true, membership: active[0]! };
}
