import { mergeSkills } from './skills';
import type { createClient } from './supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Every skill any team member already has, for the service form. */
export async function teamSkillSuggestions(
  supabase: ServerClient,
  tenantId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('staff_profiles')
    .select('skills')
    .eq('tenant_id', tenantId);
  return mergeSkills(
    [],
    (data ?? []).flatMap((profile) => profile.skills),
  );
}

/** Every skill an active service requires, for the technician form. */
export async function serviceSkillSuggestions(
  supabase: ServerClient,
  tenantId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('services')
    .select('required_skills')
    .eq('tenant_id', tenantId)
    .is('archived_at', null);
  return mergeSkills(
    [],
    (data ?? []).flatMap((service) => service.required_skills),
  );
}
