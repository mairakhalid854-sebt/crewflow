import { describe, expect, it } from 'vitest';

import { publicWorkReportSchema } from './public-report';

describe('public work report', () => {
  it('accepts the intentionally public report projection', () => {
    expect(
      publicWorkReportSchema.safeParse({
        approved_at: '2026-10-15T20:00:00Z',
        company_name: 'CrewFlow HVAC',
        customer_name: 'Alex Morgan',
        job_title: 'Air conditioner repair',
        parts_used: 'One replacement capacitor',
        recommendations: 'Replace the air filter within 30 days.',
        report_id: '550e8400-e29b-41d4-a716-446655440000',
        scheduled_end_at: '2026-10-15T19:00:00Z',
        scheduled_start_at: '2026-10-15T18:00:00Z',
        sent_at: '2026-10-15T20:00:00Z',
        summary: 'Cooling restored and system tested.',
        work_performed: 'Diagnosed the failed capacitor and replaced it.',
      }).success,
    ).toBe(true);
  });

  it('rejects missing customer-safe fields', () => {
    expect(
      publicWorkReportSchema.safeParse({ summary: 'Incomplete' }).success,
    ).toBe(false);
  });
});
