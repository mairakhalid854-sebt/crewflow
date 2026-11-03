import type { Database, Json } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CUSTOMER_SIGNATURE_CONSENT,
  type SignatureStroke,
} from './job-signature-policy';

export async function recordAssignedJobSignature(
  client: SupabaseClient<Database>,
  jobId: string,
  signerName: string,
  strokes: readonly SignatureStroke[],
): Promise<void> {
  const signaturePayload: Json = strokes.map((stroke) =>
    stroke.map((point) => ({ x: point.x, y: point.y })),
  );
  const { error } = await client.rpc('record_assigned_job_signature', {
    accepted_consent_text: CUSTOMER_SIGNATURE_CONSENT,
    customer_signer_name: signerName.trim(),
    signature_strokes: signaturePayload,
    target_job_id: jobId,
  });

  if (error) {
    throw new Error(
      'Signature could not be recorded. Refresh the job and confirm it is still in progress.',
    );
  }
}
