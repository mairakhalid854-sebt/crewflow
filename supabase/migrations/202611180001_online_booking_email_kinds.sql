-- Online booking: email kinds. Kept separate so the values are committed
-- before 202611180002 references them.

ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'booking_request_owner';
ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'booking_request_customer';
