import { Activity, CircleAlert, CircleCheck, CircleHelp, RefreshCw } from "lucide-react";
import { Dialog } from "./Dialog";

export type DiagnosticCheck = {
  label: string;
  detail: string;
  status: "pass" | "attention" | "unknown";
};

type DiagnosticsDialogProps = {
  open: boolean;
  checks: DiagnosticCheck[];
  running: boolean;
  lastChecked: string;
  copied: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onCopy: () => void;
};

const statusLabels = { pass: "Ready", attention: "Check", unknown: "Unknown" } as const;

export function DiagnosticsDialog({ open, checks, running, lastChecked, copied, onRefresh, onClose, onCopy }: DiagnosticsDialogProps) {
  if (!open) return null;

  return (
    <Dialog titleId="diagnostics-title" title="Hardware diagnostics" subtitle="Live checks for the controller and capture devices." closeLabel="Close hardware diagnostics" onClose={onClose} size="lg"
      footer={<>
        <span className="dialog-footer-note" role="status">{copied ? "Diagnostic report copied." : `Last checked: ${lastChecked || "Not run"}`}</span>
        <button className="button button-secondary" type="button" onClick={onClose}>Close</button>
        <button className="button button-secondary" type="button" onClick={onCopy}><Activity size={14} />Copy report</button>
        <button className="button button-primary" type="button" onClick={onRefresh} disabled={running}><RefreshCw size={14} />{running ? "Checking…" : "Run checks"}</button>
      </>}>
      <div className="diagnostics-grid">
        {checks.map((check) => {
          const Icon = check.status === "pass" ? CircleCheck : check.status === "attention" ? CircleAlert : CircleHelp;
          return (
            <article className="diagnostic-card" data-status={check.status} key={check.label}>
              <div className="diagnostic-card-heading"><Icon size={17} aria-hidden="true" /><h3>{check.label}</h3><span>{statusLabels[check.status]}</span></div>
              <p>{check.detail}</p>
            </article>
          );
        })}
      </div>
      <p className="diagnostics-note">These checks report what the app can observe. USB cable unplug/replug tests and the Qt serial stress test require hands-on testing and are not marked complete here.</p>
    </Dialog>
  );
}
