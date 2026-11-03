-- Keep owner changes to the public Intake surface visible in the audit trail.

CREATE FUNCTION public.audit_intake_widget_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.intake_widget_enabled IS DISTINCT FROM OLD.intake_widget_enabled
     OR NEW.intake_widget_key IS DISTINCT FROM OLD.intake_widget_key THEN
    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      NEW.tenant_id,
      auth.uid(),
      CASE
        WHEN NEW.intake_widget_enabled THEN 'ai.intake_widget_enabled'
        ELSE 'ai.intake_widget_disabled'
      END,
      'tenant_settings',
      NEW.id,
      jsonb_build_object(
        'enabled', NEW.intake_widget_enabled,
        'key_changed', NEW.intake_widget_key IS DISTINCT FROM OLD.intake_widget_key
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_settings_audit_intake_widget
AFTER UPDATE OF intake_widget_enabled, intake_widget_key
ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_intake_widget_settings_change();

REVOKE ALL ON FUNCTION public.audit_intake_widget_settings_change()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.audit_intake_widget_settings_change() IS
  'Audits owner-controlled public Intake enablement and widget-key rotation.';
