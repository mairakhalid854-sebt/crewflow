export const MAX_KNOWLEDGE_FILE_BYTES = 10 * 1024 * 1024;

export const KNOWLEDGE_MEDIA_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  txt: 'text/plain',
} as const;

export interface KnowledgeFileInput {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export type KnowledgeFileValidation =
  | { readonly mediaType: string; readonly ok: true }
  | { readonly message: string; readonly ok: false };

export function validateKnowledgeFile(
  file: KnowledgeFileInput,
): KnowledgeFileValidation {
  if (file.size < 1 || file.size > MAX_KNOWLEDGE_FILE_BYTES) {
    return { message: 'Choose a file between 1 byte and 10 MB.', ok: false };
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  const expectedType = extension
    ? KNOWLEDGE_MEDIA_TYPES[extension as keyof typeof KNOWLEDGE_MEDIA_TYPES]
    : undefined;
  if (
    !expectedType ||
    (file.type && file.type.toLowerCase() !== expectedType)
  ) {
    return {
      message:
        'Only PDF, DOCX, and TXT files with a matching file type are allowed.',
      ok: false,
    };
  }

  return { mediaType: expectedType, ok: true };
}

export function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
