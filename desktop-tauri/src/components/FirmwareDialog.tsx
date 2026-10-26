import { Cpu, RefreshCw } from "lucide-react";
import type { FirmwareUpdateCheck } from "../types";
import { Dialog } from "./Dialog";

type FirmwareDialogProps = {
  open: boolean;
  chip: string | null;
  portName: string;
  version: string;
  reading: boolean;
  checking: boolean;
  updateCheck: FirmwareUpdateCheck | null;
  error: string;
  onReadVersion: () => void;
  onCheckUpdate: () => void;
  onClose: () => void;
};

export function FirmwareDialog({
  open, chip, portName, version, reading, checking, updateCheck, error, onReadVersion, onCheckUpdate, onClose,
}: FirmwareDialogProps) {
  if (!open) return null;
  const busy = reading || checking;

  return (
    <Dialog
      titleId="firmware-title"
      title="Capture firmware"
      subtitle="Read the firmware version from the connected capture chip."
      closeLabel="Close capture firmware"
      onClose={onClose}
      busy={busy}
      size="md"
      footer={<>
        <span className="dialog-footer-note" role="status">{checking ? "Checking the official firmware index and staging the package…" : "The firmware package stays in memory until you choose to install it."}</span>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Close</button>
        <button className="button button-secondary" type="button" onClick={onReadVersion} disabled={busy || !chip || !portName}>
          {reading ? "Reading…" : "Read version"}
        </button>
        <button className="button button-primary" type="button" onClick={onCheckUpdate} disabled={busy || !chip || !portName}>
          <RefreshCw size={14} className={checking ? "spin" : ""} />{checking ? "Checking…" : "Check online"}
        </button>
      </>}
    >
      <div className="firmware-summary">
        <div className="firmware-chip-icon"><Cpu size={19} aria-hidden="true" /></div>
        <dl className="kv-list">
          <div><dt>Capture chip</dt><dd>{chip ?? "Not identified"}</dd></div>
          <div><dt>Controller port</dt><dd className="mono">{portName || "Not selected"}</dd></div>
          <div><dt>Installed version</dt><dd className="mono">{updateCheck?.currentVersion ?? (version || "Not read")}</dd></div>
          {updateCheck && <div><dt>Latest version</dt><dd className="mono">{updateCheck.latestVersion}</dd></div>}
        </dl>
      </div>
      {updateCheck && <section className="firmware-update-result" data-update-available={updateCheck.updateAvailable} aria-live="polite">
        <strong>{updateCheck.updateAvailable ? "Update available" : "Firmware is up to date"}</strong>
        <span>{updateCheck.fileName} · {(updateCheck.packageSizeBytes / 1024).toFixed(1)} KB</span>
      </section>}
      {chip?.includes("recovery") && <p className="firmware-message" role="status">This device is in recovery mode. Firmware recovery is not available yet.</p>}
      {error && <p className="firmware-error" role="alert">{error}</p>}
      <p className="firmware-note">The selected package is held in memory. Flashing, backup, and restore controls are still being migrated.</p>
    </Dialog>
  );
}
