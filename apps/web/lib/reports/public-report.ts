import { z } from 'zod';

export const publicWorkReportSchema = z.object({
  approved_at: z.string(),
  company_name: z.string(),
  customer_name: z.string(),
  job_title: z.string(),
  parts_used: z.string().nullable(),
  recommendations: z.string().nullable(),
  report_id: z.uuid(),
  scheduled_end_at: z.string().nullable(),
  scheduled_start_at: z.string().nullable(),
  sent_at: z.string(),
  summary: z.string(),
  work_performed: z.string(),
});

export type PublicWorkReport = z.infer<typeof publicWorkReportSchema>;
