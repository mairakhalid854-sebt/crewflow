'use client';

import { useState } from 'react';

type Copy = {
  readonly title: string;
  readonly body: string;
  readonly copy: string;
  readonly copied: string;
  readonly share: string;
  readonly shareText: string;
};

/** "Refer a friend" box for public customer pages. */
export function ReferralInvite({
  copy,
  link,
  note,
}: Readonly<{ copy: Copy; link: string; note: string | null }>) {
  const [copied, setCopied] = useState(false);
  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <aside aria-labelledby="referral-invite-title" className="referral-invite">
      <h2 id="referral-invite-title">{copy.title}</h2>
      <p>{copy.body}</p>
      {note ? <p className="referral-invite-note">{note}</p> : null}
      <div className="referral-invite-row">
        <code>{link}</code>
        <button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(link)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          type="button"
        >
          {copied ? copy.copied : copy.copy}
        </button>
        {canShare ? (
          <button
            onClick={() => {
              void navigator
                .share({ text: copy.shareText, url: link })
                .catch(() => undefined);
            }}
            type="button"
          >
            {copy.share}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
