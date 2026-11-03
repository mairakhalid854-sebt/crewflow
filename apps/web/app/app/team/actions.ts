'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Json } from '@crewflow/database';

import { appUrl } from '../../../lib/app-url';
import { invitationSignupUrl } from '../../../lib/auth/invitation-url';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { requestLinkEmail } from '../../../lib/email/link-email';
import { createClient } from '../../../lib/supabase/server';

export interface TeamActionState {
  readonly expiresAt?: string;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly inviteUrl?: string;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const invitationSchema = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  role: z.enum(['owner', 'office', 'technician']),
});
const membershipIdSchema = z.uuid();
const roleSchema = z.enum(['owner', 'office', 'technician']);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function failure(message: string): TeamActionState {
  return { message, status: 'error' };
}

function splitList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createInvitationAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const parsed = invitationSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: 'Please correct the invitation details.',
      status: 'error',
    };
  }

  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_team_invitation', {
    expiry_hours: 72,
    invitee_email: parsed.data.email,
    invitee_role: parsed.data.role,
  });
  const invitation = data?.[0];

  if (error || !invitation) {
    return failure(
      error?.code === '23505'
        ? 'That person is already an active team member.'
        : 'Invitation could not be created. Please try again.',
    );
  }

  const emailMessage =
    formData.get('emailLink') === 'on'
      ? ` ${await requestLinkEmail(
          supabase,
          'team_invitation',
          invitation.invitation_id,
          invitation.invitation_token,
        )}`
      : '';

  revalidatePath('/app/team');
  return {
    expiresAt: invitation.invitation_expires_at,
    inviteUrl: invitationSignupUrl(appUrl(), invitation.invitation_token),
    message: `Team signup link created. The invitee will choose a password, verify their email, and accept the invitation.${emailMessage}`,
    status: 'success',
  };
}

export async function revokeInvitationAction(
  formData: FormData,
): Promise<void> {
  const invitationId = membershipIdSchema.safeParse(
    formData.get('invitationId'),
  );
  if (!invitationId.success) return;

  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_team_invitation', {
    target_invitation_id: invitationId.data,
  });
  if (error) throw new Error('Invitation could not be revoked.');

  revalidatePath('/app/team');
}

export async function updateMemberRoleAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const membershipId = membershipIdSchema.safeParse(
    formData.get('membershipId'),
  );
  const role = roleSchema.safeParse(formData.get('role'));
  if (!membershipId.success || !role.success)
    return failure('Invalid team member or role.');

  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_team_member_role', {
    new_role: role.data,
    target_membership_id: membershipId.data,
  });
  if (error) {
    return failure(
      error.code === '23514'
        ? 'The workspace must keep at least one active owner.'
        : 'Role could not be updated.',
    );
  }

  revalidatePath('/app/team');
  return { message: 'Role updated.', status: 'success' };
}

export async function deactivateMemberAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const membershipId = membershipIdSchema.safeParse(
    formData.get('membershipId'),
  );
  if (!membershipId.success) return failure('Invalid team member.');

  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { error } = await supabase.rpc('deactivate_team_member', {
    target_membership_id: membershipId.data,
  });
  if (error) {
    return failure(
      error.code === '23514'
        ? 'You cannot deactivate yourself or the workspace’s last owner.'
        : 'Team member could not be deactivated.',
    );
  }

  revalidatePath('/app/team');
  return { message: 'Access deactivated immediately.', status: 'success' };
}

export async function updateStaffDetailsAction(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const membershipId = membershipIdSchema.safeParse(
    formData.get('membershipId'),
  );
  const fullName = z
    .string()
    .trim()
    .min(1, 'Enter a name.')
    .max(120)
    .safeParse(formData.get('fullName'));
  const skills = splitList(formData.get('skills'));
  const postalCodes = splitList(formData.get('postalCodes'));
  const notes = z
    .string()
    .trim()
    .max(1000, 'Availability notes cannot exceed 1,000 characters.')
    .safeParse(formData.get('availabilityNotes'));

  if (!membershipId.success || !fullName.success || !notes.success) {
    return failure('Please review the staff details and try again.');
  }
  if (skills.length > 30 || skills.some((skill) => skill.length > 80)) {
    return failure('Use at most 30 skills, each under 80 characters.');
  }
  if (
    postalCodes.length > 50 ||
    postalCodes.some((postalCode) => !/^\d{5}(-\d{4})?$/.test(postalCode))
  ) {
    return failure('Enter valid US ZIP codes separated by commas.');
  }

  const weeklySchedule: Json[] = [];
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    const isAvailable = formData.get(`available-${dayOfWeek}`) === 'on';
    const startsAt = formData.get(`starts-${dayOfWeek}`);
    const endsAt = formData.get(`ends-${dayOfWeek}`);

    if (isAvailable) {
      const parsedStart = timeSchema.safeParse(startsAt);
      const parsedEnd = timeSchema.safeParse(endsAt);
      if (
        !parsedStart.success ||
        !parsedEnd.success ||
        parsedStart.data >= parsedEnd.data
      ) {
        return failure('Each available day needs a valid start and end time.');
      }
      weeklySchedule.push({
        dayOfWeek,
        endsAt: parsedEnd.data,
        isAvailable,
        startsAt: parsedStart.data,
      });
    } else {
      weeklySchedule.push({ dayOfWeek, isAvailable });
    }
  }

  await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_staff_details', {
    staff_availability_notes: notes.data,
    staff_full_name: fullName.data,
    staff_service_area_postal_codes: postalCodes,
    staff_skills: skills,
    target_membership_id: membershipId.data,
    weekly_schedule: weeklySchedule,
  });
  if (error) return failure('Staff details could not be updated.');

  revalidatePath('/app/team');
  revalidatePath(`/app/team/${membershipId.data}`);
  return { message: 'Staff details updated.', status: 'success' };
}
