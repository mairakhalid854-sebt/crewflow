'use client';

import { useFormStatus } from 'react-dom';
import { confirmAction } from '../../../lib/ui/confirm-action';

function ArchiveSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="danger-button" disabled={pending} type="submit">
      {pending ? 'Archiving…' : 'Archive job'}
    </button>
  );
}

export function ArchiveJobButton({
  action,
  jobId,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  jobId: string;
}>) {
  return (
    <form
      action={action}
      className="archive-job-form"
      onSubmit={(event) => {
        if (
          !confirmAction(
            'Archive this job? Its customer history and activity will remain intact.',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="jobId" type="hidden" value={jobId} />
      <ArchiveSubmitButton />
    </form>
  );
}
