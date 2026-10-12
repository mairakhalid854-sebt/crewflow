import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@crewflow/database';

import { getSupabasePublicConfig } from './config';

export function createClient() {
  const { publishableKey, url } = getSupabasePublicConfig();

  return createBrowserClient<Database>(url, publishableKey);
}
