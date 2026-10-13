'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export interface PersonalProfileActionState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
});

export async function updatePersonalProfileAction(
  _previousState: PersonalProfileActionState,
  formData: FormData,
): Promise<PersonalProfileActionState> {
  const parsed = profileSchema.safeParse({
    fullName: formData.get('fullName'),
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: 'Please correct the highlighted profile details.',
      status: 'error',
    };
  }

  await requireTenantContext();
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { full_name: parsed.data.fullName },
  });

  if (error) {
    return {
      message: 'Your profile could not be updated. Please try again.',
      status: 'error',
    };
  }

  revalidatePath('/app', 'layout');
  revalidatePath('/app/profile');
  revalidatePath('/app/team');
  return { message: 'Your profile has been updated.', status: 'success' };
}
