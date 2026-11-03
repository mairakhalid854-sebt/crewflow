-- Preserve verified Paddle webhook attempts even when their tenant reference is
-- unknown. The event processor records these attempts as tenant_not_found with
-- a NULL tenant_id; keeping the foreign key intact still prevents dangling
-- tenant references everywhere else.

CREATE FUNCTION public.normalize_billing_webhook_event_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.tenants AS tenant
      WHERE tenant.id = NEW.tenant_id
    )
  THEN
    NEW.tenant_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_webhook_events_normalize_unknown_tenant
BEFORE INSERT ON public.billing_webhook_events
FOR EACH ROW EXECUTE FUNCTION public.normalize_billing_webhook_event_tenant();

REVOKE ALL ON FUNCTION public.normalize_billing_webhook_event_tenant()
  FROM PUBLIC;

COMMENT ON FUNCTION public.normalize_billing_webhook_event_tenant()
IS 'Keeps verified unknown-tenant webhook attempts auditable without creating dangling tenant references.';
