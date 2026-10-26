import { Dialog } from "./Dialog";

type ConfirmProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
