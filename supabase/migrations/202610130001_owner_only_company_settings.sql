-- Keep company settings owner-only at both the UI/RPC and table-policy layers.

DROP POLICY business_hours_manage_office ON public.business_hours;

CREATE POLICY business_hours_manage_owner ON public.business_hours
FOR ALL TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner']::public.membership_role[]
  )
) WITH CHECK (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner']::public.membership_role[]
  )
);

COMMENT ON POLICY business_hours_manage_owner ON public.business_hours IS
  'Only active owners can create or change company business hours.';
