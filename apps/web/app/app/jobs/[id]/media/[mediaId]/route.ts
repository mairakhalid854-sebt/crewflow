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
    .select('storage_path')
    .eq('id', mediaId)
    .eq('job_id', id)
    .eq('tenant_id', context.tenantId)
    .not('uploaded_at', 'is', null)
    .maybeSingle();

  if (error) throw new Error('Job photo could not be loaded.');
  if (!media) return new Response(null, { status: 404 });

  const { data: signedPhoto, error: signedUrlError } = await supabase.storage
    .from('job-media')
    .createSignedUrl(media.storage_path, 60);
  if (signedUrlError || !signedPhoto)
    return new Response(null, { status: 404 });

  return new Response(null, {
    headers: {
      'Cache-Control': 'private, no-store',
      Location: signedPhoto.signedUrl,
      'Referrer-Policy': 'no-referrer',
    },
    status: 307,
  });
}
