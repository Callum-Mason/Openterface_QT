import type { ReleaseSummary } from "../types";
import { Dialog } from "./Dialog";

type UpdateDialogProps = {
  open: boolean;
  currentVersion: string;
  release: ReleaseSummary | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onOpenReleases: () => void;
};

export function UpdateDialog({ open, currentVersion, release, loading, error, onClose, onOpenReleases }: UpdateDialogProps) {
  if (!open) return null;
  return (
    <Dialog titleId="update-title" title="Check for updates" subtitle="Openterface Mini-KVM desktop" closeLabel="Close update check" onClose={onClose} busy={loading} size="md"
      footer={<>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={loading}>Close</button>
        <button className="button button-primary" type="button" onClick={onOpenReleases} disabled={loading}>Open releases</button>
      </>}>
      <div aria-live="polite">
        {loading && <p>Checking the latest GitHub release…</p>}
        {!loading && error && <p className="update-error" role="alert">{error}</p>}
        {!loading && !error && release && (release.updateAvailable ? <>
          <p className="update-state">A newer version is available.</p>
          <dl className="kv-list">
            <div><dt>Current version</dt><dd className="mono">{currentVersion}</dd></div>
            <div><dt>Latest version</dt><dd className="mono">{release.version}</dd></div>
          </dl>
          {release.title && <h3 className="update-release-title">{release.title}</h3>}
          {release.notes && <p className="update-notes">{release.notes}</p>}
        </> : <p className="update-state">You’re up to date. Current version: <span className="mono">{currentVersion}</span>.</p>)}
      </div>
    </Dialog>
  );
}
