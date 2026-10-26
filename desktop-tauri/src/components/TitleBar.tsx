import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { translate } from "../i18n";
import openterfaceIcon from "../../../images/icon_32.png";

type TitleBarProps = {
  connected: boolean;
  onClose: () => void;
  actions: ReactNode;
};

type AppWindow = ReturnType<typeof getCurrentWindow>;

const glyph = { width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: 1, "aria-hidden": true } as const;

export function TitleBar({ connected, onClose, actions }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    const sync = () => { void appWindow.isMaximized().then((value) => { if (!disposed) setMaximized(value); }).catch(() => undefined); };
    sync();
    const unlisten = appWindow.onResized(sync);
    return () => { disposed = true; void unlisten.then((dispose) => dispose()).catch(() => undefined); };
  }, []);

  const windowAction = (run: (appWindow: AppWindow) => Promise<void>) => () => {
    if (!isTauri()) return;
    void run(getCurrentWindow()).catch(() => undefined);
  };

  return (
    <header className="titlebar" data-tauri-drag-region onDoubleClick={windowAction((appWindow) => appWindow.toggleMaximize())}>
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src={openterfaceIcon} width="16" height="16" alt="" data-tauri-drag-region />
        <span data-tauri-drag-region>Openterface Mini-KVM</span>
      </div>
      <div className="titlebar-state" data-tauri-drag-region>
        <span className={`state-dot ${connected ? "on" : ""}`} aria-hidden="true" />
        <span role="status" aria-live="polite">{translate(connected ? "Connected" : "Disconnected")}</span>
      </div>
      <div className="titlebar-actions" onDoubleClick={(event) => event.stopPropagation()}>{actions}</div>
      <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" className="window-control" aria-label="Minimize" onClick={windowAction((appWindow) => appWindow.minimize())}>
          <svg {...glyph}><path d="M0 5.5h10" /></svg>
        </button>
        <button type="button" className="window-control" aria-label={maximized ? "Restore" : "Maximize"} onClick={windowAction((appWindow) => appWindow.toggleMaximize())}>
          {maximized
            ? <svg {...glyph}><path d="M2.5 2.5v-2h7v7h-2M0.5 2.5h7v7h-7z" /></svg>
            : <svg {...glyph}><path d="M0.5 0.5h9v9h-9z" /></svg>}
        </button>
        <button type="button" className="window-control window-close" aria-label="Close" onClick={onClose}>
          <svg {...glyph}><path d="M0 0l10 10M10 0L0 10" /></svg>
        </button>
      </div>
    </header>
  );
}
