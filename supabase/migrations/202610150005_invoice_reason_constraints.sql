-- Make reason requirements null-safe at the database boundary. PostgreSQL
-- CHECK constraints accept NULL unless the predicate explicitly rejects it.

ALTER TABLE public.invoices
  DROP CONSTRAINT invoices_void_reason_required;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_void_reason_required CHECK (
    status <> 'void'
    OR (
      voided_at IS NOT NULL
      AND void_reason IS NOT NULL
      AND char_length(trim(void_reason)) BETWEEN 3 AND 500
    )
  );

ALTER TABLE public.payment_records
  ADD CONSTRAINT payment_records_adjustment_reason_required CHECK (
    record_type <> 'adjustment'
    OR (
      note IS NOT NULL
      AND char_length(trim(note)) BETWEEN 3 AND 500
    )
  );
