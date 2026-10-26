import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

const orchestrators = [
  {
    agent: 'dispatcher',
    migration: source(
      '../../../supabase/migrations/202610250004_phase6_dispatcher_orchestration.sql',
    ),
  },
  {
    agent: 'report',
    migration: source(
      '../../../supabase/migrations/202610250006_phase6_report_orchestration.sql',
    ),
  },
  {
    agent: 'report invoice',
    migration: source(
      '../../../supabase/migrations/202610250008_phase6_report_invoice_orchestration.sql',
    ),
  },
  {
    agent: 'follow-up',
    migration: source(
      '../../../supabase/migrations/202610250010_phase6_follow_up_orchestration.sql',
    ),
  },
] as const;

describe('FR-068 AI budget evaluation coverage', () => {
  it.each(orchestrators)(
    '$agent uses tenant and plan AI budget limits',
    ({ migration }) => {
      expect(migration).toContain('ai_monthly_budget_cents');
      expect(migration).toContain('ai_operations_enabled');
      expect(migration).toContain('ai_agent_runs');
    },
  );

  it('retains an executable exhausted-budget database fixture', () => {
    const integrationTest = source(
      '../../../supabase/tests/database/phase6_ai_governance.test.sql',
    );
    expect(integrationTest).toContain('SET ai_monthly_budget_cents = 0');
    expect(integrationTest).toContain('AI monthly budget exhausted');
  });

  it('retains pending-approval denial fixtures for every side-effecting agent', () => {
    const dispatcher = source(
      '../../../supabase/tests/database/phase6_dispatcher_orchestration.test.sql',
    );
    const report = source(
      '../../../supabase/tests/database/phase6_report_orchestration.test.sql',
    );
    const followUp = source(
      '../../../supabase/tests/database/phase6_follow_up_orchestration.test.sql',
    );
    expect(dispatcher).toContain('Pending approval cannot execute');
    expect(report).toContain('Pending Report approval cannot execute');
    expect(report).toContain('Pending invoice approval cannot execute');
    expect(followUp).toContain('Pending Follow-Up approval cannot execute');
  });
});
