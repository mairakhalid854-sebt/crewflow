import { describe, expect, it } from 'vitest';

import { humanize, proposedChangeLines } from './ai-presenters';

describe('AI operations presenters', () => {
  it('makes machine labels readable', () => {
    expect(humanize('dispatcher.assignment_proposed')).toBe(
      'dispatcher › assignment proposed',
    );
  });

  it('flattens nested exact changes without emitting JSON markup', () => {
    expect(
      proposedChangeLines({
        assignment: { technician: 'Hiba', urgent: true },
        slots: ['9:00 AM', '11:00 AM'],
      }),
    ).toEqual([
      { path: 'assignment.technician', value: 'Hiba' },
      { path: 'assignment.urgent', value: 'Yes' },
      { path: 'slots[1]', value: '9:00 AM' },
      { path: 'slots[2]', value: '11:00 AM' },
    ]);
  });

  it('bounds unusually large change sets', () => {
    const lines = proposedChangeLines(
      Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [`field${index}`, index]),
      ),
      10,
    );
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toEqual({
      path: 'More changes',
      value: 'Open the audit trace for the complete bounded payload.',
    });
  });
});
