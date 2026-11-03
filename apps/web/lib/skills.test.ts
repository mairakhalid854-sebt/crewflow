import { describe, expect, it } from 'vitest';

import { mergeSkills, missingSkills } from './skills';

describe('missingSkills', () => {
  it('matches skills ignoring case and spaces, like the database rule', () => {
    expect(
      missingSkills(['Pipe repair', 'Gas line'], ['  pipe REPAIR ', 'HVAC']),
    ).toEqual(['Gas line']);
  });

  it('returns nothing when the service has no requirements', () => {
    expect(missingSkills([], ['HVAC'])).toEqual([]);
  });

  it('lists every requirement for a technician with no skills', () => {
    expect(missingSkills(['Plumbing', 'Drains'], [])).toEqual([
      'Plumbing',
      'Drains',
    ]);
  });
});

describe('mergeSkills', () => {
  it('adds only skills that are not already present', () => {
    expect(
      mergeSkills(['Plumbing'], ['plumbing', 'Drains', ' Drains ']),
    ).toEqual(['Plumbing', 'Drains']);
  });
});
