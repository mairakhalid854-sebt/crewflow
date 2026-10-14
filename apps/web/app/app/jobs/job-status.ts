import type { Database } from '@crewflow/database';

export type JobStatus = Database['public']['Enums']['job_status'];

export const jobStatusLabels: Readonly<Record<JobStatus, string>> = {
  accepted: 'Accepted',
  cancelled: 'Cancelled',
  closed: 'Closed',
  completed: 'Completed',
  in_progress: 'In progress',
  new: 'New',
  quoted: 'Quoted',
  scheduled: 'Scheduled',
};

export const nextJobStatuses: Readonly<
  Record<JobStatus, readonly JobStatus[]>
> = {
  accepted: ['scheduled', 'cancelled'],
  cancelled: [],
  closed: [],
  completed: ['closed'],
  in_progress: ['completed', 'cancelled'],
  new: ['quoted', 'cancelled'],
  quoted: ['accepted', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
};
