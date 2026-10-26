import { Plug, RefreshCw, Settings2, X } from "lucide-react";
import type { ControllerStatus, KvmDevice, MouseMode, UsbRoute } from "../types";

type DeviceRailProps = {
  devices: KvmDevice[];
  selectedPort: string;
  onSelectPort: (port: string) => void;
  selectedDevice: KvmDevice | undefined;
  connected: boolean;
  connecting: boolean;
  loadingDevices: boolean;
  controllerStatus: ControllerStatus | null;
  hasVideo: boolean;
  videoInputCount: number;
  usbRoute: UsbRoute;
  switchingUsbRoute: boolean;
  onSwitchRoute: (route: "host" | "target") => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onScan: () => void;
  connectionLabel: string;
  controllerMode: number;
  mouseMode: MouseMode;
  onOpenPreferences: () => void;
};

export function DeviceRail({
  devices, selectedPort, onSelectPort, selectedDevice, connected, connecting, loadingDevices, controllerStatus, hasVideo, videoInputCount,
  usbRoute, switchingUsbRoute, onSwitchRoute, onConnect, onDisconnect, onScan, connectionLabel, controllerMode, mouseMode, onOpenPreferences,
}: DeviceRailProps) {
  const targetUsb = connected && controllerStatus ? controllerStatus.targetConnected ? "Connected" : "Disconnected" : connected ? "Checking…" : "—";
  const videoInput = hasVideo ? "Live capture" : videoInputCount ? `${videoInputCount} available` : selectedDevice?.hasCamera ? "Available" : "Not detected";
  const inputHint = controllerMode === 3 ? "Custom HID input is not yet available in this Tauri build."
    : controllerMode === 1 ? "Click the target display to send keyboard input."
      : mouseMode === "relative" ? "Click the target display to capture the pointer. Press Escape to release it."
        : "Click the target display to send keyboard and mouse input.";

  return (
    <aside className="rail" aria-label="Connection controls">
      <section className="rail-section">
        <div className="rail-heading"><h2>Device</h2>
          <button className="icon-button icon-button-sm" type="button" aria-label="Scan for USB devices" title="Scan for USB devices" onClick={onScan} disabled={loadingDevices}>
            <RefreshCw size={14} className={loadingDevices ? "spin" : ""} />
          </button>
        </div>
        <label className="field-label" htmlFor="device-port">Controller port</label>
        <select id="device-port" className="select" value={selectedPort} onChange={(event) => onSelectPort(event.target.value)} disabled={connected || connecting || devices.length === 0}>
          {devices.length === 0 && <option value="">No controller detected</option>}
          {devices.map((device) => <option key={device.portName} value={device.portName}>{device.controller ? `${device.controller} · ${device.portName}` : `${device.portName} · USB serial`}</option>)}
        </select>
        {connected
          ? <button className="button button-secondary button-block" type="button" onClick={onDisconnect}><X size={14} />Disconnect</button>
          : <button className="button button-primary button-block" type="button" onClick={onConnect} disabled={!selectedPort || loadingDevices || connecting}><Plug size={14} />{connecting ? "Connecting…" : "Connect device"}</button>}
      </section>

      <section className="rail-section">
        <div className="rail-heading"><h2>Status</h2></div>
        <dl className="kv-list">
          <div><dt>Controller</dt><dd>{connected ? selectedDevice?.controller ?? "Online" : "Offline"}</dd></div>
          <div><dt>Port</dt><dd className="mono">{connected ? selectedPort || "—" : "—"}</dd></div>
          <div><dt>Target USB</dt><dd>{targetUsb}</dd></div>
          <div><dt>Video input</dt><dd>{videoInput}</dd></div>
          <div><dt>Link</dt><dd>{connected ? connectionLabel : selectedDevice?.generation ?? "Ready"}</dd></div>
        </dl>
      </section>

      <section className="rail-section" role="group" aria-label="Switchable USB route">
        <div className="rail-heading"><h2>USB route</h2></div>
        <div className="segmented">
          <button type="button" aria-pressed={usbRoute === "host"} className={usbRoute === "host" ? "selected" : ""} disabled={!connected || switchingUsbRoute} onClick={() => onSwitchRoute("host")}>{switchingUsbRoute ? "Switching…" : "Host"}</button>
          <button type="button" aria-pressed={usbRoute === "target"} className={usbRoute === "target" ? "selected" : ""} disabled={!connected || switchingUsbRoute} onClick={() => onSwitchRoute("target")}>{switchingUsbRoute ? "Switching…" : "Target"}</button>
        </div>
      </section>

      <section className="rail-section rail-section-end">
        <div className="rail-heading"><h2>Input</h2></div>
        <p className="rail-note">{inputHint}</p>
        <button className="text-action" type="button" onClick={onOpenPreferences}><Settings2 size={13} />Keyboard preferences</button>
      </section>
    </aside>
  );
}
