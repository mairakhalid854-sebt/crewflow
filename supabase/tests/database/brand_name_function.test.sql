BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SELECT is(
  public.product_brand_name(),
  'CrewFlow',
  'The product brand name comes from one function'
);
SELECT ok(
  position('%' IN public.product_brand_name()) = 0,
  'The brand name is safe to concatenate into format() templates'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.product_brand_name()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.product_brand_name()', 'EXECUTE'),
  'Client roles cannot call the brand helper directly'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname IN (
        'record_assigned_job_signature',
        'queue_job_push_notifications',
        'queue_approval_push_notifications',
        'queue_job_status_email',
        'enqueue_transactional_email'
      )
      AND position('public.product_brand_name()' IN proc.prosrc) > 0
      AND position('CrewFlow' IN proc.prosrc) = 0
  ),
  5::bigint,
  'Customer and crew text reads the brand from the helper, not a literal'
);

SELECT * FROM finish();
ROLLBACK;
