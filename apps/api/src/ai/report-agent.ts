export interface ReportWorkNote {
  readonly body: string;
  readonly createdAt: string;
  readonly tenantId: string;
}

export interface ReportMediaEvidence {
  readonly kind: 'after' | 'before';
  readonly tenantId: string;
  readonly uploaded: boolean;
}

export interface ReportSignatureEvidence {
  readonly signedAt: string;
  readonly tenantId: string;
}

export interface ReportDraftFields {
  readonly partsUsed: string;
  readonly recommendations: string;
  readonly summary: string;
  readonly workPerformed: string;
}

export interface ReportAgentInput {
  readonly existingDraft?: Partial<ReportDraftFields>;
  readonly jobId: string;
  readonly jobTitle: string;
  readonly media: readonly ReportMediaEvidence[];
  readonly notes: readonly ReportWorkNote[];
  readonly serviceName?: string;
  readonly signature?: ReportSignatureEvidence;
  readonly status: string;
  readonly tenantId: string;
}

export type ReportAgentResult =
  | {
      readonly escalationReason: string;
      readonly status: 'escalated';
    }
  | {
      readonly draft: ReportDraftFields;
      readonly evidence: {
        readonly afterPhotoCount: number;
        readonly beforePhotoCount: number;
        readonly customerSignatureRecorded: boolean;
        readonly technicianNoteCount: number;
      };
      readonly exactChanges: Record<
        keyof ReportDraftFields,
        { readonly from: string | null; readonly to: string }
      >;
      readonly rationale: readonly string[];
      readonly requiresHumanApproval: true;
      readonly status: 'proposed';
    };

const UNKNOWN_PARTS = 'Unknown - no structured parts-used record was supplied.';
const UNKNOWN_RECOMMENDATIONS =
  'Unknown - no structured technician recommendation was supplied.';
const MAX_WORK_PERFORMED_LENGTH = 10_000;

function normalizedText(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function changeSet(
  existing: Partial<ReportDraftFields> | undefined,
  draft: ReportDraftFields,
): Record<
  keyof ReportDraftFields,
  { readonly from: string | null; readonly to: string }
> {
  return {
    partsUsed: {
      from: existing?.partsUsed ?? null,
      to: draft.partsUsed,
    },
    recommendations: {
      from: existing?.recommendations ?? null,
      to: draft.recommendations,
    },
    summary: { from: existing?.summary ?? null, to: draft.summary },
    workPerformed: {
      from: existing?.workPerformed ?? null,
      to: draft.workPerformed,
    },
  };
}

export function proposeWorkReport(input: ReportAgentInput): ReportAgentResult {
  if (!['completed', 'closed'].includes(input.status)) {
    return {
      escalationReason:
        'Only completed or closed jobs can produce a customer work report.',
      status: 'escalated',
    };
  }

  const hasForeignEvidence =
    input.notes.some((note) => note.tenantId !== input.tenantId) ||
    input.media.some((media) => media.tenantId !== input.tenantId) ||
    (input.signature !== undefined &&
      input.signature.tenantId !== input.tenantId);
  if (hasForeignEvidence) {
    return {
      escalationReason:
        'Report input contained evidence from a different workspace.',
      status: 'escalated',
    };
  }

  const notes = input.notes
    .map((note) => ({
      body: normalizedText(note.body),
      createdAt: timestamp(note.createdAt),
    }))
    .filter(
      (note): note is { body: string; createdAt: number } =>
        note.body.length >= 3 && note.createdAt !== undefined,
    )
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.body.localeCompare(right.body),
    );

  if (!notes.length) {
    return {
      escalationReason:
        'No valid technician work notes were supplied. A person must draft the report.',
      status: 'escalated',
    };
  }

  const workPerformed = notes
    .map((note, index) => `${index + 1}. ${note.body}`)
    .join('\n');
  if (workPerformed.length > MAX_WORK_PERFORMED_LENGTH) {
    return {
      escalationReason:
        'Technician notes exceed the safe report draft limit. A person must summarize them.',
      status: 'escalated',
    };
  }

  const uploadedMedia = input.media.filter((media) => media.uploaded);
  const beforePhotoCount = uploadedMedia.filter(
    (media) => media.kind === 'before',
  ).length;
  const afterPhotoCount = uploadedMedia.filter(
    (media) => media.kind === 'after',
  ).length;
  const customerSignatureRecorded =
    input.signature !== undefined &&
    timestamp(input.signature.signedAt) !== undefined;
  const title = normalizedText(input.jobTitle) || 'Service job';
  const service = input.serviceName
    ? normalizedText(input.serviceName)
    : undefined;
  const draft: ReportDraftFields = {
    partsUsed: UNKNOWN_PARTS,
    recommendations: UNKNOWN_RECOMMENDATIONS,
    summary: service
      ? `${service} work for "${title}" was recorded as ${input.status}.`
      : `Work for "${title}" was recorded as ${input.status}.`,
    workPerformed,
  };

  return {
    draft,
    evidence: {
      afterPhotoCount,
      beforePhotoCount,
      customerSignatureRecorded,
      technicianNoteCount: notes.length,
    },
    exactChanges: changeSet(input.existingDraft, draft),
    rationale: [
      `Drafted from ${notes.length} valid technician note${notes.length === 1 ? '' : 's'}.`,
      `Recorded ${beforePhotoCount} uploaded before and ${afterPhotoCount} uploaded after photo${beforePhotoCount + afterPhotoCount === 1 ? '' : 's'} as evidence counts only; image contents were not interpreted.`,
      customerSignatureRecorded
        ? 'A customer signature record exists for the job.'
        : 'No valid customer signature record was supplied.',
      'Parts and recommendations remain explicitly unknown because no structured source was supplied.',
    ],
    requiresHumanApproval: true,
    status: 'proposed',
  };
}
