'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '../../../lib/supabase/server';

const tokenPattern = /^[0-9a-f]{64}$/;

export async function decideQuoteAction(
  token: string,
  decision: 'accepted' | 'declined',
): Promise<void> {
  if (!tokenPattern.test(token)) redirect('/quote/unavailable');

  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_public_quote', {
    quote_decision: decision,
    quote_token: token,
  });
  if (error) {
    const message = error.message.toLowerCase();
    const reason = message.includes('expired')
      ? 'expired'
      : message.includes('already decided')
        ? 'decided'
        : 'unavailable';
    redirect(`/quote/${token}?error=${reason}`);
  }

  revalidatePath(`/quote/${token}`);
  redirect(`/quote/${token}?result=${decision}`);
}
