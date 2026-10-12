'use client';

import { useFormStatus } from 'react-dom';

function ArchiveSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="danger-button" disabled={pending} type="submit">
      {pending ? 'Archiving…' : 'Archive service'}
    </button>
  );
}

export function ArchiveServiceButton({
  action,
  serviceId,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  serviceId: string;
}>) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            'Archive this service? Existing records will remain intact.',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="serviceId" type="hidden" value={serviceId} />
      <ArchiveSubmitButton />
    </form>
  );
}
