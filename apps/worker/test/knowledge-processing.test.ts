import { describe, expect, it } from 'vitest';

import {
  MAX_CHUNK_CHARACTERS,
  PermanentKnowledgeError,
  boundedProcessingError,
  chunkPages,
  chunkPlainText,
  parseScannerResult,
} from '../../../supabase/functions/_shared/knowledge-processing.js';

describe('knowledge document processor', () => {
  it('accepts only bounded final malware scanner responses', () => {
    expect(
      parseScannerResult({
        verdict: 'clean',
        scannerName: 'ClamAV gateway',
        scannerVersion: '1.4.3',
      }),
    ).toEqual({
      verdict: 'clean',
      scannerName: 'ClamAV gateway',
      scannerVersion: '1.4.3',
    });
    expect(() =>
      parseScannerResult({ verdict: 'unknown', scannerName: 'x' }),
    ).toThrow('scanner_invalid_response');
  });

  it('creates bounded deterministic plain-text chunks with citations', () => {
    const source = `${'A'.repeat(2_200)} ${'B'.repeat(2_200)}`;
    const chunks = chunkPlainText(source, 'Safety manual.txt');

    expect(chunks).toHaveLength(2);
    expect(
      chunks.every((chunk) => chunk.content.length <= MAX_CHUNK_CHARACTERS),
    ).toBe(true);
    expect(chunks[0]).toMatchObject({
      page_number: null,
      character_start: 0,
      citation_label: 'Safety manual.txt - chunk 1',
    });
  });

  it('preserves PDF page citations and skips blank pages', () => {
    expect(
      chunkPages(
        [
          { pageNumber: 1, text: 'First page policy.' },
          { pageNumber: 2, text: '   ' },
          { pageNumber: 3, text: 'Final page checklist.' },
        ],
        'Operations.pdf',
      ),
    ).toEqual([
      {
        content: 'First page policy.',
        page_number: 1,
        character_start: null,
        character_end: null,
        citation_label: 'Operations.pdf - page 1',
      },
      {
        content: 'Final page checklist.',
        page_number: 3,
        character_start: null,
        character_end: null,
        citation_label: 'Operations.pdf - page 3',
      },
    ]);
  });

  it('fails closed for empty or oversized extraction', () => {
    expect(() => chunkPlainText('   ', 'blank.txt')).toThrow(
      PermanentKnowledgeError,
    );
    expect(() =>
      chunkPages([{ pageNumber: 0, text: 'invalid' }], 'invalid.pdf'),
    ).toThrow('invalid_page_number');
  });

  it('exposes only bounded operational error codes', () => {
    expect(
      boundedProcessingError(
        new PermanentKnowledgeError('document_has_no_text'),
      ),
    ).toBe('document_has_no_text');
    expect(boundedProcessingError(new Error('Sensitive path C:\\secret'))).toBe(
      'processing_error',
    );
  });
});
