'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '../../../lib/supabase/server';

export interface AcceptInvitationState {
  readonly message?: string;
  readonly status: 'idle' | 'error';
}

const invitationTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'This invitation link is invalid.');

export async function acceptInvitationAction(
  _previousState: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const token = invitationTokenSchema.safeParse(formData.get('token'));
  if (!token.success) {
    return { message: 'This invitation link is invalid.', status: 'error' };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect(`/login?next=/invite/${token.data}`);

  const { error } = await supabase.rpc('accept_team_invitation', {
    invitation_token: token.data,
  });

  if (error) {
    const message =
      error.code === '23505'
        ? 'This account already belongs to an active CrewFlow workspace.'
        : 'This invitation is invalid, expired, revoked, or belongs to a different email address.';

    return { message, status: 'error' };
  }

  redirect('/app');
}
