'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '../../../lib/supabase/client';

import { bytesToHex, validateKnowledgeFile } from './knowledge-upload';
import styles from './knowledge.module.css';

interface VersionTarget {
  readonly id: string;
  readonly label: string;
}

interface KnowledgeUploadFormProps {
  readonly versionTargets: readonly VersionTarget[];
}

type Feedback =
  { readonly kind: 'error' | 'success'; readonly message: string } | undefined;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function KnowledgeUploadForm({
  versionTargets,
}: KnowledgeUploadFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>();
  const [pending, setPending] = useState(false);

  async function upload(formData: FormData) {
    setFeedback(undefined);
    const titleValue = formData.get('title');
    const replacementValue = formData.get('replacementId');
    const title = typeof titleValue === 'string' ? titleValue.trim() : '';
    const replacementId =
      typeof replacementValue === 'string' ? replacementValue.trim() : '';
    const candidate = formData.get('file');

    if (!title || title.length > 160) {
      setFeedback({
        kind: 'error',
        message: 'Enter a document title between 1 and 160 characters.',
      });
      return;
    }
    if (!(candidate instanceof File)) {
      setFeedback({ kind: 'error', message: 'Choose a document to upload.' });
      return;
    }
    const validation = validateKnowledgeFile(candidate);
    if (!validation.ok) {
      setFeedback({ kind: 'error', message: validation.message });
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const reservationArgs = {
        target_byte_size: candidate.size,
        target_file_name: candidate.name,
        target_media_type: validation.mediaType,
        target_title: title,
        ...(replacementId
          ? { target_replaces_document_id: replacementId }
          : {}),
      };
      const { data: reservationRows, error: reservationError } =
        await supabase.rpc('reserve_knowledge_document', reservationArgs);
      const reservation = reservationRows?.[0];
      if (reservationError || !reservation) {
        throw new Error(
          reservationError?.message ??
            'Upload reservation could not be created.',
        );
      }

      const fileBytes = await candidate.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', fileBytes);
      const uploadHash = bytesToHex(digest);
      const { error: uploadError } = await supabase.storage
        .from('knowledge-documents')
        .upload(reservation.storage_path, candidate, {
          cacheControl: '0',
          contentType: validation.mediaType,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { error: finalizeError } = await supabase.rpc(
        'finalize_knowledge_document_upload',
        {
          target_document_id: reservation.document_id,
          target_upload_sha256: uploadHash,
        },
      );
      if (finalizeError) throw new Error(finalizeError.message);

      formRef.current?.reset();
      setFeedback({
        kind: 'success',
        message: `Version ${reservation.document_version} uploaded to private quarantine. It is not available to AI until scanning and parsing succeed.`,
      });
      router.refresh();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: errorMessage(error, 'The document could not be uploaded.'),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={upload} className={styles.uploadForm} ref={formRef}>
      <div className={styles.formGrid}>
        <label>
          Document title
          <input maxLength={160} name="title" required />
        </label>
        <label>
          New version of
          <select defaultValue="" name="replacementId">
            <option value="">New document</option>
            {versionTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={styles.fileField}>
        PDF, DOCX, or TXT (maximum 10 MB)
        <input
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          name="file"
          required
          type="file"
        />
      </label>
      <div className={styles.formFooter}>
        <p>
          Uploads remain private and quarantined until a trusted scanner and
          parser finish successfully.
        </p>
        <button disabled={pending} type="submit">
          {pending ? 'Securing upload…' : 'Upload document'}
        </button>
      </div>
      {feedback ? (
        <p
          className={feedback.kind === 'error' ? styles.error : styles.success}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}

export function ArchiveKnowledgeButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>();
  const [pending, setPending] = useState(false);

  async function archive() {
    if (
      !window.confirm(
        'Archive this document version? Its evidence is retained.',
      )
    )
      return;
    setPending(true);
    setFeedback(undefined);
    const supabase = createClient();
    const { error } = await supabase.rpc('archive_knowledge_document', {
      target_document_id: documentId,
    });
    if (error) {
      setFeedback({ kind: 'error', message: error.message });
    } else {
      setFeedback({ kind: 'success', message: 'Document version archived.' });
      router.refresh();
    }
    setPending(false);
  }

  return (
    <div className={styles.archiveControl}>
      <button
        disabled={pending}
        onClick={() => {
          void archive();
        }}
        type="button"
      >
        {pending ? 'Archiving…' : 'Archive'}
      </button>
      {feedback ? (
        <span
          className={feedback.kind === 'error' ? styles.error : styles.success}
        >
          {feedback.message}
        </span>
      ) : null}
    </div>
  );
}
