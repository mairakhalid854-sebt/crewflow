export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 1_500_000;
export const MAX_KNOWLEDGE_CHUNKS = 500;
export const MAX_CHUNK_CHARACTERS = 3_500;

export interface KnowledgeChunk {
  readonly content: string;
  readonly page_number: number | null;
  readonly character_start: number | null;
  readonly character_end: number | null;
  readonly citation_label: string;
}

export interface ExtractedPage {
  readonly pageNumber: number;
  readonly text: string;
}

export interface ScannerResult {
  readonly verdict: 'clean' | 'infected';
  readonly scannerName: string;
  readonly scannerVersion: string;
}

export class PermanentKnowledgeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermanentKnowledgeError';
  }
}

function boundedIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 80
    ? normalized
    : undefined;
}

export function parseScannerResult(value: unknown): ScannerResult {
  if (!value || typeof value !== 'object') {
    throw new Error('scanner_invalid_response');
  }

  const candidate = value as Record<string, unknown>;
  const verdict = candidate.verdict;
  const scannerName = boundedIdentity(candidate.scannerName);
  const scannerVersion = boundedIdentity(candidate.scannerVersion);
  if (
    (verdict !== 'clean' && verdict !== 'infected') ||
    !scannerName ||
    !scannerVersion
  ) {
    throw new Error('scanner_invalid_response');
  }

  return { verdict, scannerName, scannerVersion };
}

function normalizeText(value: string): string {
  return value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeLabel(value: string): string {
  const normalized = normalizeText(value).replaceAll('\n', ' ');
  return normalized.slice(0, 200) || 'Knowledge document';
}

function splitBoundedText(
  source: string,
  citationPrefix: string,
  pageNumber: number | null,
): KnowledgeChunk[] {
  const text = normalizeText(source);
  if (!text) return [];
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new PermanentKnowledgeError('extracted_text_too_large');
  }

  const chunks: KnowledgeChunk[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor] ?? '')) cursor += 1;
    if (cursor >= text.length) break;

    let end = Math.min(cursor + MAX_CHUNK_CHARACTERS, text.length);
    if (end < text.length) {
      const minimumBreak = cursor + Math.floor(MAX_CHUNK_CHARACTERS * 0.6);
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      const lineBreak = text.lastIndexOf('\n', end);
      const wordBreak = text.lastIndexOf(' ', end);
      end =
        [paragraphBreak, lineBreak, wordBreak].find(
          (candidate) => candidate >= minimumBreak,
        ) ?? end;
    }

    const content = text.slice(cursor, end).trim();
    if (content) {
      const chunkNumber = chunks.length + 1;
      const location = pageNumber
        ? `page ${pageNumber}`
        : `chunk ${chunkNumber}`;
      chunks.push({
        content,
        page_number: pageNumber,
        character_start: pageNumber ? null : cursor,
        character_end: pageNumber ? null : cursor + content.length,
        citation_label: `${safeLabel(citationPrefix)} - ${location}`.slice(
          0,
          240,
        ),
      });
    }
    cursor = Math.max(end, cursor + 1);
  }

  return chunks;
}

export function chunkPlainText(
  text: string,
  originalFileName: string,
): KnowledgeChunk[] {
  const chunks = splitBoundedText(text, originalFileName, null);
  if (chunks.length === 0) {
    throw new PermanentKnowledgeError('document_has_no_text');
  }
  if (chunks.length > MAX_KNOWLEDGE_CHUNKS) {
    throw new PermanentKnowledgeError('too_many_chunks');
  }
  return chunks;
}

export function chunkPages(
  pages: readonly ExtractedPage[],
  originalFileName: string,
): KnowledgeChunk[] {
  if (pages.length === 0 || pages.length > 1_000) {
    throw new PermanentKnowledgeError('invalid_page_count');
  }

  let extractedCharacters = 0;
  const chunks: KnowledgeChunk[] = [];
  for (const page of pages) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1) {
      throw new PermanentKnowledgeError('invalid_page_number');
    }
    extractedCharacters += page.text.length;
    if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) {
      throw new PermanentKnowledgeError('extracted_text_too_large');
    }
    chunks.push(
      ...splitBoundedText(page.text, originalFileName, page.pageNumber),
    );
    if (chunks.length > MAX_KNOWLEDGE_CHUNKS) {
      throw new PermanentKnowledgeError('too_many_chunks');
    }
  }

  if (chunks.length === 0) {
    throw new PermanentKnowledgeError('document_has_no_text');
  }
  return chunks;
}

export function boundedProcessingError(error: unknown): string {
  if (error instanceof PermanentKnowledgeError) return error.code;
  if (error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)) {
    return error.message;
  }
  return 'processing_error';
}
