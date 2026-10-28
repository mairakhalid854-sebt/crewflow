import { NextResponse } from 'next/server';

import { isUnsubscribeToken } from '../../../../lib/email/unsubscribe-token';
import { createClient } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };

// RFC 8058 one-click unsubscribe target named in the List-Unsubscribe header.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) {
    return new NextResponse(null, { headers: noStore, status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('unsubscribe_marketing_email', {
    unsubscribe_token: token,
  });
  if (error) return new NextResponse(null, { headers: noStore, status: 500 });
  return new NextResponse(null, {
    headers: noStore,
    status: data === true ? 200 : 404,
  });
}

// A plain visit is sent to the confirmation page instead of unsubscribing.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) {
    return new NextResponse(null, { headers: noStore, status: 404 });
  }
  return NextResponse.redirect(new URL(`/unsubscribe/${token}`, request.url), {
    headers: noStore,
    status: 303,
  });
}
