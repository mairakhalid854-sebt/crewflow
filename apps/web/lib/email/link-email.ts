import type { Database } from '@crewflow/database';

import type { createClient } from '../supabase/server';

export type LinkEmailKind =
  Database['public']['Enums']['transactional_email_kind'];

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Maps an enqueue outcome to the sentence appended after a publish. */
export function linkEmailMessage(
  error: { readonly code?: string; readonly message?: string } | null,
): string {
  if (!error) {
    return 'The link is also queued for email to the recipient.';
  }
  if (error.code === '22023' && error.message?.includes('cannot be emailed')) {
    return 'Email was not queued because the recipient has no deliverable email address or has opted out. Copy the link instead.';
  }
  return 'Email could not be queued. Copy the link instead.';
}

/**
 * Asks the database to email a just-issued link. The database verifies the
 * token, derives the recipient, and renders the message; failures never undo
 * the publish because the copyable link remains valid.
 */
export async function requestLinkEmail(
  supabase: ServerClient,
  kind: LinkEmailKind,
  entityId: string,
  linkToken: string,
): Promise<string> {
  const { error } = await supabase.rpc('enqueue_transactional_email', {
    link_token: linkToken,
    target_entity_id: entityId,
    target_kind: kind,
  });
  return linkEmailMessage(error);
}
