'use server';

import { redirect } from 'next/navigation';

import { isUnsubscribeToken } from '../../../lib/email/unsubscribe-token';
import { createClient } from '../../../lib/supabase/server';

export async function unsubscribeAction(token: string): Promise<void> {
  if (!isUnsubscribeToken(token)) redirect('/unsubscribe/invalid');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('unsubscribe_marketing_email', {
    unsubscribe_token: token,
  });
  redirect(
    `/unsubscribe/${token}?result=${!error && data === true ? 'done' : 'error'}`,
  );
}
