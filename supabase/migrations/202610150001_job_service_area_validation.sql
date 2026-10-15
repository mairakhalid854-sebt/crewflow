-- CrewFlow Phase 2: enforce configured technician ZIP service areas when a
-- job is assigned. An empty service-area list remains an explicit unrestricted
-- fallback until a mapping/travel provider is configured.

CREATE FUNCTION public.validate_job_service_area()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  customer_postal_code text;
  technician_service_areas text[];
BEGIN
  IF NEW.assigned_membership_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.assigned_membership_id IS NOT DISTINCT FROM OLD.assigned_membership_id
    AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
  THEN
    RETURN NEW;
  END IF;

  SELECT staff_profile.service_area_postal_codes
  INTO technician_service_areas
  FROM public.memberships AS membership
  JOIN public.staff_profiles AS staff_profile
    ON staff_profile.membership_id = membership.id
    AND staff_profile.tenant_id = membership.tenant_id
  WHERE membership.id = NEW.assigned_membership_id
    AND membership.tenant_id = NEW.tenant_id
    AND membership.role = 'technician'
    AND membership.status = 'active';

  IF cardinality(coalesce(technician_service_areas, '{}')) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT trim(customer.postal_code)
  INTO customer_postal_code
  FROM public.customers AS customer
  WHERE customer.id = NEW.customer_id
    AND customer.tenant_id = NEW.tenant_id;

  IF coalesce(customer_postal_code, '') = '' THEN
    RAISE EXCEPTION 'customer postal code is required to validate technician service area'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM unnest(technician_service_areas) AS service_area(postal_code)
    WHERE trim(service_area.postal_code) = customer_postal_code
      OR (
        char_length(trim(service_area.postal_code)) = 5
        AND left(customer_postal_code, 5) = trim(service_area.postal_code)
      )
  ) THEN
    RAISE EXCEPTION 'technician service area does not cover the customer postal code'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_job_service_area() FROM PUBLIC;

CREATE TRIGGER jobs_validate_service_area
BEFORE INSERT OR UPDATE OF assigned_membership_id, customer_id, tenant_id
ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.validate_job_service_area();

COMMENT ON FUNCTION public.validate_job_service_area() IS
  'Rejects new technician assignments outside configured exact ZIP service areas.';
