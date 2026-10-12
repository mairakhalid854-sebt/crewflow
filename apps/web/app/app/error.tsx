'use client';

export default function WorkspaceError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <div className="workspace-page">
      <p className="workspace-kicker">Something went wrong</p>
      <h1>We could not load this workspace.</h1>
      <p>Try the request again. No changes were made.</p>
      <button className="primary-button" onClick={reset} type="button">
        Try again
      </button>
    </div>
  );
}
