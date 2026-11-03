import { describe, expect, it } from 'vitest';

import {
  bytesToHex,
  MAX_KNOWLEDGE_FILE_BYTES,
  validateKnowledgeFile,
} from './knowledge-upload';

describe('knowledge upload validation', () => {
  it.each([
    ['guide.pdf', 'application/pdf'],
    [
      'policy.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['faq.txt', 'text/plain'],
  ])('accepts %s with its exact media type', (name, type) => {
    expect(validateKnowledgeFile({ name, size: 128, type })).toEqual({
      mediaType: type,
      ok: true,
    });
  });

  it('normalizes an empty browser media type from the safe extension', () => {
    expect(
      validateKnowledgeFile({ name: 'faq.TXT', size: 128, type: '' }),
    ).toEqual({ mediaType: 'text/plain', ok: true });
  });

  it.each([
    { name: 'payload.exe', size: 128, type: 'application/octet-stream' },
    { name: 'spoofed.pdf', size: 128, type: 'text/plain' },
    { name: 'empty.pdf', size: 0, type: 'application/pdf' },
    {
      name: 'large.pdf',
      size: MAX_KNOWLEDGE_FILE_BYTES + 1,
      type: 'application/pdf',
    },
  ])('rejects unsafe file metadata: $name', (file) => {
    expect(validateKnowledgeFile(file).ok).toBe(false);
  });

  it('formats digest bytes as lowercase SHA-256 hex', () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 16, 255]).buffer)).toBe(
      '000f10ff',
    );
  });
});
