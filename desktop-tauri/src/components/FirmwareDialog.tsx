import { Cpu, RefreshCw } from "lucide-react";
import { Dialog } from "./Dialog";

type FirmwareDialogProps = {
  open: boolean;
  chip: string | null;
  portName: string;
  version: string;
  loading: boolean;
  error: string;
  onReadVersion: () => void;
  onClose: () => void;
};

export function FirmwareDialog({
  open, chip, portName, version, loading, error, onReadVersion, onClose,
}: FirmwareDialogProps) {
  if (!open) return null;

  return (
    <Dialog
      titleId="firmware-title"
      title="Capture firmware"
      subtitle="Read the firmware version from the connected capture chip."
      closeLabel="Close capture firmware"
      onClose={onClose}
      busy={loading}
      size="md"
      footer={<>
        <span className="dialog-footer-note" role="status">Version reads do not change device firmware.</span>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={loading}>Close</button>
        <button className="button button-primary" type="button" onClick={onReadVersion} disabled={loading || !chip || !portName}>
          <RefreshCw size={14} className={loading ? "spin" : ""} />{loading ? "Reading…" : "Read version"}
        </button>
      </>}
    >
      <div className="firmware-summary">
        <div className="firmware-chip-icon"><Cpu size={19} aria-hidden="true" /></div>
        <dl className="kv-list">
          <div><dt>Capture chip</dt><dd>{chip ?? "Not identified"}</dd></div>
          <div><dt>Controller port</dt><dd className="mono">{portName || "Not selected"}</dd></div>
          <div><dt>Installed version</dt><dd className="mono">{version || "Not read"}</dd></div>
        </dl>
      </div>
      {chip?.includes("recovery") && <p className="firmware-message" role="status">This device is in recovery mode. Firmware recovery is not available yet.</p>}
      {error && <p className="firmware-error" role="alert">{error}</p>}
      <p className="firmware-note">Remote update, firmware backup, and restore controls are still being migrated.</p>
    </Dialog>
  );
}
