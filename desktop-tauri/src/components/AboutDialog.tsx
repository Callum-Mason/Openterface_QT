import { ExternalLink } from "lucide-react";
import openterfaceIcon from "../../../images/icon_32.png";
import type { ExternalDestination } from "../types";
import { Dialog } from "./Dialog";

type AboutDialogProps = {
  open: boolean;
  version: string;
  onClose: () => void;
  onOpenLink: (destination: ExternalDestination) => void;
};

export function AboutDialog({ open, version, onClose, onOpenLink }: AboutDialogProps) {
  if (!open) return null;
  return (
    <Dialog titleId="about-title" title="Openterface Mini-KVM" subtitle="Desktop control console" closeLabel="Close about dialog" onClose={onClose} size="sm"
      footer={<button className="button button-primary" type="button" onClick={onClose}>Done</button>}>
      <div className="about-brand">
        <img src={openterfaceIcon} width="40" height="40" alt="" />
        <p>View and control a target computer with the Mini-KVM.</p>
      </div>
      <dl className="kv-list">
        <div><dt>Version</dt><dd className="mono">{version}</dd></div>
      </dl>
      <div className="about-links" aria-label="Openterface links">
        <button className="text-action" type="button" onClick={() => onOpenLink("website")}>Website <ExternalLink size={13} /></button>
        <button className="text-action" type="button" onClick={() => onOpenLink("purchase")}>Purchase <ExternalLink size={13} /></button>
        <button className="text-action" type="button" onClick={() => onOpenLink("feedback")}>Feedback <ExternalLink size={13} /></button>
        <button className="text-action" type="button" onClick={() => onOpenLink("releases")}>Releases <ExternalLink size={13} /></button>
      </div>
    </Dialog>
  );
}
