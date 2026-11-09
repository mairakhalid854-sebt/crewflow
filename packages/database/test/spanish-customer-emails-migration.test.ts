import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090009_spanish_customer_emails.sql',
    import.meta.url,
  ),
  'utf8',
);
const previous = readFileSync(
  new URL(
    '../../../supabase/migrations/202610290001_brand_name_function.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Spanish customer emails migration', () => {
  it('stores a per-customer language, English by default', () => {
    expect(migration).toContain(
      "preferred_language text NOT NULL DEFAULT 'en'",
    );
    expect(migration).toContain("preferred_language IN ('en', 'es')");
  });

  it('adds Spanish templates for every customer-facing email', () => {
    for (const text of [
      'Su cita con %s está confirmada',
      'Su cita con %s tiene un nuevo horario',
      'Su cita con %s fue cancelada',
      'Su cotización de %s',
      'Factura n.º %s de %s',
      'Su informe de servicio de %s',
      '¿Todavía lo está pensando? Su cotización de %s',
    ]) {
      expect(migration).toContain(text);
    }
  });

  it('keeps every English template exactly as before', () => {
    for (const text of [
      "format('Your appointment with %s is confirmed', business_name)",
      "format('Your quote from %s', business_name)",
      "format('Invoice #%s from %s', document_number, business_name)",
      "format('Your service report from %s', business_name)",
    ]) {
      expect(previous).toContain(text);
      expect(migration).toContain(text);
    }
  });

  it('keeps staff invitations in English and links intact', () => {
    expect(migration).toContain(
      "target_kind IN ('quote', 'invoice', 'work_report')",
    );
    // The SQL source contains the two characters backslash + n.
    const spanishLinks = migration.split('aquí:\\n\\n{{link}}').length - 1;
    expect(spanishLinks).toBe(3);
  });
});
