import { AudioLines, Camera, Keyboard, MousePointer2, RefreshCw, Settings2, Usb } from "lucide-react";
import { isLanguageCode, languageOptions, translate, type LanguageCode } from "../i18n";
import type { CapturePreset, KeyboardLayoutInfo, KvmDevice, MouseMode } from "../types";
import { Dialog } from "./Dialog";

export type PreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  language: LanguageCode;
  onLanguageChange: (language: LanguageCode) => void;
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
  audioDevices: MediaDeviceInfo[];
  audioDeviceId: string;
  onSelectAudioDevice: (deviceId: string) => void;
  onRefreshAudioDevices: () => void;
  audioEnabled: boolean;
  audioStarting: boolean;
  onToggleAudio: (enabled: boolean) => void;
  audioVolume: number;
  onAudioVolumeChange: (volume: number) => void;
  includeAudioInRecordings: boolean;
  onIncludeAudioInRecordingsChange: (enabled: boolean) => void;
  capturePreset: CapturePreset;
  onCapturePresetChange: (preset: CapturePreset) => void;
  recordingVideoBitrate: number;
  onRecordingVideoBitrateChange: (bitrate: number) => void;
  recordingAudioBitrate: number;
  onRecordingAudioBitrateChange: (bitrate: number) => void;
  recordingAudioSampleRate: number;
  onRecordingAudioSampleRateChange: (sampleRate: number) => void;
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

export function PreferencesDialog({
  open, onClose, language, onLanguageChange, devices, selectedPort, onSelectPort, controllerSelectionDisabled,
  capturePreset, onCapturePresetChange, captureSystemShortcuts,
  audioDevices, audioDeviceId, onSelectAudioDevice, onRefreshAudioDevices, audioEnabled, audioStarting, onToggleAudio, audioVolume, onAudioVolumeChange,
  includeAudioInRecordings, onIncludeAudioInRecordingsChange,
  recordingVideoBitrate, onRecordingVideoBitrateChange,
  recordingAudioBitrate, onRecordingAudioBitrateChange,
  recordingAudioSampleRate, onRecordingAudioSampleRateChange,
  onCaptureSystemShortcutsChange, inhibitScreenSaver, onInhibitScreenSaverChange,
  mouseMode, onMouseModeChange, mouseAutoHide, onMouseAutoHideChange,
  keyboardLayouts, keyboardLayout, onKeyboardLayoutChange,
  connected, controllerType, baudRate, baudRateApplying, onBaudRateChange, onApplyBaudRate,
  controllerMode, modeApplying, onControllerModeChange, onApplyControllerMode,
}: PreferencesDialogProps) {
  if (!open) return null;

  return (
    <Dialog titleId="preferences-title" title={translate("Preferences")} closeLabel="Close preferences" onClose={onClose} size="lg" bodyClassName="preferences-body"
      footer={<><span className="dialog-footer-note">Changes are saved automatically.</span><button className="button button-primary" type="button" onClick={onClose}>Done</button></>}>
      <section className="preference-section" aria-labelledby="application-preferences-title">
        <div className="preference-section-heading"><Settings2 size={16} /><div><h3 id="application-preferences-title">{translate("Application")}</h3><p>{translate("Choose the language used by the application.")}</p></div></div>
        <label className="preference-field"><span>{translate("Language")}</span>
          <select value={language} onChange={(event) => { if (isLanguageCode(event.target.value)) onLanguageChange(event.target.value); }}>
            {languageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
        </label>
      </section>
      <section className="preference-section" aria-labelledby="device-preferences-title">
        <div className="preference-section-heading"><Usb size={16} /><div><h3 id="device-preferences-title">{translate("Devices")}</h3><p>{translate("Choose which hardware to use when available.")}</p></div></div>
        <label className="preference-field"><span>Preferred controller</span>
          <select value={selectedPort} onChange={(event) => onSelectPort(event.target.value)} disabled={devices.length === 0 || controllerSelectionDisabled}>
            {devices.length === 0 && <option value="">No controller detected</option>}
            {devices.map((device) => <option key={device.portName} value={device.portName}>{[device.controller, device.portName].filter(Boolean).join(" · ")}</option>)}
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
        <div className="preference-section-heading"><Camera size={16} /><div><h3 id="video-preferences-title">{translate("Video capture")}</h3><p>{translate("Choose a preferred size and frame rate for the USB capture source.")}</p></div></div>
        <label className="preference-field"><span>Capture quality</span>
          <select value={capturePreset} onChange={(event) => onCapturePresetChange(event.target.value as CapturePreset)}>
            <option value="720p30">1280 × 720 at 30 fps</option>
            <option value="1080p30">1920 × 1080 at 30 fps</option>
            <option value="1080p60">1920 × 1080 at 60 fps</option>
          </select>
        </label>
        <label className="preference-slider"><span>Recording bitrate <strong>{(recordingVideoBitrate / 1_000_000).toFixed(1)} Mbps</strong></span>
          <input type="range" min="500000" max="20000000" step="500000" value={recordingVideoBitrate} onChange={(event) => onRecordingVideoBitrateChange(Number(event.target.value))} />
        </label>
        <p className="preference-note">The capture device may use a lower mode if the selected quality is unavailable. WebView2 selects the WebM codec and pixel format.</p>
      </section>

      <section className="preference-section" aria-labelledby="audio-preferences-title">
        <div className="preference-section-heading"><AudioLines size={16} /><div><h3 id="audio-preferences-title">{translate("Audio pass-through")}</h3><p>{translate("Route audio from the selected capture input to the Windows default output.")}</p></div></div>
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
        <label className="preference-switch preference-switch-secondary"><span><strong>Include capture audio in recordings</strong><small>Record from the selected input, whether or not live pass-through is enabled.</small></span>
          <input type="checkbox" checked={includeAudioInRecordings} onChange={(event) => onIncludeAudioInRecordingsChange(event.target.checked)} disabled={!audioDeviceId} />
        </label>
        <label className="preference-slider"><span>Recording audio bitrate <strong>{Math.round(recordingAudioBitrate / 1000)} kbps</strong></span>
          <input type="range" min="32000" max="512000" step="16000" value={recordingAudioBitrate} onChange={(event) => onRecordingAudioBitrateChange(Number(event.target.value))} disabled={!includeAudioInRecordings} />
        </label>
        <label className="preference-field"><span>Recording sample rate</span>
          <select value={recordingAudioSampleRate} onChange={(event) => onRecordingAudioSampleRateChange(Number(event.target.value))} disabled={!includeAudioInRecordings}>
            <option value={22050}>22.05 kHz</option>
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
            <option value={96000}>96 kHz</option>
          </select>
        </label>
        <p className="preference-note">Recording audio is requested only when a recording starts. The Windows microphone permission prompt may appear the first time.</p>
      </section>

      <section className="preference-section" aria-labelledby="controller-mode-title">
        <div className="preference-section-heading"><Usb size={16} /><div><h3 id="controller-mode-title">{translate("Target controller mode")}</h3><p>{translate("Choose the USB keyboard and mouse profile presented to the target.")}</p></div></div>
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
        <div className="preference-section-heading"><MousePointer2 size={16} /><div><h3 id="pointer-preferences-title">{translate("Pointer control")}</h3><p>{translate("Choose how mouse movement reaches the target computer.")}</p></div></div>
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
        <div className="preference-section-heading"><Keyboard size={16} /><div><h3 id="keyboard-preferences-title">{translate("Keyboard and Windows")}</h3><p>{translate("Control shortcut forwarding and Windows idle behavior.")}</p></div></div>
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
    </Dialog>
  );
}
