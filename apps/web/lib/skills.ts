/** Same rule as the database dispatch check: trimmed, case-insensitive. */
export function normalizeSkill(skill: string): string {
  return skill.trim().toLocaleLowerCase('en-US');
}

/** Required skills the technician does not have, in the service's order. */
export function missingSkills(
  requiredSkills: readonly string[],
  technicianSkills: readonly string[],
): string[] {
  const held = new Set(technicianSkills.map(normalizeSkill));
  return requiredSkills.filter(
    (skill) => skill.trim() && !held.has(normalizeSkill(skill)),
  );
}

/** Adds skills that are not already present, ignoring case. */
export function mergeSkills(
  existing: readonly string[],
  additions: readonly string[],
): string[] {
  const merged = [...existing];
  const seen = new Set(existing.map(normalizeSkill));
  for (const skill of additions) {
    const trimmed = skill.trim();
    if (!trimmed || seen.has(normalizeSkill(trimmed))) continue;
    seen.add(normalizeSkill(trimmed));
    merged.push(trimmed);
  }
  return merged;
}
