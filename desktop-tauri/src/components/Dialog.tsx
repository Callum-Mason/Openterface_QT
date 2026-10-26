import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

type DialogProps = {
  titleId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Blocks Escape, backdrop and close-button dismissal while work is in flight. */
  busy?: boolean;
  alert?: boolean;
  describedBy?: string;
  size?: "sm" | "md" | "lg";
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
};

export function Dialog({
  titleId, title, subtitle, closeLabel, onClose, busy = false, alert = false, describedBy, size = "md", footer, bodyClassName, children,
}: DialogProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={`dialog dialog-${size}`} role={alert ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy}>
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {!alert && <button className="icon-button" type="button" aria-label={closeLabel} onClick={onClose} disabled={busy}><X size={16} /></button>}
        </header>
        <div className={`dialog-body ${bodyClassName ?? ""}`}>{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </section>
    </div>
  );
}
