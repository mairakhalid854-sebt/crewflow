-- The product launches as CrewFlow360 (crewflow360.com) because crewflow.com
-- is unavailable. Emails, push notifications, and signature consent read the
-- name from this function, so replacing its body renames all of them.

CREATE OR REPLACE FUNCTION public.product_brand_name()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 'CrewFlow360'::text
$$;
