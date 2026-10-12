# Development fixtures

Fixtures are synthetic and must never contain copied customer data. Each tenant-owned object includes a visible `tenantId` so isolation mistakes are easier to spot during development. Phase 1 will load fixtures through migration-safe seed tooling and add cross-tenant negative tests.
