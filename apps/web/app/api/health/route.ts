import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      service: 'crewflow-web',
      status: 'ok',
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
      status: 200,
    },
  );
}
