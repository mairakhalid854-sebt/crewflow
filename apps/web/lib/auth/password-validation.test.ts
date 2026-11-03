import { describe, expect, it } from 'vitest';

import { updatePasswordSchema } from './password-validation';

describe('updatePasswordSchema', () => {
  it('accepts matching strong passwords', () => {
    expect(
      updatePasswordSchema.safeParse({
        confirmPassword: 'CrewFlow2026',
        password: 'CrewFlow2026',
      }).success,
    ).toBe(true);
  });

  it('rejects a mismatched confirmation', () => {
    const result = updatePasswordSchema.safeParse({
      confirmPassword: 'Different2026',
      password: 'CrewFlow2026',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.confirmPassword).toContain(
        'Passwords do not match.',
      );
    }
  });

  it('keeps the password-strength requirements', () => {
    const result = updatePasswordSchema.safeParse({
      confirmPassword: 'short',
      password: 'short',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password).toContain(
        'Use at least 10 characters.',
      );
    }
  });
});
