import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import {
  ClipboardList,
  ClipboardPaste,
  Activity,
  Cpu,
  Download,
  ExternalLink,
  ImageDown,
  Info,
  Maximize,
  Menu,
  MousePointer2,
  Circle,
  RotateCcw,
  Settings2,
  Square,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { translate } from "../i18n";
import type { MouseMode, RecordingStatus } from "../types";

export type AppMenuActions = {
  preferences: () => void;
  paste: () => void;
  screenshot: () => void;
  toggleRecording: () => void;
  setMouseMode: (mode: MouseMode) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fullscreen: () => void;
  resetConnection: () => void;
  factoryReset: () => void;
  environment: () => void;
  diagnostics: () => void;
  firmware: () => void;
  wchFirmware: () => void;
  checkForUpdates: () => void;
  about: () => void;
  website: () => void;
  feedback: () => void;
  releases: () => void;
  closeWindow: () => void;
};

type AppMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wrapRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  actions: AppMenuActions;
  connected: boolean;
  hasVideo: boolean;
  pasting: boolean;
  pasteDisabled: boolean;
  recordingStatus: RecordingStatus;
  mouseMode: MouseMode;
  fullscreenActive: boolean;
  updateChecking: boolean;
  resettingConnection: boolean;
  factoryResetting: boolean;
  firmwareAvailable: boolean;
};

type ItemOptions = { shortcut?: string; disabled?: boolean; checked?: boolean };

export function AppMenu({
  open, onOpenChange, wrapRef, triggerRef, actions, connected, hasVideo, pasting, pasteDisabled, recordingStatus, mouseMode,
  fullscreenActive, updateChecking, resettingConnection, factoryResetting, firmwareAvailable,
}: AppMenuProps) {
  const navigate = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const item = (label: ReactNode, icon: ReactNode, action: () => void, options: ItemOptions = {}) => (
    <button
      role={options.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={options.checked}
      type="button"
      disabled={options.disabled}
      onClick={() => { onOpenChange(false); action(); }}
    >
      {icon}<span>{label}</span>{options.shortcut && <kbd>{options.shortcut}</kbd>}
    </button>
  );

  return (
    <div className="app-menu-wrap" ref={wrapRef}>
      <button ref={triggerRef} className="icon-button" type="button" aria-label="Open application menu" title="Application menu" aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <Menu size={16} />
      </button>
      {open && <div className="app-menu" role="menu" aria-label="Application menu" onKeyDown={navigate}>
        <div className="app-menu-heading">{translate("Control")}</div>
        {item(pasting ? "Pasting to target…" : "Paste to target", <ClipboardPaste size={15} />, actions.paste, { shortcut: "Ctrl+Shift+V", disabled: !connected || pasteDisabled || pasting })}
        {item("Save target screenshot", <ImageDown size={15} />, actions.screenshot, { shortcut: "Ctrl+Shift+S", disabled: !hasVideo })}
        {item(recordingStatus === "idle" ? "Start video recording" : "Stop and save recording", recordingStatus === "idle" ? <Circle size={15} /> : <Square size={15} />, actions.toggleRecording, { shortcut: "Ctrl+Shift+R", disabled: !hasVideo || recordingStatus === "stopping" })}
        {item("Absolute mouse", <MousePointer2 size={15} />, () => actions.setMouseMode("absolute"), { shortcut: "Ctrl+Alt+A", checked: mouseMode === "absolute" })}
        {item("Relative mouse", <MousePointer2 size={15} />, () => actions.setMouseMode("relative"), { shortcut: "Ctrl+T", checked: mouseMode === "relative" })}
        <div className="app-menu-rule" />
        <div className="app-menu-heading">{translate("View")}</div>
        {item("Zoom in", <ZoomIn size={15} />, actions.zoomIn, { shortcut: "Ctrl++" })}
        {item("Zoom out", <ZoomOut size={15} />, actions.zoomOut, { shortcut: "Ctrl+-" })}
        {item("Actual size", <Square size={15} />, actions.resetZoom, { shortcut: "Ctrl+0" })}
        {item(translate(fullscreenActive ? "Exit full screen" : "Full screen"), <Maximize size={15} />, actions.fullscreen, { shortcut: "Alt+F11" })}
        <div className="app-menu-rule" />
        <div className="app-menu-heading">{translate("Device")}</div>
        {item(translate(resettingConnection ? "Resetting connection…" : "Reset serial connection"), <RotateCcw size={15} />, actions.resetConnection, { disabled: !connected || resettingConnection })}
        {item(translate(factoryResetting ? "Resetting HID controller…" : "Factory reset HID controller"), <TriangleAlert size={15} />, actions.factoryReset, { disabled: !connected || factoryResetting })}
        <div className="app-menu-rule" />
        <div className="app-menu-heading">{translate("Application")}</div>
        {item(translate("Preferences"), <Settings2 size={15} />, actions.preferences, { shortcut: "Ctrl+P" })}
        {item("Environment report", <ClipboardList size={15} />, actions.environment, { shortcut: "Ctrl+E" })}
        {item("Hardware diagnostics", <Activity size={15} />, actions.diagnostics)}
        {item("Capture firmware", <Cpu size={15} />, actions.firmware, { disabled: !firmwareAvailable })}
        {item("Controller firmware", <Cpu size={15} />, actions.wchFirmware)}
        {item(translate(updateChecking ? "Checking for updates…" : "Check for updates"), <Download size={15} />, actions.checkForUpdates, { shortcut: "Ctrl+U", disabled: updateChecking })}
        {item(translate("About Openterface"), <Info size={15} />, actions.about, { shortcut: "F1" })}
        {item("Website", <ExternalLink size={15} />, actions.website)}
        {item("Send feedback", <ExternalLink size={15} />, actions.feedback)}
        {item("View releases", <ExternalLink size={15} />, actions.releases)}
        <div className="app-menu-rule" />
        {item(translate("Close window"), <X size={15} />, actions.closeWindow, { shortcut: "Ctrl+Q" })}
      </div>}
    </div>
  );
}
