export default function WorkspaceLoading() {
  return (
    <div className="workspace-page" role="status">
      <p className="workspace-kicker">Loading</p>
      <h1>Preparing your workspace...</h1>
      <div className="loading-block" />
      <span className="sr-only">CrewFlow workspace is loading.</span>
    </div>
  );
}
