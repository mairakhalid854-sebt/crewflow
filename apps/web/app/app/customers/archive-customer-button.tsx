'use client';

import { useFormStatus } from 'react-dom';

function ArchiveSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="danger-button" disabled={pending} type="submit">
      {pending ? 'Archiving…' : 'Archive customer'}
    </button>
  );
}

export function ArchiveCustomerButton({
  action,
  customerId,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  customerId: string;
}>) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            'Archive this customer? You can retain their history.',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="customerId" type="hidden" value={customerId} />
      <ArchiveSubmitButton />
    </form>
  );
}
