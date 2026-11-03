import { describe, expect, it } from 'vitest';

import {
  proposeDispatchAssignment,
  type DispatchJob,
  type DispatchTechnician,
} from '../src/ai/dispatcher-agent.js';

const tenantId = 'tenant-a';
const job: DispatchJob = {
  endsAt: '2026-10-26T16:00:00.000Z',
  id: 'job-1',
  requiredSkills: ['Gutter Cleaning'],
  servicePostalCode: '10901',
  startsAt: '2026-10-26T15:00:00.000Z',
  status: 'scheduled',
  tenantId,
};

function technician(
  membershipId: string,
  overrides: Partial<DispatchTechnician> = {},
): DispatchTechnician {
  return {
    active: true,
    assignments: [],
    availability: [
      {
        endsAt: '2026-10-26T22:00:00.000Z',
        startsAt: '2026-10-26T13:00:00.000Z',
      },
    ],
    membershipId,
    serviceAreaPostalCodes: ['10901'],
    skills: ['Gutter Cleaning'],
    tenantId,
    ...overrides,
  };
}

describe('deterministic Dispatcher policy', () => {
  it('chooses the eligible technician with the lowest supplied workload', () => {
    const busy = technician('tech-busy', {
      assignments: [
        {
          endsAt: '2026-10-26T15:00:00.000Z',
          jobId: 'earlier-job',
          startsAt: '2026-10-26T13:00:00.000Z',
          tenantId,
        },
      ],
    });
    const result = proposeDispatchAssignment(job, [busy, technician('tech-a')]);
    expect(result).toMatchObject({
      requiresHumanApproval: false,
      status: 'proposed',
      technicianMembershipId: 'tech-a',
    });
  });

  it('requires exact normalized skill and service-area matches', () => {
    const result = proposeDispatchAssignment(job, [
      technician('wrong-skill', { skills: ['HVAC'] }),
      technician('wrong-area', { serviceAreaPostalCodes: ['10001'] }),
    ]);
    expect(result.status).toBe('escalated');
    if (result.status === 'escalated') {
      expect(result.candidateRejections).toEqual([
        { membershipId: 'wrong-skill', reasons: ['missing_skill'] },
        { membershipId: 'wrong-area', reasons: ['outside_service_area'] },
      ]);
    }
  });

  it('rejects time off and overlapping assignments', () => {
    const unavailable = technician('unavailable', {
      availability: [
        {
          endsAt: '2026-10-26T14:00:00.000Z',
          startsAt: '2026-10-26T13:00:00.000Z',
        },
      ],
    });
    const conflicted = technician('conflicted', {
      assignments: [
        {
          endsAt: '2026-10-26T15:30:00.000Z',
          jobId: 'job-2',
          startsAt: '2026-10-26T14:30:00.000Z',
          tenantId,
        },
      ],
    });
    const result = proposeDispatchAssignment(job, [unavailable, conflicted]);
    expect(result.status).toBe('escalated');
    if (result.status === 'escalated') {
      expect(result.candidateRejections[0]?.reasons).toContain(
        'outside_availability',
      );
      expect(result.candidateRejections[1]?.reasons).toContain(
        'schedule_conflict',
      );
    }
  });

  it('allows back-to-back work because endpoints do not overlap', () => {
    const result = proposeDispatchAssignment(job, [
      technician('back-to-back', {
        assignments: [
          {
            endsAt: job.startsAt,
            jobId: 'job-before',
            startsAt: '2026-10-26T14:00:00.000Z',
            tenantId,
          },
        ],
      }),
    ]);
    expect(result.status).toBe('proposed');
  });

  it('escalates invalid schedule and service ZIP inputs', () => {
    expect(
      proposeDispatchAssignment({ ...job, endsAt: job.startsAt }, []),
    ).toMatchObject({ status: 'escalated' });
    expect(
      proposeDispatchAssignment({ ...job, servicePostalCode: 'bad' }, []),
    ).toMatchObject({ status: 'escalated' });
  });

  it('fails closed when input mixes tenant records', () => {
    const result = proposeDispatchAssignment(job, [
      technician('foreign', { tenantId: 'tenant-b' }),
    ]);
    expect(result).toEqual({
      candidateRejections: [],
      escalationReason:
        'Dispatcher input contained records from a different workspace.',
      status: 'escalated',
    });
  });

  it('requires explicit human approval for in-progress reassignment', () => {
    const result = proposeDispatchAssignment(
      {
        ...job,
        assignedMembershipId: 'current-tech',
        status: 'in_progress',
      },
      [technician('new-tech')],
    );
    expect(result).toMatchObject({
      exactChanges: {
        assignedMembershipId: { from: 'current-tech', to: 'new-tech' },
      },
      requiresHumanApproval: true,
      status: 'proposed',
    });
  });

  it('returns unchanged when the best eligible technician is already assigned', () => {
    const result = proposeDispatchAssignment(
      { ...job, assignedMembershipId: 'tech-a' },
      [technician('tech-a')],
    );
    expect(result).toMatchObject({
      status: 'unchanged',
      technicianMembershipId: 'tech-a',
    });
  });
});
