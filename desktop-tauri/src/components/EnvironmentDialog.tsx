import { Dialog } from "./Dialog";

type EnvironmentDialogProps = {
  open: boolean;
  rows: { label: string; value: string }[];
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
};

export function EnvironmentDialog({ open, rows, copied, onClose, onCopy }: EnvironmentDialogProps) {
  if (!open) return null;
  return (
    <Dialog titleId="environment-title" title="Environment report" subtitle="System and device details for troubleshooting." closeLabel="Close environment report" onClose={onClose} size="md"
      footer={<>
        <span className="dialog-footer-note" role="status">{copied ? "Report copied." : "Only the details shown here are copied."}</span>
        <button className="button button-secondary" type="button" onClick={onClose}>Close</button>
        <button className="button button-primary" type="button" onClick={onCopy}>Copy report</button>
      </>}>
      <dl className="kv-list">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      <details className="environment-runtime"><summary>Runtime details</summary><p className="mono">{navigator.userAgent}</p></details>
    </Dialog>
  );
}
