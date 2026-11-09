import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ASSIST_MODEL,
  QUOTE_INSTRUCTIONS,
  estimateAssistCostCents,
  parseAssistResponse,
  quoteDraftSchema,
  sanitizeQuoteDraft,
  sanitizeTranslation,
  translationInstructions,
} from '../../../supabase/functions/_shared/ai-assist.js';

const quoteFunction = readFileSync(
  new URL(
    '../../../supabase/functions/quote-assistant/index.js',
    import.meta.url,
  ),
  'utf8',
);
const translationFunction = readFileSync(
  new URL(
    '../../../supabase/functions/note-translation/index.js',
    import.meta.url,
  ),
  'utf8',
);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function providerBody(output, overrides = {}) {
  return {
    model: ASSIST_MODEL,
    output: [
      {
        content: [{ text: JSON.stringify(output), type: 'output_text' }],
        type: 'message',
      },
    ],
    status: 'completed',
    usage: { input_tokens: 1200, output_tokens: 300 },
    ...overrides,
  };
}

describe('AI assist response parsing', () => {
  it('accepts a completed response from the approved model', () => {
    const parsed = parseAssistResponse(providerBody({ summary: 'ok' }));
    expect(parsed?.output).toEqual({ summary: 'ok' });
    expect(parsed?.estimatedCostCents).toBe(estimateAssistCostCents(1200, 300));
  });

  it('rejects other models, incomplete runs, missing usage, and non-JSON', () => {
    expect(
      parseAssistResponse(providerBody({}, { model: 'other-model' })),
    ).toBeUndefined();
    expect(
      parseAssistResponse(providerBody({}, { status: 'incomplete' })),
    ).toBeUndefined();
    expect(
      parseAssistResponse(providerBody({}, { usage: {} })),
    ).toBeUndefined();
    expect(
      parseAssistResponse({
        ...providerBody({}),
        output: [
          {
            content: [{ text: 'not json', type: 'output_text' }],
            type: 'message',
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('keeps a typical call far below one cent', () => {
    expect(estimateAssistCostCents(1500, 400)).toBe(1);
  });
});

describe('quote draft safety', () => {
  it('limits the model to catalog service ids', () => {
    const schema = quoteDraftSchema([A, B]);
    expect(schema.properties.lines.items.properties.serviceId.enum).toEqual([
      A,
      B,
    ]);
    expect(schema.additionalProperties).toBe(false);
  });

  it('drops unknown services and bad quantities and never carries prices', () => {
    const draft = sanitizeQuoteDraft(
      {
        lines: [
          { quantity: 1, reason: 'Tune-up', serviceId: A, unitPrice: 1 },
          { quantity: 2.555, reason: 'Filters', serviceId: B },
          { quantity: 1, reason: 'Invented', serviceId: 'not-a-service' },
          { quantity: 0, reason: 'Zero', serviceId: A },
          { quantity: 1000, reason: 'Too many', serviceId: A },
        ],
        missingInformation: ['Unit size?', '', 'Access code?'],
        summary: '  AC not cooling  ',
      },
      [A, B],
    );
    expect(draft.lines).toEqual([
      { quantity: 1, reason: 'Tune-up', serviceId: A },
      { quantity: 2.56, reason: 'Filters', serviceId: B },
    ]);
    expect(draft.missingInformation).toEqual(['Unit size?', 'Access code?']);
    expect(draft.summary).toBe('AC not cooling');
  });

  it('tells the model never to invent prices and to treat notes as data', () => {
    expect(QUOTE_INSTRUCTIONS).toContain('Never invent services, prices');
    expect(QUOTE_INSTRUCTIONS).toContain('untrusted data');
  });
});

describe('note translation safety', () => {
  it('requires a non-empty translation and a known source language', () => {
    expect(
      sanitizeTranslation({
        sourceLanguage: 'es',
        translation: ' Replaced the capacitor. ',
      }),
    ).toEqual({
      sourceLanguage: 'es',
      translation: 'Replaced the capacitor.',
    });
    expect(
      sanitizeTranslation({ sourceLanguage: 'xx', translation: 'Hi' })
        ?.sourceLanguage,
    ).toBe('other');
    expect(sanitizeTranslation({ translation: '   ' })).toBeUndefined();
  });

  it('keeps facts and numbers unchanged', () => {
    expect(translationInstructions('en')).toContain(
      'Keep numbers, measurements',
    );
    expect(translationInstructions('en')).toContain('English');
    expect(translationInstructions('es')).toContain('Spanish');
  });
});

describe('assistant edge functions', () => {
  it('check the signed-in user and record every run with its cost', () => {
    for (const source of [quoteFunction, translationFunction]) {
      expect(source).toContain('admin.auth.getUser(token)');
      expect(source).toContain("'begin_stub_ai_run'");
      expect(source).toContain("'complete_ai_assist_run'");
      expect(source).toContain('store: false');
      expect(source).toContain('tools: []');
    }
  });

  it('never write quotes, invoices, or jobs directly', () => {
    for (const source of [quoteFunction, translationFunction]) {
      expect(source).not.toMatch(/from\('(quotes|invoices|jobs)'\)/);
    }
    expect(quoteFunction).toContain("'record_ai_quote_draft'");
  });
});
