import { describe, expect, it } from 'vitest';

import {
  signatureDraftError,
  signaturePath,
  type SignatureStroke,
} from './job-signature-policy';

const stroke: SignatureStroke = [
  { x: 0.1, y: 0.2 },
  { x: 0.6, y: 0.8 },
];

describe('customer signature policy', () => {
  it('requires a signer name, consent, and a drawn stroke', () => {
    expect(signatureDraftError('', [stroke], true)).toBe(
      'Enter the customer or signer name.',
    );
    expect(signatureDraftError('Customer', [stroke], false)).toBe(
      'The customer must accept the consent text.',
    );
    expect(signatureDraftError('Customer', [], true)).toBe(
      'Ask the customer to draw their signature.',
    );
  });

  it('accepts a bounded signature and creates a normalized SVG path', () => {
    expect(signatureDraftError('  Jamie Customer  ', [stroke], true)).toBe(
      undefined,
    );
    expect(signaturePath(stroke)).toBe('M 100 60 L 600 240');
  });
});
