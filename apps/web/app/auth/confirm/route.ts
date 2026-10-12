import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '../../../lib/supabase/server';
import { safeNextPath } from '../../../lib/auth/safe-next-path';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(
    new URL('/login?error=invalid_or_expired_link', request.url),
  );
}
