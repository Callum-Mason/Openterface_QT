import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent, WheelEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import openterfaceIcon from "../../images/icon_32.png";
import {
  AudioLines,
  Camera,
  ChevronDown,
  ClipboardPaste,
  Circle,
  ExternalLink,
  ImageDown,
  Info,
  Keyboard,
  Maximize,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Plug,
  RefreshCw,
  Settings2,
  Square,
  ZoomIn,
  ZoomOut,
  Usb,
  Video,
  X,
} from "lucide-react";

type ExternalDestination = "website" | "purchase" | "feedback" | "releases";
type ReleaseSummary = { version: string; title: string; notes: string; updateAvailable: boolean };
const externalDestinations: Record<ExternalDestination, string> = {
  website: "https://openterface.com/",
  purchase: "https://www.crowdsupply.com/techxartisan/openterface-mini-kvm",
  feedback: "https://forms.gle/KNQPTNfXCPUPybgG9",
  releases: "https://github.com/TechxArtisanStudio/Openterface_QT/releases",
};

function compareReleaseVersions(current: string, latest: string) {
  const parse = (value: string) => {
    const segments = value.trim().replace(/^v/i, "").split(/[+-]/, 1)[0].split(".");
    if (!segments.length || segments.some((part) => !/^\d+$/.test(part))) return null;
    return segments.map(Number);
  };
  const currentParts = parse(current);
  const latestParts = parse(latest);
  if (!currentParts || !latestParts) return null;
  const count = Math.max(currentParts.length, latestParts.length);
  for (let index = 0; index < count; index += 1) {
    const left = currentParts[index] ?? 0;
    const right = latestParts[index] ?? 0;
    if (left !== right) return right > left;
  }
  return false;
}

type KvmDevice = {
  portName: string;
  manufacturer: string | null;
  product: string | null;
  serialNumber: string | null;
  vendorId: number | null;
  productId: number | null;
  controller: string | null;
  generation: string | null;
  cameraName: string | null;
  hasHid: boolean;
  hasCamera: boolean;
  hasAudio: boolean;
};

type ControllerStatus = {
  targetConnected: boolean;
  numLock: boolean;
  capsLock: boolean;
  scrollLock: boolean;
};

type CapturePreset = "720p30" | "1080p30" | "1080p60";
type MouseMode = "absolute" | "relative";
type UsbRoute = "unknown" | "host" | "target";
type RecordingStatus = "idle" | "recording" | "paused" | "stopping";
type AppPreferences = {
  preferredControllerPort: string;
  preferredVideoDevice: string;
  preferredAudioDevice: string;
  audioVolume: number;
  captureQuality: CapturePreset;
  captureSystemShortcuts: boolean;
  inhibitScreenSaver: boolean;
  controllerMode: number;
  mouseMode: MouseMode;
  mouseAutoHide: boolean;
  keyboardLayout: string;
};

type KeyboardLayoutInfo = { id: string; name: string };

const capturePresetConstraints: Record<CapturePreset, { width: number; height: number; frameRate: number }> = {
  "720p30": { width: 1280, height: 720, frameRate: 30 },
  "1080p30": { width: 1920, height: 1080, frameRate: 30 },
  "1080p60": { width: 1920, height: 1080, frameRate: 60 },
};

function readPreference(key: string, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

type PreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  devices: KvmDevice[];
  selectedPort: string;
  onSelectPort: (port: string) => void;
  controllerSelectionDisabled: boolean;
  connected: boolean;
  controllerType: string | null;
  baudRate: number;
  baudRateApplying: boolean;
  onBaudRateChange: (baudRate: number) => void;
  onApplyBaudRate: () => void;
  controllerMode: number;
  modeApplying: boolean;
  onControllerModeChange: (mode: number) => void;
  onApplyControllerMode: () => void;
  videoDevices: MediaDeviceInfo[];
  videoDeviceId: string;
  onSelectVideo: (deviceId: string) => void;
  audioDevices: MediaDeviceInfo[];
  audioDeviceId: string;
  onSelectAudioDevice: (deviceId: string) => void;
  onRefreshAudioDevices: () => void;
  audioEnabled: boolean;
  audioStarting: boolean;
  onToggleAudio: (enabled: boolean) => void;
  audioVolume: number;
  onAudioVolumeChange: (volume: number) => void;
  capturePreset: CapturePreset;
  onCapturePresetChange: (preset: CapturePreset) => void;
  captureSystemShortcuts: boolean;
  onCaptureSystemShortcutsChange: (enabled: boolean) => void;
  inhibitScreenSaver: boolean;
  onInhibitScreenSaverChange: (enabled: boolean) => void;
  mouseMode: MouseMode;
  onMouseModeChange: (mode: MouseMode) => void;
  mouseAutoHide: boolean;
  onMouseAutoHideChange: (enabled: boolean) => void;
  keyboardLayouts: KeyboardLayoutInfo[];
  keyboardLayout: string;
  onKeyboardLayoutChange: (layout: string) => void;
};

function PreferencesDialog({
  open, onClose, devices, selectedPort, onSelectPort, controllerSelectionDisabled, videoDevices, videoDeviceId,
  onSelectVideo, capturePreset, onCapturePresetChange, captureSystemShortcuts,
  audioDevices, audioDeviceId, onSelectAudioDevice, onRefreshAudioDevices, audioEnabled, audioStarting, onToggleAudio, audioVolume, onAudioVolumeChange,
  onCaptureSystemShortcutsChange, inhibitScreenSaver, onInhibitScreenSaverChange,
  mouseMode, onMouseModeChange, mouseAutoHide, onMouseAutoHideChange,
  keyboardLayouts, keyboardLayout, onKeyboardLayoutChange,
  connected, controllerType, baudRate, baudRateApplying, onBaudRateChange, onApplyBaudRate,
  controllerMode, modeApplying, onControllerModeChange, onApplyControllerMode,
}: PreferencesDialogProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="preferences-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
        <header className="preferences-header">
          <div><h2 id="preferences-title">Preferences</h2></div>
          <button className="icon-button" type="button" aria-label="Close preferences" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="preferences-body">
          <section className="preference-section" aria-labelledby="device-preferences-title">
            <div className="preference-section-heading"><Usb size={16} /><div><h3 id="device-preferences-title">Devices</h3><p>Choose which hardware to use when available.</p></div></div>
            <label className="preference-field"><span>Preferred controller</span>
              <select value={selectedPort} onChange={(event) => onSelectPort(event.target.value)} disabled={devices.length === 0 || controllerSelectionDisabled}>
                {devices.length === 0 && <option value="">No controller detected</option>}
                {devices.map((device) => <option key={device.portName} value={device.portName}>{[device.controller, device.portName].filter(Boolean).join(" · ")}</option>)}
              </select>
            </label>
            <label className="preference-field"><span>Preferred video input</span>
              <select value={videoDeviceId} onChange={(event) => onSelectVideo(event.target.value)} disabled={videoDevices.length === 0}>
                {videoDevices.length === 0 && <option value="">Connect a controller to discover inputs</option>}
                {videoDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Video input ${index + 1}`}</option>)}
              </select>
            </label>
            <label className="preference-field"><span>Controller baud rate</span>
              <select value={baudRate} onChange={(event) => onBaudRateChange(Number(event.target.value))} disabled={!connected || controllerType === "CH32V208" || baudRateApplying}>
                <option value={9600}>9600</option>
                <option value={115200}>115200</option>
              </select>
            </label>
            {controllerType === "CH32V208" && <p className="preference-note">CH32V208 controllers use 115200 baud.</p>}
            {controllerType !== "CH32V208" && <div className="preference-action-row">
              <button className="button button-secondary" type="button" onClick={onApplyBaudRate} disabled={!connected || ![9600, 115200].includes(baudRate) || baudRateApplying}>
                {baudRateApplying ? "Restarting controller…" : "Apply baud rate and restart"}
              </button>
            </div>}
            {controllerType === "CH9329" && <p className="preference-note">The controller saves this rate and restarts. The target USB connection may pause briefly.</p>}
          </section>

          <section className="preference-section" aria-labelledby="video-preferences-title">
            <div className="preference-section-heading"><Camera size={16} /><div><h3 id="video-preferences-title">Video capture</h3><p>Choose a preferred size and frame rate for the USB capture source.</p></div></div>
            <label className="preference-field"><span>Capture quality</span>
              <select value={capturePreset} onChange={(event) => onCapturePresetChange(event.target.value as CapturePreset)}>
                <option value="720p30">1280 × 720 at 30 fps</option>
                <option value="1080p30">1920 × 1080 at 30 fps</option>
                <option value="1080p60">1920 × 1080 at 60 fps</option>
              </select>
            </label>
            <p className="preference-note">The capture device may use a lower mode if the selected quality is unavailable. Video recordings use this source and save as WebM without audio.</p>
          </section>

          <section className="preference-section" aria-labelledby="audio-preferences-title">
            <div className="preference-section-heading"><AudioLines size={16} /><div><h3 id="audio-preferences-title">Audio pass-through</h3><p>Route audio from the selected capture input to the Windows default output.</p></div></div>
            <label className="preference-field"><span>Audio input</span>
              <select value={audioDeviceId} onChange={(event) => onSelectAudioDevice(event.target.value)} disabled={audioDevices.length === 0 || audioStarting}>
                {audioDevices.length === 0 && <option value="">No audio inputs detected</option>}
                {audioDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Audio input ${index + 1}`}</option>)}
              </select>
            </label>
            <div className="preference-action-row"><button className="button button-secondary" type="button" onClick={onRefreshAudioDevices} disabled={audioStarting}><RefreshCw size={14} />Refresh audio inputs</button></div>
            <label className="preference-switch"><span><strong>Enable live audio</strong><small>{audioStarting ? "Requesting audio access…" : audioEnabled ? "Playing through the Windows default output." : "Audio access is requested only when enabled."}</small></span>
              <input type="checkbox" checked={audioEnabled} onChange={(event) => onToggleAudio(event.target.checked)} disabled={!audioDeviceId || audioStarting} />
            </label>
            <label className="preference-slider"><span>Output volume <strong>{audioVolume}%</strong></span><input type="range" min="0" max="100" step="1" value={audioVolume} onChange={(event) => onAudioVolumeChange(Number(event.target.value))} disabled={!audioEnabled} /></label>
            <p className="preference-note">Choose an Openterface audio input. Audio is not included in WebM recordings in this build.</p>
          </section>

          <section className="preference-section" aria-labelledby="controller-mode-title">
            <div className="preference-section-heading"><Usb size={16} /><div><h3 id="controller-mode-title">Target controller mode</h3><p>Choose the USB keyboard and mouse profile presented to the target.</p></div></div>
            <label className="preference-field"><span>Operating mode</span>
              <select value={controllerMode} onChange={(event) => onControllerModeChange(Number(event.target.value))}>
                <option value={0}>Performance: keyboard, mouse and custom HID</option>
                <option value={1}>Keyboard only</option>
                <option value={2}>Compatibility: keyboard and mouse</option>
                <option value={3}>Custom HID</option>
              </select>
            </label>
            {controllerType === "CH32V208" && <p className="preference-note">CH32V208 firmware does not support mode changes.</p>}
            {controllerType === "CH9329" && <p className="preference-note">Applying a mode writes the controller configuration, resets it, and briefly disconnects the target USB device.</p>}
            {!controllerType && <p className="preference-note">Connect a CH9329 controller to apply an operating mode.</p>}
            <div className="preference-action-row">
              <button className="button button-secondary" type="button" onClick={onApplyControllerMode} disabled={!connected || controllerType !== "CH9329" || modeApplying}>
                {modeApplying ? "Restarting controller…" : "Apply and restart controller"}
              </button>
            </div>
          </section>

          <section className="preference-section" aria-labelledby="pointer-preferences-title">
            <div className="preference-section-heading"><MousePointer2 size={16} /><div><h3 id="pointer-preferences-title">Pointer control</h3><p>Choose how mouse movement reaches the target computer.</p></div></div>
            <label className="preference-field"><span>Mouse mode</span>
              <select value={mouseMode} onChange={(event) => onMouseModeChange(event.target.value as MouseMode)}>
                <option value="absolute">Absolute: point to a position</option>
                <option value="relative">Relative: capture movement</option>
              </select>
            </label>
            <p className="preference-note">In relative mode, click the target display to capture the pointer. Press Escape to release it.</p>
            <label className="preference-switch preference-switch-secondary"><span><strong>Hide pointer over target</strong><small>Show the host pointer again outside the display.</small></span>
              <input type="checkbox" checked={mouseAutoHide} onChange={(event) => onMouseAutoHideChange(event.target.checked)} />
            </label>
          </section>

          <section className="preference-section" aria-labelledby="keyboard-preferences-title">
            <div className="preference-section-heading"><Keyboard size={16} /><div><h3 id="keyboard-preferences-title">Keyboard and Windows</h3><p>Control shortcut forwarding and Windows idle behavior.</p></div></div>
            <label className="preference-field"><span>Target keyboard layout</span>
              <select value={keyboardLayout} onChange={(event) => onKeyboardLayoutChange(event.target.value)}>
                {keyboardLayouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
              </select>
            </label>
            <p className="preference-note">This layout is used when typing clipboard text on the target. Unsupported characters are skipped and reported.</p>
            <label className="preference-switch"><span><strong>Capture system shortcuts</strong><small>Alt+Tab and the Windows key while target control is active.</small></span>
              <input type="checkbox" checked={captureSystemShortcuts} onChange={(event) => onCaptureSystemShortcutsChange(event.target.checked)} />
            </label>
            <p className="preference-note">Ctrl+Alt+Delete remains reserved by Windows.</p>
            <label className="preference-switch preference-switch-secondary"><span><strong>Inhibit screen saver</strong><small>Keep the display and system awake while enabled.</small></span>
              <input type="checkbox" checked={inhibitScreenSaver} onChange={(event) => onInhibitScreenSaverChange(event.target.checked)} />
            </label>
          </section>
        </div>
        <footer className="preferences-footer"><span>Changes are saved automatically.</span><button className="button button-secondary" type="button" onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
}

type AboutDialogProps = {
  open: boolean;
  version: string;
  onClose: () => void;
  onOpenLink: (destination: ExternalDestination) => void;
};

function AboutDialog({ open, version, onClose, onOpenLink }: AboutDialogProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="about-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="about-header">
          <div className="about-brand">
            <img src={openterfaceIcon} width="40" height="40" alt="" />
            <div><h2 id="about-title">Openterface Mini-KVM</h2><p>Desktop control console</p></div>
          </div>
          <button className="icon-button" type="button" aria-label="Close about dialog" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="about-body">
          <p>View and control a target computer with the Mini-KVM.</p>
          <dl className="about-version"><dt>Version</dt><dd>{version}</dd></dl>
          <div className="about-links" aria-label="Openterface links">
            <button className="text-action" type="button" onClick={() => onOpenLink("website")}>Website <ExternalLink size={14} /></button>
            <button className="text-action" type="button" onClick={() => onOpenLink("purchase")}>Purchase <ExternalLink size={14} /></button>
            <button className="text-action" type="button" onClick={() => onOpenLink("feedback")}>Feedback <ExternalLink size={14} /></button>
            <button className="text-action" type="button" onClick={() => onOpenLink("releases")}>Releases <ExternalLink size={14} /></button>
          </div>
        </div>
        <footer className="about-footer"><button className="button button-secondary" type="button" onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
}

type EnvironmentDialogProps = {
  open: boolean;
  rows: { label: string; value: string }[];
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
};

function EnvironmentDialog({ open, rows, copied, onClose, onCopy }: EnvironmentDialogProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="about-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="about-dialog environment-dialog" role="dialog" aria-modal="true" aria-labelledby="environment-title">
        <header className="about-header"><div><h2 id="environment-title">Environment report</h2><p>System and device details for troubleshooting.</p></div><button className="icon-button" type="button" aria-label="Close environment report" onClick={onClose}><X size={17} /></button></header>
        <div className="about-body">
          <dl className="environment-list">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          <details className="environment-runtime"><summary>Runtime details</summary><p>{navigator.userAgent}</p></details>
        </div>
        <footer className="about-footer environment-footer"><span className="copy-status" role="status">{copied ? "Report copied." : "Only the details shown here are copied."}</span><button className="button button-secondary" type="button" onClick={onClose}>Close</button><button className="button button-primary" type="button" onClick={onCopy}>Copy report</button></footer>
      </section>
    </div>
  );
}

type UpdateDialogProps = {
  open: boolean;
  currentVersion: string;
  release: ReleaseSummary | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onOpenReleases: () => void;
};

function UpdateDialog({ open, currentVersion, release, loading, error, onClose, onOpenReleases }: UpdateDialogProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, loading, onClose]);

  if (!open) return null;
  return (
    <div className="about-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}>
      <section className="about-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <header className="about-header"><div><h2 id="update-title">Check for updates</h2><p>Openterface Mini-KVM desktop</p></div><button className="icon-button" type="button" aria-label="Close update check" onClick={onClose} disabled={loading}><X size={17} /></button></header>
        <div className="about-body" aria-live="polite">
          {loading && <p>Checking the latest GitHub release…</p>}
          {!loading && error && <p className="update-error" role="alert">{error}</p>}
          {!loading && !error && release && (release.updateAvailable ? <>
            <p className="update-state">A newer version is available.</p>
            <dl className="about-version"><dt>Current version</dt><dd>{currentVersion}</dd></dl>
            <dl className="about-version"><dt>Latest version</dt><dd>{release.version}</dd></dl>
            {release.title && <h3 className="update-release-title">{release.title}</h3>}
            {release.notes && <p className="update-notes">{release.notes}</p>}
          </> : <p className="update-state">You’re up to date. Current version: {currentVersion}.</p>)}
        </div>
        <footer className="about-footer environment-footer"><button className="button button-secondary" type="button" onClick={onClose} disabled={loading}>Close</button><button className="button button-primary" type="button" onClick={onOpenReleases} disabled={loading}>Open releases</button></footer>
      </section>
    </div>
  );
}

type ResetConfirmationProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function ResetConfirmationDialog({ open, busy, onClose, onConfirm }: ResetConfirmationProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, busy, onClose]);

  if (!open) return null;
  return (
    <div className="preferences-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="preferences-dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-connection-title" aria-describedby="reset-connection-copy">
        <header className="preferences-header"><h2 id="reset-connection-title">Reset serial connection?</h2></header>
        <div className="preferences-body confirmation-copy"><p id="reset-connection-copy">The controller connection will close and reopen at its current baud rate. Video may pause briefly; saved settings will stay unchanged.</p></div>
        <footer className="preferences-footer confirmation-footer"><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Resetting…" : "Reset connection"}</button></footer>
      </section>
    </div>
  );
}

function FactoryResetDialog({ open, busy, onClose, onConfirm }: ResetConfirmationProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, busy, onClose]);

  if (!open) return null;
  return (
    <div className="preferences-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="preferences-dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="factory-reset-title" aria-describedby="factory-reset-copy">
        <header className="preferences-header"><h2 id="factory-reset-title">Factory reset HID controller?</h2></header>
        <div className="preferences-body confirmation-copy"><p id="factory-reset-copy">This resets the controller hardware to its defaults. The baud rate and controller mode may change, and the target USB connection will restart.</p></div>
        <footer className="preferences-footer confirmation-footer"><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Resetting controller…" : "Factory reset"}</button></footer>
      </section>
    </div>
  );
}

const keyUsages: Record<string, number> = {
  KeyA: 0x04, KeyB: 0x05, KeyC: 0x06, KeyD: 0x07, KeyE: 0x08,
  KeyF: 0x09, KeyG: 0x0a, KeyH: 0x0b, KeyI: 0x0c, KeyJ: 0x0d,
  KeyK: 0x0e, KeyL: 0x0f, KeyM: 0x10, KeyN: 0x11, KeyO: 0x12,
  KeyP: 0x13, KeyQ: 0x14, KeyR: 0x15, KeyS: 0x16, KeyT: 0x17,
  KeyU: 0x18, KeyV: 0x19, KeyW: 0x1a, KeyX: 0x1b, KeyY: 0x1c, KeyZ: 0x1d,
  Digit1: 0x1e, Digit2: 0x1f, Digit3: 0x20, Digit4: 0x21, Digit5: 0x22,
  Digit6: 0x23, Digit7: 0x24, Digit8: 0x25, Digit9: 0x26, Digit0: 0x27,
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
  Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30,
  Backslash: 0x31, IntlBackslash: 0x64, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
  Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
  F1: 0x3a, F2: 0x3b, F3: 0x3c, F4: 0x3d, F5: 0x3e, F6: 0x3f,
  F7: 0x40, F8: 0x41, F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45,
  PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49,
  Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
  ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
  NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55,
  NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58,
  Numpad1: 0x59, Numpad2: 0x5a, Numpad3: 0x5b, Numpad4: 0x5c,
  Numpad5: 0x5d, Numpad6: 0x5e, Numpad7: 0x5f, Numpad8: 0x60,
  Numpad9: 0x61, Numpad0: 0x62, NumpadDecimal: 0x63,
  ContextMenu: 0x65, Power: 0x66, NumpadEqual: 0x67,
  F13: 0x68, F14: 0x69, F15: 0x6a, F16: 0x6b, F17: 0x6c, F18: 0x6d,
  F19: 0x6e, F20: 0x6f, F21: 0x70, F22: 0x71, F23: 0x72, F24: 0x73,
  IntlRo: 0x87, KanaMode: 0x88, IntlYen: 0x89, Convert: 0x8a, NonConvert: 0x8b,
  Lang1: 0x90, Lang2: 0x91, Lang3: 0x92, Lang4: 0x93, Lang5: 0x94,
};

const modifierBits: Record<string, number> = {
  ControlLeft: 0x01, ShiftLeft: 0x02, AltLeft: 0x04, MetaLeft: 0x08,
  ControlRight: 0x10, ShiftRight: 0x20, AltRight: 0x40, MetaRight: 0x80,
};

function targetCoordinates(event: { clientX: number; clientY: number }, video: HTMLVideoElement, zoom = 1) {
  const bounds = video.parentElement?.getBoundingClientRect() ?? video.getBoundingClientRect();
  const videoWidth = video.videoWidth || bounds.width;
  const videoHeight = video.videoHeight || bounds.height;
  const scale = Math.min(bounds.width / videoWidth, bounds.height / videoHeight);
  const contentWidth = videoWidth * scale;
  const contentHeight = videoHeight * scale;
  const left = bounds.left + (bounds.width - contentWidth) / 2;
  const top = bounds.top + (bounds.height - contentHeight) / 2;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const unzoomedX = centerX + (event.clientX - centerX) / zoom;
  const unzoomedY = centerY + (event.clientY - centerY) / zoom;
  // The legacy controller maps the video surface to an inclusive 0–4096 range.
  const x = Math.round(Math.min(1, Math.max(0, (unzoomedX - left) / contentWidth)) * 4096);
  const y = Math.round(Math.min(1, Math.max(0, (unzoomedY - top) / contentHeight)) * 4096);
  return { x, y };
}

async function enumerateVideoInputs() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
  } catch {
    return [];
  }
}

async function enumerateAudioInputs() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  } catch {
    return [];
  }
}

function formatRecordingDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function App() {
  const [devices, setDevices] = useState<KvmDevice[]>([]);
  const [selectedPort, setSelectedPort] = useState(() => readPreference("preferred-controller-port"));
  const [connected, setConnected] = useState(false);
  const [usbRoute, setUsbRoute] = useState<UsbRoute>("unknown");
  const [switchingUsbRoute, setSwitchingUsbRoute] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [controllerStatus, setControllerStatus] = useState<ControllerStatus | null>(null);
  const [connectionLabel, setConnectionLabel] = useState("Disconnected");
  const [controllerBaudRate, setControllerBaudRate] = useState(9600);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [keyboardLayouts, setKeyboardLayouts] = useState<KeyboardLayoutInfo[]>([]);
  const [keyboardLayout, setKeyboardLayout] = useState(() => readPreference("keyboard-layout", "qwerty_us"));
  const [pasting, setPasting] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [videoZoom, setVideoZoom] = useState(1);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState(() => readPreference("preferred-video-device"));
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState(() => readPreference("preferred-audio-device"));
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStarting, setAudioStarting] = useState(false);
  const [audioVolume, setAudioVolume] = useState(() => {
    const stored = Number(readPreference("audio-volume", "80"));
    return Number.isInteger(stored) && stored >= 0 && stored <= 100 ? stored : 80;
  });
  const [capturePreset, setCapturePreset] = useState<CapturePreset>(() => {
    const stored = readPreference("capture-quality", "1080p60");
    return stored in capturePresetConstraints ? stored as CapturePreset : "1080p60";
  });
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [resettingConnection, setResettingConnection] = useState(false);
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [environmentCopied, setEnvironmentCopied] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState("");
  const [latestRelease, setLatestRelease] = useState<ReleaseSummary | null>(null);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [appVersion, setAppVersion] = useState(isTauri() ? "…" : "Development preview");
  const appMenuRef = useRef<HTMLDivElement>(null);
  const appMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [preferencesReady, setPreferencesReady] = useState(() => !isTauri());
  const [inhibitScreenSaver, setInhibitScreenSaver] = useState(() => readPreference("inhibit-screen-saver") === "true");
  const [mouseMode, setMouseMode] = useState<MouseMode>(() => readPreference("mouse-mode", "absolute") === "relative" ? "relative" : "absolute");
  const [mouseAutoHide, setMouseAutoHide] = useState(() => readPreference("mouse-auto-hide", "true") !== "false");
  const [controllerMode, setControllerMode] = useState(() => {
    const stored = Number(readPreference("controller-mode", "2"));
    return Number.isInteger(stored) && stored >= 0 && stored <= 3 ? stored : 2;
  });
  const [appliedControllerMode, setAppliedControllerMode] = useState(controllerMode);
  const [modeApplying, setModeApplying] = useState(false);
  const [baudRateApplying, setBaudRateApplying] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [controlActive, setControlActive] = useState(false);
  const [captureSystemShortcuts, setCaptureSystemShortcuts] = useState(() => {
    try {
      return window.localStorage.getItem("capture-system-shortcuts") === "true";
    } catch {
      return false;
    }
  });
  const [targetName, setTargetName] = useState("No signal");
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeVideoStream = useRef<MediaStream | null>(null);
  const activeAudioStream = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioRequestId = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStopPromiseRef = useRef<Promise<void> | null>(null);
  const recordingClockRef = useRef({ elapsedMs: 0, segmentStartedAt: 0 });
  const videoRequestId = useRef(0);
  const captureRequestId = useRef(0);
  const heldKeys = useRef(new Set<string>());
  const heldButtons = useRef(0);
  const lastMouseSend = useRef(0);
  const lastMousePosition = useRef({ x: 0, y: 0 });
  const pointerLockIntent = useRef(false);
  const selectedDevice = devices.find((device) => device.portName === selectedPort);
  const environmentRows = [
    { label: "Application", value: `Openterface Mini-KVM ${appVersion}` },
    { label: "Desktop runtime", value: isTauri() ? "Tauri with WebView2" : "Browser preview" },
    { label: "Operating system", value: navigator.platform || "Unknown" },
    { label: "Controller", value: connected ? selectedDevice?.controller ?? "Connected" : "Disconnected" },
    { label: "Serial port", value: connected ? selectedPort : "Not connected" },
    { label: "Target status", value: controllerStatus ? controllerStatus.targetConnected ? "Online" : "Offline" : connected ? "Unknown" : "Not connected" },
    { label: "Video source", value: videoStream ? videoStream.getVideoTracks()[0]?.label || targetName : "Not streaming" },
    { label: "Capture devices found", value: String(videoDevices.length) },
    { label: "Capture preset", value: capturePreset },
    { label: "Target recording", value: recordingStatus === "idle" ? "Stopped" : recordingStatus === "paused" ? "Paused" : recordingStatus === "stopping" ? "Saving" : "Recording" },
    { label: "System shortcut capture", value: captureSystemShortcuts ? "Enabled" : "Disabled" },
    { label: "Screen-saver inhibition", value: inhibitScreenSaver ? "Enabled" : "Disabled" },
  ];
  const environmentReport = [
    ...environmentRows.map(({ label, value }) => `${label}: ${value}`),
    `Runtime details: ${navigator.userAgent}`,
  ].join("\n");

  const copyEnvironmentReport = async () => {
    try {
      await navigator.clipboard.writeText(environmentReport);
      setEnvironmentCopied(true);
    } catch (cause) {
      setError(`Could not copy the environment report: ${String(cause)}`);
    }
  };

  const checkForUpdates = async () => {
    setAppMenuOpen(false);
    setUpdateDialogOpen(true);
    setUpdateChecking(true);
    setUpdateCheckError("");
    setLatestRelease(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      if (!/^v?\d+(\.\d+){1,3}/i.test(appVersion)) {
        throw new Error("The current application version is unavailable.");
      }
      const response = await fetch("https://api.github.com/repos/TechxArtisanStudio/Openterface_QT/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status} while checking releases.`);
      const data = await response.json() as { tag_name?: unknown; name?: unknown; body?: unknown };
      const version = typeof data.tag_name === "string" ? data.tag_name : "";
      if (!version) throw new Error("The latest release did not include a version tag.");
      const updateAvailable = compareReleaseVersions(appVersion, version);
      if (updateAvailable === null) throw new Error("Could not compare the installed and latest version numbers.");
      const notes = typeof data.body === "string" ? data.body.replace(/[#*`_\[\]()]/g, "").trim() : "";
      setLatestRelease({
        version,
        title: typeof data.name === "string" ? data.name : "",
        notes: notes.length > 600 ? `${notes.slice(0, 600).trimEnd()}…` : notes,
        updateAvailable,
      });
    } catch (cause) {
      setUpdateCheckError(controller.signal.aborted
        ? "The update check timed out. Check your internet connection and try again."
        : `Could not check for updates: ${String(cause)}`);
    } finally {
      window.clearTimeout(timeout);
      setUpdateChecking(false);
    }
  };

  useEffect(() => {
    if (recordingStatus !== "recording") return;
    const updateDuration = () => {
      const clock = recordingClockRef.current;
      setRecordingDurationMs(clock.elapsedMs + Date.now() - clock.segmentStartedAt);
    };
    const timer = window.setInterval(updateDuration, 250);
    return () => window.clearInterval(timer);
  }, [recordingStatus]);

  useEffect(() => {
    const context = audioContextRef.current;
    const gain = audioGainRef.current;
    if (context && gain && context.state !== "closed") {
      gain.gain.setTargetAtTime(audioVolume / 100, context.currentTime, 0.015);
    }
  }, [audioVolume]);

  useEffect(() => () => {
    audioRequestId.current += 1;
    activeAudioStream.current?.getTracks().forEach((track) => track.stop());
    const context = audioContextRef.current;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setPreferencesReady(true);
      return;
    }
    let cancelled = false;
    void invoke<AppPreferences | null>("load_preferences")
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          setSelectedPort(saved.preferredControllerPort);
          setVideoDeviceId(saved.preferredVideoDevice);
          setAudioDeviceId(saved.preferredAudioDevice || "");
          setAudioVolume(Number.isInteger(saved.audioVolume) && saved.audioVolume >= 0 && saved.audioVolume <= 100 ? saved.audioVolume : 80);
          setCapturePreset(saved.captureQuality in capturePresetConstraints ? saved.captureQuality : "1080p60");
          setCaptureSystemShortcuts(saved.captureSystemShortcuts);
          setInhibitScreenSaver(saved.inhibitScreenSaver);
          setControllerMode(saved.controllerMode >= 0 && saved.controllerMode <= 3 ? saved.controllerMode : 2);
          setAppliedControllerMode(saved.controllerMode >= 0 && saved.controllerMode <= 3 ? saved.controllerMode : 2);
          setMouseMode(saved.mouseMode === "relative" ? "relative" : "absolute");
          setMouseAutoHide(saved.mouseAutoHide);
          setKeyboardLayout(saved.keyboardLayout || "qwerty_us");
        }
        setPreferencesReady(true);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(`Could not load saved preferences: ${String(cause)}`);
        setPreferencesReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<KeyboardLayoutInfo[]>("list_keyboard_layouts")
      .then(setKeyboardLayouts)
      .catch((cause) => setError(`Could not load keyboard layouts: ${String(cause)}`));
  }, []);

  useEffect(() => {
    if (keyboardLayouts.length && !keyboardLayouts.some((layout) => layout.id === keyboardLayout)) {
      setKeyboardLayout(keyboardLayouts.find((layout) => layout.id === "qwerty_us")?.id ?? keyboardLayouts[0].id);
    }
  }, [keyboardLayout, keyboardLayouts]);

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setAppVersion).catch(() => setAppVersion("Unknown"));
  }, []);

  const openExternalLink = useCallback(async (destination: ExternalDestination) => {
    setAppMenuOpen(false);
    if (!isTauri()) {
      window.open(externalDestinations[destination], "_blank", "noopener,noreferrer");
      return;
    }
    try {
      await invoke("open_external_link", { destination });
    } catch (cause) {
      setError(`Could not open the requested link: ${String(cause)}`);
    }
  }, []);

  const stopRecording = useCallback((): Promise<void> => {
    if (recordingStopPromiseRef.current) return recordingStopPromiseRef.current;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve();
    if (recordingClockRef.current.segmentStartedAt) {
      recordingClockRef.current.elapsedMs += Date.now() - recordingClockRef.current.segmentStartedAt;
      recordingClockRef.current.segmentStartedAt = 0;
      setRecordingDurationMs(recordingClockRef.current.elapsedMs);
    }
    setRecordingStatus("stopping");
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recordingStopPromiseRef.current = stopped;
    recorder.stop();
    return stopped;
  }, []);

  const stopAudio = useCallback(() => {
    audioRequestId.current += 1;
    activeAudioStream.current?.getTracks().forEach((track) => track.stop());
    activeAudioStream.current = null;
    audioGainRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    setAudioEnabled(false);
    setAudioStarting(false);
  }, []);

  const refreshAudioDevices = useCallback(async () => {
    const found = await enumerateAudioInputs();
    setAudioDevices(found);
    setAudioDeviceId((current) => {
      if (current && found.some((device) => device.deviceId === current)) return current;
      return found.find((device) => /openterface/i.test(device.label))?.deviceId ?? "";
    });
  }, []);

  useEffect(() => {
    if (preferencesReady) void refreshAudioDevices();
  }, [preferencesReady, refreshAudioDevices]);

  const startAudio = useCallback(async (requestedDeviceId = audioDeviceId) => {
    if (!requestedDeviceId) {
      setError("Choose an audio input in Preferences before enabling pass-through.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setError("Audio capture is unavailable in this Windows WebView.");
      return;
    }
    const requestId = audioRequestId.current + 1;
    audioRequestId.current = requestId;
    setAudioStarting(true);
    setError("");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      await context.resume();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: requestedDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (audioRequestId.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = audioVolume / 100;
      source.connect(gain);
      gain.connect(context.destination);
      activeAudioStream.current = stream;
      audioContextRef.current = context;
      audioGainRef.current = gain;
      const activeStream = stream;
      activeStream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (activeAudioStream.current !== activeStream) return;
        stopAudio();
        setError("The audio input disconnected. Choose an audio input and enable pass-through again.");
      }, { once: true });
      setAudioEnabled(true);
      await refreshAudioDevices();
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
      if (audioRequestId.current === requestId) {
        setAudioEnabled(false);
        setError(`Could not start audio pass-through: ${String(cause)}`);
      }
    } finally {
      if (audioRequestId.current === requestId) setAudioStarting(false);
    }
  }, [audioDeviceId, audioVolume, refreshAudioDevices, stopAudio]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    const currentWindow = getCurrentWindow();
    void currentWindow.onCloseRequested(async (event) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") return;
      event.preventDefault();
      try {
        await stopRecording();
        await currentWindow.close();
      } catch (cause) {
        setError(`Could not save the active recording before closing: ${String(cause)}`);
      }
    }).then((stop) => { unlisten = stop; }).catch((cause) => {
      setError(`Could not register recording close handling: ${String(cause)}`);
    });
    return () => unlisten?.();
  }, [stopRecording]);

  const startRecording = useCallback(() => {
    const stream = activeVideoStream.current;
    if (!stream || stream.getVideoTracks().every((track) => track.readyState !== "live")) {
      setError("Connect a live video source before starting a recording.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("Video recording is not supported by this WebView runtime.");
      return;
    }
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      setError("This WebView does not provide a supported WebM video encoder.");
      return;
    }
    try {
      recordingChunksRef.current = [];
      recordingStopPromiseRef.current = null;
      recordingClockRef.current = { elapsedMs: 0, segmentStartedAt: Date.now() };
      setRecordingDurationMs(0);
      const videoBitsPerSecond = capturePreset === "720p30" ? 2_000_000 : capturePreset === "1080p30" ? 5_000_000 : 8_000_000;
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => setError("Video recording stopped because the capture stream reported an error.");
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        recorderRef.current = null;
        recordingStopPromiseRef.current = null;
        setRecordingStatus("idle");
        setRecordingDurationMs(0);
        recordingClockRef.current = { elapsedMs: 0, segmentStartedAt: 0 };
        const recording = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!recording.size) {
          setError("The recording did not contain any video data.");
          return;
        }
        const url = URL.createObjectURL(recording);
        const link = document.createElement("a");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        link.href = url;
        link.download = `openterface-recording-${timestamp}.webm`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNoticeMessage("Video recording saved to your Downloads folder as WebM.");
      };
      recorder.start(1000);
      setRecordingStatus("recording");
    } catch (cause) {
      recorderRef.current = null;
      recordingClockRef.current = { elapsedMs: 0, segmentStartedAt: 0 };
      setRecordingStatus("idle");
      setError(`Could not start video recording: ${String(cause)}`);
    }
  }, [capturePreset]);

  const toggleRecordingPause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recordingStatus === "recording" && recorder.state === "recording") {
      recorder.pause();
      const clock = recordingClockRef.current;
      clock.elapsedMs += Date.now() - clock.segmentStartedAt;
      clock.segmentStartedAt = 0;
      setRecordingDurationMs(clock.elapsedMs);
      setRecordingStatus("paused");
    } else if (recordingStatus === "paused" && recorder.state === "paused") {
      recorder.resume();
      recordingClockRef.current.segmentStartedAt = Date.now();
      setRecordingStatus("recording");
    }
  }, [recordingStatus]);

  const closeWindow = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await stopRecording();
      await getCurrentWindow().close();
    } catch (cause) {
      setError(`Could not close the window: ${String(cause)}`);
    }
  }, [stopRecording]);

  const toggleFullscreen = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const currentWindow = getCurrentWindow();
      const fullscreen = await currentWindow.isFullscreen();
      await currentWindow.setFullscreen(!fullscreen);
      setFullscreenActive(!fullscreen);
    } catch (cause) {
      setError(`Could not change the window display mode: ${String(cause)}`);
    }
  }, []);

  const zoomIn = useCallback(() => setVideoZoom((current) => Math.min(4, Number((current * 1.1).toFixed(3)))), []);
  const zoomOut = useCallback(() => setVideoZoom((current) => Math.max(0.5, Number((current * 0.9).toFixed(3)))), []);
  const resetZoom = useCallback(() => setVideoZoom(1), []);

  const takeScreenshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setError("A live target image is required before taking a screenshot.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not prepare the target screenshot.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("Could not capture the target image.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = url;
      link.download = `openterface-target-${timestamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNoticeMessage("Target screenshot saved to your Downloads folder.");
    }, "image/png");
  }, []);

  const releaseMouseButtons = useCallback(async () => {
    if (!heldButtons.current) return;
    heldButtons.current = 0;
    if (mouseMode === "relative") {
      await invoke("send_relative_mouse_report", { dx: 0, dy: 0, buttons: 0, wheel: 0 }).catch(() => undefined);
    } else {
      const { x, y } = lastMousePosition.current;
      await invoke("send_mouse_report", { x, y, buttons: 0, wheel: 0 }).catch(() => undefined);
    }
  }, [mouseMode]);

  const requestPointerCapture = useCallback(() => {
    const video = videoRef.current;
    if (!connected || !video || document.pointerLockElement === video) return;
    pointerLockIntent.current = true;
    try {
      void video.requestPointerLock().catch((cause) => {
        pointerLockIntent.current = false;
        setMouseMode("absolute");
        setError(`Could not capture the pointer: ${String(cause)}`);
      });
    } catch (cause) {
      pointerLockIntent.current = false;
      setMouseMode("absolute");
      setError(`Could not capture the pointer: ${String(cause)}`);
    }
  }, [connected]);

  const switchMouseMode = useCallback((mode: MouseMode) => {
    if (mode !== mouseMode) void releaseMouseButtons();
    setAppMenuOpen(false);
    setMouseMode(mode);
    if (mode === "absolute") {
      pointerLockIntent.current = false;
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      requestPointerCapture();
    }
  }, [mouseMode, releaseMouseButtons, requestPointerCapture]);

  useEffect(() => {
    if (!appMenuOpen) return;
    const focusFirstItem = window.requestAnimationFrame(() => appMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !appMenuRef.current?.contains(event.target)) setAppMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAppMenuOpen(false);
        appMenuTriggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFirstItem);
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [appMenuOpen]);

  useEffect(() => {
    if (preferencesOpen && document.pointerLockElement) {
      pointerLockIntent.current = false;
      document.exitPointerLock();
    }
  }, [preferencesOpen]);

  useEffect(() => {
    const handlePointerLockChange = () => {
      if (document.pointerLockElement === videoRef.current) return;
      if (pointerLockIntent.current && mouseMode === "relative") {
        pointerLockIntent.current = false;
        setMouseMode("absolute");
      }
    };
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    return () => document.removeEventListener("pointerlockchange", handlePointerLockChange);
  }, [mouseMode]);

  const pasteToTarget = useCallback(async () => {
    if (!connected || appliedControllerMode === 3 || pasting) return;
    setAppMenuOpen(false);
    setNoticeMessage("");
    setPasting(true);
    try {
      const result = await invoke<{ sent: number; skipped: number }>("paste_clipboard_to_target", { layoutId: keyboardLayout });
      setNoticeMessage(result.skipped
        ? `Pasted ${result.sent} characters; skipped ${result.skipped} unsupported.`
        : `Pasted ${result.sent} characters to the target.`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPasting(false);
    }
  }, [appliedControllerMode, connected, keyboardLayout, pasting]);

  useEffect(() => {
    const handleApplicationShortcut = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (event.ctrlKey && event.shiftKey && event.code === "KeyV") {
        event.preventDefault();
        void pasteToTarget();
      } else if (event.ctrlKey && event.shiftKey && event.code === "KeyR") {
        event.preventDefault();
        if (recordingStatus === "idle") startRecording();
        else void stopRecording();
      } else if (modifier && event.code === "KeyP") {
        event.preventDefault();
        setAppMenuOpen(false);
        setPreferencesOpen(true);
      } else if (event.code === "F1") {
        event.preventDefault();
        setAppMenuOpen(false);
        setAboutOpen(true);
      } else if (modifier && event.code === "KeyU") {
        event.preventDefault();
        void checkForUpdates();
      } else if (modifier && event.code === "KeyE") {
        event.preventDefault();
        setAppMenuOpen(false);
        setEnvironmentCopied(false);
        setEnvironmentOpen(true);
      } else if (modifier && event.code === "KeyQ") {
        event.preventDefault();
        void closeWindow();
      } else if (event.altKey && event.code === "F11") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.ctrlKey && event.shiftKey && event.code === "KeyS") {
        event.preventDefault();
        takeScreenshot();
      } else if (event.ctrlKey && (event.key === "+" || event.code === "NumpadAdd")) {
        event.preventDefault();
        zoomIn();
      } else if (event.ctrlKey && (event.code === "Minus" || event.code === "NumpadSubtract")) {
        event.preventDefault();
        zoomOut();
      } else if (event.ctrlKey && (event.code === "Digit0" || event.code === "Numpad0")) {
        event.preventDefault();
        resetZoom();
      } else if (event.ctrlKey && event.altKey && event.code === "KeyA") {
        event.preventDefault();
        switchMouseMode("absolute");
      } else if (modifier && event.code === "KeyT") {
        event.preventDefault();
        switchMouseMode("relative");
      }
    };
    window.addEventListener("keydown", handleApplicationShortcut);
    return () => window.removeEventListener("keydown", handleApplicationShortcut);
  }, [checkForUpdates, closeWindow, openExternalLink, pasteToTarget, recordingStatus, resetZoom, startRecording, stopRecording, switchMouseMode, takeScreenshot, toggleFullscreen, zoomIn, zoomOut]);

  const refreshDevices = useCallback(async () => {
    if (!isTauri()) {
      setError("Open this app with the Tauri desktop runner to scan USB devices.");
      return;
    }
    setLoadingDevices(true);
    setError("");
    try {
      const found = await invoke<KvmDevice[]>("list_devices");
      setDevices(found);
      const stillPresent = found.some((device) => device.portName === selectedPort);
      if (!stillPresent) {
        const preferredPort = readPreference("preferred-controller-port");
        const nextPort = found.some((device) => device.portName === preferredPort)
          ? preferredPort
          : found.find((device) => device.controller)?.portName ?? found[0]?.portName ?? "";
        setSelectedPort(nextPort);
        if (connected) {
          await stopRecording();
          stopAudio();
          await releaseMouseButtons();
          pointerLockIntent.current = false;
          if (document.pointerLockElement) document.exitPointerLock();
          videoRequestId.current += 1;
          const requestId = ++captureRequestId.current;
          await invoke("disconnect_device", { requestId }).catch(() => undefined);
          setConnected(false);
          setUsbRoute("unknown");
          setControllerStatus(null);
          setConnectionLabel("Device unplugged");
          setControlActive(false);
          heldKeys.current.clear();
          heldButtons.current = 0;
          activeVideoStream.current = null;
          setVideoStream((stream) => {
            stream?.getTracks().forEach((track) => track.stop());
            return null;
          });
        }
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoadingDevices(false);
    }
  }, [connected, releaseMouseButtons, selectedPort, stopAudio, stopRecording]);

  useEffect(() => {
    if (!preferencesReady) return;
    void refreshDevices();
    const timer = window.setInterval(() => void refreshDevices(), 4000);
    return () => window.clearInterval(timer);
  }, [preferencesReady, refreshDevices]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<ControllerStatus>("controller-status", ({ payload }) => setControllerStatus(payload))
      .then((stop) => { unlisten = stop; })
      .catch((cause) => setError(String(cause)));
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!videoRef.current || !videoStream) return;
    videoRef.current.srcObject = videoStream;
    activeVideoStream.current = videoStream;
    const [track] = videoStream.getVideoTracks();
    const handleEnded = () => {
      if (activeVideoStream.current !== videoStream) return;
      void stopRecording();
      activeVideoStream.current = null;
      setVideoError("The capture source disconnected. Choose a video input to reconnect.");
      setTargetName("No signal");
      setVideoStream(null);
      void enumerateVideoInputs().then(setVideoDevices);
    };
    track?.addEventListener("ended", handleEnded);
    return () => track?.removeEventListener("ended", handleEnded);
  }, [stopRecording, videoStream]);

  const openVideo = useCallback(async (requestedDeviceId?: string, cameraHint?: string | null) => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") await stopRecording();
    const requestId = ++videoRequestId.current;
    const isCurrentRequest = () => videoRequestId.current === requestId;
    setVideoError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setVideoError("Camera capture is unavailable in this Windows WebView.");
      return;
    }
    let inputs = await enumerateVideoInputs();
    if (!isCurrentRequest()) return;
    setVideoDevices(inputs);
    try {
      const findPreferred = (devices: MediaDeviceInfo[]) => {
        const savedId = readPreference("preferred-video-device");
        const saved = devices.find((device) => device.deviceId === savedId);
        if (saved) return saved;
        const hinted = cameraHint
          ? devices.find((device) => device.label.toLowerCase().includes(cameraHint.toLowerCase()))
          : undefined;
        return hinted ?? devices.find((device) => /openterface|usb.*(video|capture)|capture.*usb|hdmi/i.test(device.label));
      };
      let preferred = findPreferred(inputs);
      const { width, height, frameRate } = capturePresetConstraints[capturePreset];
      const constraintsFor = (deviceId?: string): MediaStreamConstraints => ({
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate, max: frameRate },
        },
      });
      let stream: MediaStream;
      if (requestedDeviceId) {
        stream = await navigator.mediaDevices.getUserMedia(constraintsFor(requestedDeviceId));
      } else if (preferred) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraintsFor(preferred.deviceId));
        } catch {
          if (!isCurrentRequest()) return;
          stream = await navigator.mediaDevices.getUserMedia(constraintsFor());
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia(constraintsFor());
      }
      if (!isCurrentRequest()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      inputs = await enumerateVideoInputs();
      if (!isCurrentRequest()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setVideoDevices(inputs);
      if (!requestedDeviceId) {
        preferred = findPreferred(inputs);
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (preferred && activeId && preferred.deviceId !== activeId) {
          try {
            const preferredStream = await navigator.mediaDevices.getUserMedia(constraintsFor(preferred.deviceId));
            if (!isCurrentRequest()) {
              preferredStream.getTracks().forEach((track) => track.stop());
              stream.getTracks().forEach((track) => track.stop());
              return;
            }
            stream.getTracks().forEach((track) => track.stop());
            stream = preferredStream;
          } catch {
            // Keep the working default stream when the hinted source is unavailable.
          }
        }
      }
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? requestedDeviceId ?? preferred?.deviceId ?? "";
      if (!isCurrentRequest()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setVideoDeviceId(activeId);
      setVideoStream((current) => {
        if (!isCurrentRequest()) {
          stream.getTracks().forEach((track) => track.stop());
          return current;
        }
        activeVideoStream.current = stream;
        current?.getTracks().forEach((track) => track.stop());
        return stream;
      });
      const [track] = stream.getVideoTracks();
      setTargetName(track?.label || "USB capture device");
    } catch (cause) {
      if (!isCurrentRequest()) return;
      inputs = await enumerateVideoInputs();
      if (!isCurrentRequest()) return;
      setVideoDevices(inputs);
      setVideoError(`Could not open a video capture device: ${String(cause)}`);
    }
  }, [capturePreset, stopRecording]);

  const connect = async () => {
    if (!selectedPort || connecting) return;
    setConnecting(true);
    setError("");
    try {
      const message = await invoke<string>("connect_device", { portName: selectedPort });
      setConnected(true);
      setUsbRoute("unknown");
      setControllerStatus(null);
      setConnectionLabel(message);
      const connectedBaudRate = message.match(/at (\d+) baud/i)?.[1];
      if (connectedBaudRate) setControllerBaudRate(Number(connectedBaudRate));
      await openVideo(undefined, selectedDevice?.cameraName);
      await refreshAudioDevices();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    videoRequestId.current += 1;
    await stopRecording();
    stopAudio();
    await releaseMouseButtons();
    pointerLockIntent.current = false;
    if (document.pointerLockElement) document.exitPointerLock();
    try {
      const requestId = ++captureRequestId.current;
      await invoke("disconnect_device", { requestId });
    } catch (cause) {
      setError(String(cause));
    }
    setConnected(false);
    setUsbRoute("unknown");
    setControllerStatus(null);
    setConnectionLabel("Disconnected");
    heldKeys.current.clear();
    heldButtons.current = 0;
    setControlActive(false);
    setVideoDevices([]);
    setVideoDeviceId("");
    activeVideoStream.current = null;
    setVideoStream((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    });
  };

  const switchUsbRoute = async (route: Exclude<UsbRoute, "unknown">) => {
    if (!connected || switchingUsbRoute || usbRoute === route) return;
    setSwitchingUsbRoute(true);
    setError("");
    try {
      const message = await invoke<string>("switch_usb_route", { toTarget: route === "target" });
      setUsbRoute(route);
      setNoticeMessage(message);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSwitchingUsbRoute(false);
    }
  };

  const resetSerialConnection = async () => {
    if (!connected || resettingConnection) return;
    setResettingConnection(true);
    setError("");
    try {
      const message = await invoke<string>("reset_serial_connection");
      setConnectionLabel(message);
      setControllerStatus(null);
      setUsbRoute("unknown");
      setResetConfirmationOpen(false);
      setNoticeMessage("Serial connection reset. The video stream remains active.");
    } catch (cause) {
      setError(String(cause));
      await disconnect();
    } finally {
      setResettingConnection(false);
    }
  };

  const factoryResetController = async () => {
    if (!connected || !selectedPort || factoryResetting) return;
    setFactoryResetting(true);
    setError("");
    try {
      const message = await invoke<string>("factory_reset_controller", { portName: selectedPort });
      setConnectionLabel(message);
      setControllerBaudRate(message.match(/at (\d+) baud/i)?.[1] ? Number(message.match(/at (\d+) baud/i)?.[1]) : 9600);
      setControllerMode(2);
      setAppliedControllerMode(2);
      setControllerStatus(null);
      setUsbRoute("unknown");
      setFactoryResetOpen(false);
      setNoticeMessage(message);
    } catch (cause) {
      setError(String(cause));
      await disconnect();
    } finally {
      setFactoryResetting(false);
    }
  };

  const applyControllerMode = async () => {
    if (!selectedPort || !connected || selectedDevice?.controller !== "CH9329" || modeApplying) return;
    setModeApplying(true);
    setError("");
    try {
      const message = await invoke<string>("apply_controller_mode", { portName: selectedPort, mode: controllerMode });
      setConnectionLabel(message);
      setControllerStatus(null);
      setAppliedControllerMode(controllerMode);
    } catch (cause) {
      setError(String(cause));
      await disconnect();
    } finally {
      setModeApplying(false);
    }
  };

  const applyBaudRate = async () => {
    if (!selectedPort || !connected || baudRateApplying) return;
    setBaudRateApplying(true);
    setError("");
    try {
      const message = await invoke<string>("apply_baud_rate", { portName: selectedPort, baudRate: controllerBaudRate });
      setConnectionLabel(message);
      setControllerStatus(null);
      setUsbRoute("unknown");
      setNoticeMessage(message);
    } catch (cause) {
      setError(String(cause));
      await disconnect();
    } finally {
      setBaudRateApplying(false);
    }
  };

  const sendKeys = useCallback(async () => {
    if (appliedControllerMode === 3) return;
    const keysDown = [...heldKeys.current];
    const modifiers = keysDown.reduce((mask, code) => mask | (modifierBits[code] ?? 0), 0);
    const keys = keysDown.map((code) => keyUsages[code]).filter((key): key is number => key !== undefined).slice(0, 6);
    try {
      await invoke("send_keyboard_report", { modifiers, keys });
    } catch (cause) {
      setError(String(cause));
    }
  }, [appliedControllerMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("preferred-controller-port", selectedPort);
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
  }, [selectedPort]);

  useEffect(() => {
    if (!videoDeviceId) return;
    try {
      window.localStorage.setItem("preferred-video-device", videoDeviceId);
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
  }, [videoDeviceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem("capture-quality", capturePreset);
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
    const track = videoStream?.getVideoTracks()[0];
    if (!track) return;
    const { width, height, frameRate } = capturePresetConstraints[capturePreset];
    void track.applyConstraints({
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate, max: frameRate },
    }).catch((cause) => setVideoError(`Could not apply the preferred capture quality: ${String(cause)}`));
  }, [capturePreset, videoStream]);

  useEffect(() => {
    try {
      window.localStorage.setItem("capture-system-shortcuts", String(captureSystemShortcuts));
    } catch {
      // The current session still honors the toggle when storage is unavailable.
    }
  }, [captureSystemShortcuts]);

  useEffect(() => {
    try {
      window.localStorage.setItem("inhibit-screen-saver", String(inhibitScreenSaver));
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
    if (!preferencesReady || !isTauri()) return;
    void invoke("set_screen_saver_inhibited", { inhibited: inhibitScreenSaver }).catch((cause) => {
      setError(`Could not update Windows display power behavior: ${String(cause)}`);
    });
  }, [inhibitScreenSaver, preferencesReady]);

  useEffect(() => {
    try {
      window.localStorage.setItem("controller-mode", String(appliedControllerMode));
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
  }, [appliedControllerMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("mouse-mode", mouseMode);
    } catch {
      // The current session still honors the selected mouse mode.
    }
  }, [mouseMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("mouse-auto-hide", String(mouseAutoHide));
    } catch {
      // The current session still honors the cursor preference.
    }
  }, [mouseAutoHide]);

  useEffect(() => {
    if (!preferencesReady || !isTauri()) return;
    const preferences: AppPreferences = {
      preferredControllerPort: selectedPort,
      preferredVideoDevice: videoDeviceId || readPreference("preferred-video-device"),
      preferredAudioDevice: audioDeviceId || readPreference("preferred-audio-device"),
      audioVolume,
      captureQuality: capturePreset,
      captureSystemShortcuts,
      inhibitScreenSaver,
      controllerMode: appliedControllerMode,
      mouseMode,
      mouseAutoHide,
      keyboardLayout,
    };
    void invoke("save_preferences", { preferences }).catch((cause) => {
      setError(`Could not save preferences: ${String(cause)}`);
    });
  }, [appliedControllerMode, audioDeviceId, audioVolume, capturePreset, captureSystemShortcuts, inhibitScreenSaver, keyboardLayout, mouseAutoHide, mouseMode, preferencesReady, selectedPort, videoDeviceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem("keyboard-layout", keyboardLayout);
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
  }, [keyboardLayout]);

  useEffect(() => {
    const shouldCapture = connected && controlActive && captureSystemShortcuts;
    if (!isTauri()) return;
    const requestId = ++captureRequestId.current;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const updateCapture = async () => {
      if (!shouldCapture) {
        await invoke("set_system_key_capture", { enabled: false, requestId });
        return;
      }
      unlisten = await listen<{ code: string; down: boolean }>("system-key-event", ({ payload }) => {
        if (payload.down) heldKeys.current.add(payload.code);
        else heldKeys.current.delete(payload.code);
        void sendKeys();
      });
      if (disposed) {
        unlisten?.();
        unlisten = undefined;
        return;
      }
      await invoke("set_system_key_capture", { enabled: true, requestId });
    };

    void updateCapture().catch((cause) => {
      if (!disposed) {
        setError(String(cause));
        setCaptureSystemShortcuts(false);
      }
    });
    return () => {
      disposed = true;
      const stopRequestId = ++captureRequestId.current;
      void invoke("set_system_key_capture", { enabled: false, requestId: stopRequestId })
        .catch(() => undefined)
        .finally(() => {
          unlisten?.();
          unlisten = undefined;
        });
    };
  }, [connected, controlActive, captureSystemShortcuts, sendKeys]);

  useEffect(() => {
    if (!connected) return;
    const down = (event: KeyboardEvent) => {
      if (!controlActive) return;
      if (event.code === "F1" || event.ctrlKey && ["KeyP", "KeyQ", "KeyT", "KeyU"].includes(event.code) || event.ctrlKey && event.altKey && event.code === "KeyA") return;
      if (event.altKey && event.code === "F11" || event.ctrlKey && event.shiftKey && ["KeyS", "KeyV"].includes(event.code) || event.ctrlKey && (event.key === "+" || ["Minus", "NumpadAdd", "NumpadSubtract", "Digit0", "Numpad0"].includes(event.code))) return;
      if (event.ctrlKey && ["KeyR", "KeyW", "KeyT", "KeyL"].includes(event.code)) event.preventDefault();
      if (event.code === "F11" || event.code === "F5") event.preventDefault();
      if (event.repeat || !keyUsages[event.code] && !modifierBits[event.code]) return;
      event.preventDefault();
      heldKeys.current.add(event.code);
      void sendKeys();
    };
    const up = (event: KeyboardEvent) => {
      if (!controlActive) return;
      if (!keyUsages[event.code] && !modifierBits[event.code]) return;
      event.preventDefault();
      heldKeys.current.delete(event.code);
      void sendKeys();
    };
    const release = () => {
      if (heldKeys.current.size) {
        heldKeys.current.clear();
        void sendKeys();
      }
      void releaseMouseButtons();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      release();
    };
  }, [connected, controlActive, releaseMouseButtons, sendKeys]);

  const sendPointer = (event: PointerEvent<HTMLVideoElement>) => {
    if (!connected || appliedControllerMode === 1 || appliedControllerMode === 3 || !videoRef.current) return;
    const now = performance.now();
    if (event.type === "pointermove" && now - lastMouseSend.current < 18) return;
    lastMouseSend.current = now;
    if (mouseMode === "relative") {
      const widthRatio = window.screen.width > 0 ? window.innerWidth / window.screen.width : 1;
      const heightRatio = window.screen.height > 0 ? window.innerHeight / window.screen.height : 1;
      const dx = Math.max(-127, Math.min(127, Math.trunc(event.movementX * widthRatio)));
      const dy = Math.max(-127, Math.min(127, Math.trunc(event.movementY * heightRatio)));
      void invoke("send_relative_mouse_report", { dx, dy, buttons: heldButtons.current, wheel: 0 }).catch((cause) => setError(String(cause)));
      return;
    }
    const { x, y } = targetCoordinates(event, videoRef.current, videoZoom);
    lastMousePosition.current = { x, y };
    void invoke("send_mouse_report", { x, y, buttons: heldButtons.current, wheel: 0 }).catch((cause) => setError(String(cause)));
  };

  const setPointerButton = (event: PointerEvent<HTMLVideoElement>, pressed: boolean) => {
    event.preventDefault();
    if (appliedControllerMode === 1 || appliedControllerMode === 3) return;
    if (mouseMode === "relative" && pressed) requestPointerCapture();
    const bit = event.button === 2 ? 2 : event.button === 1 ? 4 : 1;
    heldButtons.current = pressed ? heldButtons.current | bit : heldButtons.current & ~bit;
    sendPointer(event);
  };

  const scroll = (event: WheelEvent<HTMLVideoElement>) => {
    event.preventDefault();
    if (!connected || appliedControllerMode === 1 || appliedControllerMode === 3 || !videoRef.current) return;
    const wheel = Math.max(-127, Math.min(127, Math.trunc(-event.deltaY / 50)));
    if (mouseMode === "relative") {
      void invoke("send_relative_mouse_report", { dx: 0, dy: 0, buttons: heldButtons.current, wheel }).catch((cause) => setError(String(cause)));
      return;
    }
    const { x, y } = targetCoordinates(event, videoRef.current, videoZoom);
    // DOM deltaY is positive down; CH9329 expects positive values for up.
    void invoke("send_mouse_report", { x, y, buttons: heldButtons.current, wheel }).catch((cause) => setError(String(cause)));
  };

  const navigateApplicationMenu = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!appMenuOpen || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src={openterfaceIcon} width="30" height="30" alt="" />
          <div><strong>Openterface</strong><span>Mini-KVM</span></div>
        </div>
        <div className="topbar-context">Live console</div>
        <div className="topbar-actions">
          <span className={`connection-pill ${connected ? "connected" : ""}`} role="status" aria-live="polite">{connected ? "Connected" : "Disconnected"}</span>
          <button className="icon-button" type="button" aria-label="Refresh USB devices" title="Refresh USB devices" onClick={() => void refreshDevices()} disabled={loadingDevices}>
            <RefreshCw size={16} className={loadingDevices ? "spin" : ""} />
          </button>
          <button className="icon-button" type="button" aria-label="Open preferences" title="Preferences" onClick={() => setPreferencesOpen(true)}>
            <Settings2 size={17} />
          </button>
          <div className="app-menu-wrap" ref={appMenuRef}>
            <button ref={appMenuTriggerRef} className="icon-button" type="button" aria-label="Open application menu" title="Application menu" aria-haspopup="menu" aria-expanded={appMenuOpen} onClick={() => setAppMenuOpen((open) => !open)}>
              <MoreHorizontal size={17} />
            </button>
            {appMenuOpen && <div className="app-menu" role="menu" aria-label="Application menu" onKeyDown={navigateApplicationMenu}>
              <div className="app-menu-heading">Application</div>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); setPreferencesOpen(true); }}><Settings2 size={15} /><span>Preferences</span><kbd>Ctrl+P</kbd></button>
              <button role="menuitem" type="button" onClick={() => void pasteToTarget()} disabled={!connected || appliedControllerMode === 3 || pasting}><ClipboardPaste size={15} /><span>{pasting ? "Pasting to target…" : "Paste to target"}</span><kbd>Ctrl+Shift+V</kbd></button>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); takeScreenshot(); }} disabled={!videoStream}><ImageDown size={15} /><span>Save target screenshot</span><kbd>Ctrl+Shift+S</kbd></button>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); setAboutOpen(true); }}><Info size={15} /><span>About Openterface</span><kbd>F1</kbd></button>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); setEnvironmentCopied(false); setEnvironmentOpen(true); }}><Info size={15} /><span>Environment report</span><kbd>Ctrl+E</kbd></button>
              <div className="app-menu-rule" />
              <button role="menuitem" type="button" onClick={() => void openExternalLink("website")}><ExternalLink size={15} /><span>Website</span></button>
              <button role="menuitem" type="button" onClick={() => void openExternalLink("feedback")}><ExternalLink size={15} /><span>Send feedback</span></button>
              <button role="menuitem" type="button" onClick={() => void checkForUpdates()} disabled={updateChecking}><RefreshCw size={15} /><span>{updateChecking ? "Checking for updates…" : "Check for updates"}</span><kbd>Ctrl+U</kbd></button>
              <button role="menuitem" type="button" onClick={() => void openExternalLink("releases")}><ExternalLink size={15} /><span>View releases</span></button>
              <div className="app-menu-rule" />
              <div className="app-menu-heading">Device</div>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); setResetConfirmationOpen(true); }} disabled={!connected || resettingConnection}><RefreshCw size={15} /><span>{resettingConnection ? "Resetting connection…" : "Reset serial connection"}</span></button>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); setFactoryResetOpen(true); }} disabled={!connected || factoryResetting}><RefreshCw size={15} /><span>{factoryResetting ? "Resetting HID controller…" : "Factory reset HID controller"}</span></button>
              <div className="app-menu-rule" />
              <div className="app-menu-heading">Control</div>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); if (recordingStatus === "idle") startRecording(); else void stopRecording(); }} disabled={!videoStream || recordingStatus === "stopping"}><Circle size={15} /><span>{recordingStatus === "idle" ? "Start video recording" : "Stop and save recording"}</span><kbd>Ctrl+Shift+R</kbd></button>
              <button role="menuitemradio" aria-checked={mouseMode === "absolute"} type="button" onClick={() => switchMouseMode("absolute")}><MousePointer2 size={15} /><span>Absolute mouse</span><kbd>Ctrl+Alt+A</kbd></button>
              <button role="menuitemradio" aria-checked={mouseMode === "relative"} type="button" onClick={() => switchMouseMode("relative")}><MousePointer2 size={15} /><span>Relative mouse</span><kbd>Ctrl+T</kbd></button>
              <div className="app-menu-rule" />
              <div className="app-menu-heading">View</div>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); zoomIn(); }}><ZoomIn size={15} /><span>Zoom in</span><kbd>Ctrl++</kbd></button>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); zoomOut(); }}><ZoomOut size={15} /><span>Zoom out</span><kbd>Ctrl+-</kbd></button>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); resetZoom(); }}><ZoomIn size={15} /><span>Actual size</span><kbd>Ctrl+0</kbd></button>
              <div className="app-menu-rule" />
              <div className="app-menu-heading">Window</div>
              <button role="menuitem" type="button" onClick={() => { setAppMenuOpen(false); void toggleFullscreen(); }}><Maximize size={15} /><span>{fullscreenActive ? "Exit full screen" : "Full screen"}</span><kbd>Alt+F11</kbd></button>
              <div className="app-menu-rule" />
              <button role="menuitem" type="button" onClick={() => void closeWindow()}><X size={15} /><span>Close window</span><kbd>Ctrl+Q</kbd></button>
            </div>}
          </div>
        </div>
      </header>

      <main className="main-area">
        <section className="page-content">
          <div className="page-heading">
            <div><h1>Live console</h1><p>Connect the Mini-KVM to view and control a target computer.</p></div>
          </div>

          <section className="control-strip" aria-label="Connection controls">
            <div className="device-picker">
              <Usb size={18} aria-hidden="true" />
              <div className="picker-copy"><label htmlFor="device-port">Device</label>
                <select id="device-port" value={selectedPort} onChange={(event) => setSelectedPort(event.target.value)} disabled={connected || connecting || devices.length === 0}>
                  {devices.length === 0 && <option value="">No controller detected</option>}
                  {devices.map((device) => <option key={device.portName} value={device.portName}>{device.controller ? `${device.controller} · ${device.portName}` : `${device.portName} · USB serial`}</option>)}
                </select>
              </div>
              <ChevronDown size={15} className="picker-chevron" aria-hidden="true" />
            </div>
            <div className="strip-divider" />
            <div className="quick-status"><span className="status-name">Controller</span><strong>{connected ? selectedDevice?.controller ?? "Online" : "Offline"}</strong></div>
            <div className="quick-status"><span className="status-name">Target USB</span><strong>{connected && controllerStatus ? controllerStatus.targetConnected ? "Connected" : "Disconnected" : connected ? "Checking…" : "—"}</strong></div>
            <div className="quick-status"><span className="status-name">Video input</span><strong>{videoStream ? "Live capture" : videoDevices.length ? `${videoDevices.length} available` : selectedDevice?.hasCamera ? "Available" : "Not detected"}</strong></div>
            <div className="route-switch" role="group" aria-label="Switchable USB route">
              <span>USB route</span>
              <div className="route-switch-buttons">
                <button type="button" aria-pressed={usbRoute === "host"} className={usbRoute === "host" ? "selected" : ""} disabled={!connected || switchingUsbRoute} onClick={() => void switchUsbRoute("host")}>{switchingUsbRoute ? "Switching…" : "Host"}</button>
                <button type="button" aria-pressed={usbRoute === "target"} className={usbRoute === "target" ? "selected" : ""} disabled={!connected || switchingUsbRoute} onClick={() => void switchUsbRoute("target")}>{switchingUsbRoute ? "Switching…" : "Target"}</button>
              </div>
            </div>
            <div className="strip-spacer" />
            {connected ? <button className="button button-secondary" type="button" onClick={() => void disconnect()}><X size={15} />Disconnect</button> : <button className="button button-primary" type="button" onClick={() => void connect()} disabled={!selectedPort || loadingDevices || connecting}><Plug size={15} />{connecting ? "Connecting…" : "Connect device"}</button>}
          </section>

          {(error || videoError) && <div className="error-banner" role="alert">{error || videoError}<button type="button" aria-label="Dismiss error" onClick={() => { setError(""); setVideoError(""); }}><X size={15} /></button></div>}
          {noticeMessage && <div className="notice-banner" role="status">{noticeMessage}<button type="button" aria-label="Dismiss notification" onClick={() => setNoticeMessage("")}><X size={15} /></button></div>}

          <section className="console-card" aria-label="Target display">
            <div className="console-toolbar">
              <div className="console-title"><strong>Target display</strong><span className="target-name">{videoStream ? targetName : "No signal"}</span></div>
              <div className="console-tools">{connected && videoDevices.length > 1 && <select className="video-select" aria-label="Video capture device" value={videoDeviceId} onChange={(event) => { setVideoDeviceId(event.target.value); void openVideo(event.target.value); }}>{videoDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Video device ${index + 1}`}</option>)}</select>}{videoStream && <span className="resolution">Live</span>}{recordingStatus === "idle" ? <button className="console-tool recording-start" type="button" aria-label="Start video recording" title="Start video recording (Ctrl+Shift+R)" onClick={startRecording} disabled={!videoStream}><Circle size={15} fill="currentColor" /></button> : <><span className={`recording-clock ${recordingStatus === "recording" ? "is-recording" : ""}`} role="status"><span className="recording-dot" />{recordingStatus === "paused" ? `Paused ${formatRecordingDuration(recordingDurationMs)}` : recordingStatus === "stopping" ? "Saving" : formatRecordingDuration(recordingDurationMs)}</span><button className="console-tool" type="button" aria-label={recordingStatus === "paused" ? "Resume recording" : "Pause recording"} title={recordingStatus === "paused" ? "Resume recording" : "Pause recording"} onClick={toggleRecordingPause} disabled={recordingStatus === "stopping"}>{recordingStatus === "paused" ? <Play size={15} /> : <Pause size={15} />}</button><button className="console-tool" type="button" aria-label="Stop and save recording" title="Stop and save recording" onClick={() => void stopRecording()} disabled={recordingStatus === "stopping"}><Square size={15} fill="currentColor" /></button></>}<button className="console-tool" type="button" aria-label="Zoom out" title="Zoom out (Ctrl+-)" onClick={zoomOut}><ZoomOut size={15} /></button><span className="zoom-indicator" aria-label={`Zoom ${Math.round(videoZoom * 100)} percent`}>{Math.round(videoZoom * 100)}%</span><button className="console-tool" type="button" aria-label="Zoom in" title="Zoom in (Ctrl++)" onClick={zoomIn}><ZoomIn size={15} /></button><button className="console-tool" type="button" aria-label="Save target screenshot" title="Save target screenshot (Ctrl+Shift+S)" onClick={takeScreenshot} disabled={!videoStream}><ImageDown size={15} /></button><button className="console-tool" type="button" aria-label={fullscreenActive ? "Exit full screen" : "Enter full screen"} title="Toggle full screen (Alt+F11)" onClick={() => void toggleFullscreen()}><Maximize size={15} /></button></div>
            </div>
            <div className={`video-stage ${videoStream ? "has-video" : ""} ${mouseAutoHide && controlActive ? "auto-hide-cursor" : ""}`} tabIndex={connected ? 0 : -1} aria-label={connected ? "Target display, keyboard and mouse control active when focused" : "Target display unavailable until a device is connected"} onPointerEnter={() => setControlActive(true)} onPointerLeave={() => { setControlActive(false); if (heldKeys.current.size) { heldKeys.current.clear(); void sendKeys(); } void releaseMouseButtons(); }} onFocus={() => setControlActive(true)}>
              {videoStream ? <video ref={videoRef} style={{ transform: `scale(${videoZoom})` }} autoPlay playsInline muted onContextMenu={(event) => event.preventDefault()} onPointerMove={sendPointer} onPointerDown={(event) => setPointerButton(event, true)} onPointerUp={(event) => setPointerButton(event, false)} onPointerLeave={(event) => { if (heldButtons.current) { heldButtons.current = 0; sendPointer(event); } }} onWheel={scroll} /> : <div className="empty-display">
                <Video size={20} strokeWidth={1.5} aria-hidden="true" />
                <div className="empty-copy"><h2>{connected ? "No video signal" : "No target display"}</h2><p>{connected ? "Select a capture source to view the connected computer." : "Connect a Mini-KVM to view its video input."}</p></div>
                {connected && <button className="button button-secondary" type="button" onClick={() => void openVideo()}><Camera size={15} />Choose video input</button>}
              </div>}
            </div>
            <div className="console-footer"><div className="footer-left"><span>{connected ? "Session active" : "Session idle"}</span><span className="footer-separator" />{appliedControllerMode !== 1 && appliedControllerMode !== 3 && <span className="footer-hint"><MousePointer2 size={13} />{mouseMode === "relative" ? "Relative mouse" : "Absolute mouse"}</span>}{appliedControllerMode !== 3 && <span className="footer-hint"><Keyboard size={13} />Keyboard</span>}</div><div className={`footer-right ${audioEnabled ? "audio-active" : ""}`}><AudioLines size={15} /><span>{audioStarting ? "Audio starting" : audioEnabled ? `Audio live (${audioVolume}%)` : "Audio off"}</span></div></div>
          </section>

          <section className="bottom-row" aria-label="Device information">
            <div className="info-card"><Usb size={17} aria-hidden="true" /><div><strong>{connected ? selectedDevice?.controller ?? "Controller connected" : "Ready to connect"}</strong><span>{connected ? connectionLabel : selectedDevice?.generation ?? "Connect an Openterface device to begin."}</span></div><button className="text-action" type="button" onClick={() => void refreshDevices()} disabled={loadingDevices}>{loadingDevices ? "Scanning…" : "Scan devices"}<RefreshCw size={14} /></button></div>
            <div className="tip-card">
              <div className="tip-copy"><strong>{appliedControllerMode === 3 ? "Custom HID mode" : appliedControllerMode === 1 ? "Keyboard control" : "Keyboard and mouse"}</strong><span>{appliedControllerMode === 3 ? "Custom HID input is not yet available in this Tauri build." : appliedControllerMode === 1 ? "Click the target display to send keyboard input." : mouseMode === "relative" ? "Click the target display to capture the pointer. Press Escape to release it." : "Click the target display to send keyboard and mouse input."}</span></div>
              <button className="text-action" type="button" onClick={() => setPreferencesOpen(true)}>Keyboard preferences <Settings2 size={14} /></button>
            </div>
          </section>
        </section>
      </main>
      <PreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        devices={devices}
        selectedPort={selectedPort}
        onSelectPort={setSelectedPort}
        controllerSelectionDisabled={connected || connecting}
        connected={connected}
        controllerType={selectedDevice?.controller ?? null}
        baudRate={controllerBaudRate}
        baudRateApplying={baudRateApplying}
        onBaudRateChange={setControllerBaudRate}
        onApplyBaudRate={() => void applyBaudRate()}
        controllerMode={controllerMode}
        modeApplying={modeApplying}
        onControllerModeChange={setControllerMode}
        onApplyControllerMode={() => void applyControllerMode()}
        videoDevices={videoDevices}
        videoDeviceId={videoDeviceId}
        onSelectVideo={(deviceId) => { setVideoDeviceId(deviceId); if (deviceId) void openVideo(deviceId); }}
        audioDevices={audioDevices}
        audioDeviceId={audioDeviceId}
        onSelectAudioDevice={(deviceId) => { setAudioDeviceId(deviceId); if (audioEnabled) { stopAudio(); if (deviceId) void startAudio(deviceId); } }}
        onRefreshAudioDevices={() => void refreshAudioDevices()}
        audioEnabled={audioEnabled}
        audioStarting={audioStarting}
        onToggleAudio={(enabled) => { if (enabled) void startAudio(); else stopAudio(); }}
        audioVolume={audioVolume}
        onAudioVolumeChange={setAudioVolume}
        capturePreset={capturePreset}
        onCapturePresetChange={setCapturePreset}
        captureSystemShortcuts={captureSystemShortcuts}
        onCaptureSystemShortcutsChange={setCaptureSystemShortcuts}
        inhibitScreenSaver={inhibitScreenSaver}
        onInhibitScreenSaverChange={setInhibitScreenSaver}
        mouseMode={mouseMode}
        onMouseModeChange={(mode) => { if (mode === "absolute") switchMouseMode(mode); else setMouseMode(mode); }}
        mouseAutoHide={mouseAutoHide}
        onMouseAutoHideChange={setMouseAutoHide}
        keyboardLayouts={keyboardLayouts}
        keyboardLayout={keyboardLayout}
        onKeyboardLayoutChange={setKeyboardLayout}
      />
      <AboutDialog open={aboutOpen} version={appVersion} onClose={() => setAboutOpen(false)} onOpenLink={(destination) => void openExternalLink(destination)} />
      <EnvironmentDialog open={environmentOpen} rows={environmentRows} copied={environmentCopied} onClose={() => setEnvironmentOpen(false)} onCopy={() => void copyEnvironmentReport()} />
      <UpdateDialog open={updateDialogOpen} currentVersion={appVersion} release={latestRelease} loading={updateChecking} error={updateCheckError} onClose={() => setUpdateDialogOpen(false)} onOpenReleases={() => void openExternalLink("releases")} />
      <ResetConfirmationDialog open={resetConfirmationOpen} busy={resettingConnection} onClose={() => setResetConfirmationOpen(false)} onConfirm={() => void resetSerialConnection()} />
      <FactoryResetDialog open={factoryResetOpen} busy={factoryResetting} onClose={() => setFactoryResetOpen(false)} onConfirm={() => void factoryResetController()} />
    </div>
  );
}

export default App;
