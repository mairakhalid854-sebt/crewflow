import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/public-intake/index.js',
    import.meta.url,
  ),
  'utf8',
);
const configuration = readFileSync(
  new URL('../../../supabase/config.toml', import.meta.url),
  'utf8',
);

describe('public Intake edge boundary', () => {
  it('uses an internal service credential without exposing it to callers', () => {
    expect(edgeFunction).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(edgeFunction).not.toMatch(/serviceRoleKey\s*:/);
    expect(edgeFunction).not.toMatch(/console\.(log|error)\([^)]*(body|token)/);
  });

  it('generates a high-entropy token and compares only its digest', () => {
    expect(edgeFunction).toContain(
      'crypto.getRandomValues(new Uint8Array(32))',
    );
    expect(edgeFunction).toMatch(/crypto\.subtle\.digest\(\s*'SHA-256'/);
    expect(edgeFunction).toContain('constantTimeEqual');
  });

  it('bounds public requests and returns no catalog or price data', () => {
    expect(edgeFunction).toContain('contentLength > 10_000');
    expect(edgeFunction).toContain('value.trim().length <= 4000');
    expect(edgeFunction).not.toMatch(/return json\([^;]*catalog_snapshot/s);
    expect(edgeFunction).not.toMatch(/return json\([^;]*unitPriceCents/s);
  });

  it('is explicitly configured as a public function with app-level checks', () => {
    expect(configuration).toContain('[functions.public-intake]');
    expect(configuration).toContain(
      "entrypoint = './functions/public-intake/index.js'",
    );
    expect(configuration).toMatch(
      /\[functions\.public-intake\]\s+verify_jwt = false/,
    );
  });
});
