BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '1c000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'intake-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1c000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'intake-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES (
  '2c000000-0000-4000-8000-000000000001', 'Intake Test LLC', 'Intake Test',
  'intake@crewflow.test', 'America/Los_Angeles', ARRAY['Cleaning']
);

INSERT INTO public.tenant_settings (
  tenant_id, ai_operations_enabled, ai_monthly_budget_cents,
  intake_widget_enabled, intake_widget_key
) VALUES (
  '2c000000-0000-4000-8000-000000000001', true, 100,
  true, '4c000000-0000-4000-8000-000000000001'
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '3c000000-0000-4000-8000-000000000001',
    '2c000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '3c000000-0000-4000-8000-000000000002',
    '2c000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  );

INSERT INTO public.services (
  id, tenant_id, name, description, unit_price_cents,
  default_duration_minutes, is_enabled
) VALUES
  (
    '5c000000-0000-4000-8000-000000000001',
    '2c000000-0000-4000-8000-000000000001',
    'Gutter Cleaning', 'Clean residential gutters', 12000, 90, true
  ),
  (
    '5c000000-0000-4000-8000-000000000002',
    '2c000000-0000-4000-8000-000000000001',
    'Disabled Service', 'Must not be offered', 100, 30, false
  );

SELECT has_table('public', 'intake_conversations', 'Intake conversations exist');
SELECT has_table('public', 'intake_messages', 'Intake messages exist');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT throws_ok(
  $$SELECT public.open_intake_conversation(
    '4c000000-0000-4000-8000-000000000099',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  '42501',
  'intake widget unavailable',
  'An unknown widget key reveals no tenant'
);

SELECT isnt(
  public.open_intake_conversation(
    '4c000000-0000-4000-8000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  NULL::uuid,
  'The service boundary opens a tenant-bound conversation'
);

SELECT isnt(
  (SELECT session_token_hash FROM public.intake_conversations LIMIT 1),
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Only a token digest is persisted'
);

SELECT is(
  (SELECT jsonb_array_length(catalog_snapshot) FROM public.intake_conversations LIMIT 1),
  1,
  'The snapshot contains enabled services only'
);

SELECT is(
  (SELECT count(*)::integer FROM public.intake_messages),
  1,
  'The opening assistant question is retained'
);

SELECT throws_ok(
  $$SELECT public.record_intake_turn(
    (SELECT id FROM public.intake_conversations LIMIT 1),
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'Customer Name', 'What is your contact?', 'contact', 'collecting',
    '{"customerName":"Customer Name"}'::jsonb
  )$$,
  '42501',
  'intake conversation unavailable',
  'A wrong bearer token cannot access the conversation'
);

SELECT is(
  public.record_intake_turn(
    (SELECT id FROM public.intake_conversations LIMIT 1),
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Customer Name', 'What is your contact?', 'contact', 'collecting',
    '{"customerName":"Customer Name"}'::jsonb
  ),
  2,
  'A valid turn advances the optimistic version'
);

SELECT is(
  (SELECT count(*)::integer FROM public.intake_messages),
  3,
  'A valid turn appends customer and assistant messages atomically'
);

SELECT is(
  public.record_intake_validation_error(
    (SELECT id FROM public.intake_conversations LIMIT 1),
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'not-an-email', 'Enter a valid email address.'
  ),
  3,
  'A rejected turn advances only the optimistic version'
);

SELECT is(
  (SELECT stage::text FROM public.intake_conversations LIMIT 1),
  'contact',
  'A rejected turn does not advance deterministic state'
);

SELECT throws_ok(
  $$UPDATE public.intake_messages SET body = 'rewritten'$$,
  '42501',
  'Intake messages are immutable',
  'Transcript history cannot be rewritten'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1c000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$SELECT public.take_over_intake_conversation(
    (SELECT id FROM public.intake_conversations LIMIT 1),
    'Technician tried to join'
  )$$,
  '42501',
  'intake conversation not found or unavailable',
  'Technicians cannot take over intake conversations'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1c000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT is(
  public.take_over_intake_conversation(
    (SELECT id FROM public.intake_conversations LIMIT 1),
    'Owner accepted the escalation'
  ),
  4,
  'An owner can take over the conversation'
);

SELECT is(
  (SELECT status::text FROM public.intake_conversations LIMIT 1),
  'human_takeover',
  'Takeover stops automated collection'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.audit_events
    WHERE action = 'ai.intake_human_takeover'
  ),
  1,
  'Human takeover is written to the tenant audit trail'
);

SELECT * FROM finish();
ROLLBACK;
