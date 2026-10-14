import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '../../../lib/supabase/server';
import { safeNextPath } from '../../../lib/auth/safe-next-path';
import { invitationTokenFromNextPath } from '../../../lib/auth/invitation-url';

async function finishAuthentication(
  supabase: Awaited<ReturnType<typeof createClient>>,
  next: string,
  request: NextRequest,
) {
  const invitationToken = invitationTokenFromNextPath(next);
  if (invitationToken) {
    const { error } = await supabase.rpc('accept_team_invitation', {
      invitation_token: invitationToken,
    });
    if (!error) return NextResponse.redirect(new URL('/app', request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return finishAuthentication(supabase, next, request);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) return finishAuthentication(supabase, next, request);
  }

  return NextResponse.redirect(
    new URL('/forgot-password?error=invalid_or_expired_link', request.url),
  );
}
