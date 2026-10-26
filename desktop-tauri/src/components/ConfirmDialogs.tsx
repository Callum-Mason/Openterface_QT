import { Dialog } from "./Dialog";

type ConfirmProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

type FirmwareInstallProps = ConfirmProps & {
  chip: string;
  version: string;
};

export function ResetConfirmationDialog({ open, busy, onClose, onConfirm }: ConfirmProps) {
  if (!open) return null;
  return (
    <Dialog titleId="reset-connection-title" title="Reset serial connection?" describedBy="reset-connection-copy" closeLabel="Close" onClose={onClose} busy={busy} alert size="sm"
      footer={<>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button button-primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Resetting…" : "Reset connection"}</button>
      </>}>
      <p id="reset-connection-copy">The controller connection will close and reopen at its current baud rate. Video may pause briefly; saved settings will stay unchanged.</p>
    </Dialog>
  );
}

export function FactoryResetDialog({ open, busy, onClose, onConfirm }: ConfirmProps) {
  if (!open) return null;
  return (
    <Dialog titleId="factory-reset-title" title="Factory reset HID controller?" describedBy="factory-reset-copy" closeLabel="Close" onClose={onClose} busy={busy} alert size="sm"
      footer={<>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button button-danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Resetting controller…" : "Factory reset"}</button>
      </>}>
      <p id="factory-reset-copy">This resets the controller hardware to its defaults. The baud rate and controller mode may change, and the target USB connection will restart.</p>
    </Dialog>
  );
}

export function FirmwareInstallDialog({ open, busy, chip, version, onClose, onConfirm }: FirmwareInstallProps) {
  if (!open) return null;
  return (
    <Dialog titleId="firmware-install-title" title="Install capture firmware?" describedBy="firmware-install-copy" closeLabel="Close" onClose={onClose} busy={busy} alert size="sm"
      footer={<>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button button-danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Writing firmware…" : "Install firmware"}</button>
      </>}>
      <p id="firmware-install-copy">This writes version <span className="mono">{version}</span> to the connected <span className="mono">{chip}</span> capture chip. Keep the Mini-KVM connected and do not close the app until the write finishes.</p>
    </Dialog>
  );
}

type FirmwareRestoreProps = ConfirmProps & {
  chip: string;
  fileName: string;
};

export function FirmwareRestoreDialog({ open, busy, chip, fileName, onClose, onConfirm }: FirmwareRestoreProps) {
  if (!open) return null;
  return (
    <Dialog titleId="firmware-restore-title" title="Restore capture firmware?" describedBy="firmware-restore-copy" closeLabel="Close" onClose={onClose} busy={busy} alert size="sm"
      footer={<>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button button-danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Writing firmware…" : "Restore firmware"}</button>
      </>}>
      <p id="firmware-restore-copy">This replaces the firmware on the connected <span className="mono">{chip}</span> capture chip with <span className="mono">{fileName}</span>. Only continue with a backup or image made for this exact chip family.</p>
    </Dialog>
  );
}
