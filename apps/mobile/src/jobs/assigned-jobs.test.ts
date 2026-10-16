import { describe, expect, it } from 'vitest';

import type { AssignedJob } from './assigned-jobs';
import {
  formatCustomerAddress,
  formatJobSchedule,
  partitionAssignedJobs,
  technicianProgressAction,
  validateProgressNote,
} from './assigned-jobs';

function job(overrides: Partial<AssignedJob> = {}): AssignedJob {
  return {
    customers: {
      address_line_2: null,
      city: 'Austin',
      first_name: 'Alex',
      last_name: 'Morgan',
      phone: null,
      postal_code: '78701',
      state_code: 'TX',
      street_address: '100 Main St',
    },
    description: null,
    id: 'job-1',
    priority: 'normal',
    scheduled_end_at: '2026-10-15T17:00:00.000Z',
    scheduled_start_at: '2026-10-15T16:00:00.000Z',
    services: { name: 'Inspection' },
    job_work_notes: [],
    status: 'scheduled',
    title: 'Fall inspection',
    updated_at: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('assigned jobs', () => {
  it('groups active work separately from history and sorts each group', () => {
    const result = partitionAssignedJobs([
      job({ id: 'later', scheduled_start_at: '2026-10-16T16:00:00.000Z' }),
      job({ id: 'completed', status: 'completed' }),
      job({ id: 'sooner' }),
      job({
        id: 'cancelled',
        status: 'cancelled',
        updated_at: '2026-10-16T12:00:00.000Z',
      }),
    ]);

    expect(result.upcoming.map((item) => item.id)).toEqual(['sooner', 'later']);
    expect(result.history.map((item) => item.id)).toEqual([
      'cancelled',
      'completed',
    ]);
  });

  it('formats schedules in the business time zone', () => {
    expect(formatJobSchedule(job(), 'America/Chicago')).toBe(
      'Thu, Oct 15, 11:00 AM-12:00 PM',
    );
    expect(
      formatJobSchedule(
        job({ scheduled_end_at: null, scheduled_start_at: null }),
        'America/Chicago',
      ),
    ).toBe('Unscheduled');
  });

  it('builds a compact US service address', () => {
    expect(formatCustomerAddress(job().customers)).toBe(
      '100 Main St, Austin TX 78701',
    );
    expect(formatCustomerAddress(null)).toBeUndefined();
  });

  it('offers only the guarded technician start and completion actions', () => {
    expect(technicianProgressAction('scheduled')).toEqual({
      label: 'Start job',
      noteRequired: false,
      status: 'in_progress',
    });
    expect(technicianProgressAction('in_progress')).toEqual({
      label: 'Complete job',
      noteRequired: true,
      status: 'completed',
    });
    expect(technicianProgressAction('completed')).toBeUndefined();
    expect(technicianProgressAction('accepted')).toBeUndefined();
  });

  it('requires a useful completion note and caps all field notes', () => {
    const start = technicianProgressAction('scheduled');
    const complete = technicianProgressAction('in_progress');
    if (!start || !complete) throw new Error('Expected technician actions.');

    expect(validateProgressNote('', start)).toBeUndefined();
    expect(validateProgressNote('ok', start)).toBe(
      'Work note must be at least 3 characters or left blank.',
    );
    expect(validateProgressNote('', complete)).toBe(
      'Add a short completion note before completing this job.',
    );
    expect(
      validateProgressNote('Resolved the issue.', complete),
    ).toBeUndefined();
    expect(validateProgressNote('a'.repeat(2001), start)).toBe(
      'Work note cannot exceed 2,000 characters.',
    );
  });
});
