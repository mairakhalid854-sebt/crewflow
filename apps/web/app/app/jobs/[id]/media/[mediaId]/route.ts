import { requireTenantContext } from '../../../../../../lib/auth/tenant-context';
import { createClient } from '../../../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  const context = await requireTenantContext();
  const supabase = await createClient();
  const { data: media, error } = await supabase
    .from('job_media')
    .select('content_type, media_kind, storage_path, uploaded_at')
    .eq('id', mediaId)
    .eq('job_id', id)
    .eq('tenant_id', context.tenantId)
    .not('uploaded_at', 'is', null)
    .maybeSingle();

  if (error) throw new Error('Job photo could not be loaded.');
  if (!media) return new Response(null, { status: 404 });

  const { data: photo, error: downloadError } = await supabase.storage
    .from('job-media')
    .download(media.storage_path);
  if (downloadError || !photo) return new Response(null, { status: 404 });

  return new Response(await photo.arrayBuffer(), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="${media.media_kind}-${mediaId}.jpg"`,
      'Content-Type': media.content_type,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
