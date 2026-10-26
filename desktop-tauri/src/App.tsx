import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { dirname, join, videoDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { open as openFile } from "@tauri-apps/plugin-fs";
import { Settings2, Video, X } from "lucide-react";
import { isLanguageCode, loadLanguage, setActiveLanguage, type LanguageCode } from "./i18n";
import { mergeMouseMoves, splitRelativeMove, type MouseReportCommand } from "./mouseMotion";
import type { AppPreferences, CapturePreset, ControllerStatus, ExternalDestination, FirmwareUpdateCheck, KeyboardLayoutInfo, KvmDevice, MouseMode, RecordingStatus, ReleaseSummary, UsbRoute } from "./types";
import { AboutDialog } from "./components/AboutDialog";
import { AppMenu, type AppMenuActions } from "./components/AppMenu";
import { CommandBar } from "./components/CommandBar";
import { FactoryResetDialog, FirmwareInstallDialog, FirmwareRestoreDialog, ResetConfirmationDialog } from "./components/ConfirmDialogs";
import { DeviceRail } from "./components/DeviceRail";
import { EnvironmentDialog } from "./components/EnvironmentDialog";
import { DiagnosticsDialog, type DiagnosticCheck } from "./components/DiagnosticsDialog";
import { FirmwareDialog } from "./components/FirmwareDialog";
import { WchFirmwareDialog } from "./components/WchFirmwareDialog";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { UpdateDialog } from "./components/UpdateDialog";

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

const capturePresetConstraints: Record<CapturePreset, { width: number; height: number; frameRate: number }> = {
  "720p30": { width: 1280, height: 720, frameRate: 30 },
  "1080p30": { width: 1920, height: 1080, frameRate: 30 },
};

type MouseReportJob = {
  command: MouseReportCommand;
  payload: Record<string, number>;
  coalesceMoves: boolean;
  completions: Array<() => void>;
};

function readPreference(key: string, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function recordingFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `openterface-recording-${timestamp}.webm`;
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
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [language, setLanguage] = useState<LanguageCode>(() => {
    const stored = readPreference("language", "en");
    return isLanguageCode(stored) ? stored : "en";
  });
  const [, setTranslationRevision] = useState(0);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState(() => readPreference("preferred-audio-device"));
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStarting, setAudioStarting] = useState(false);
  const [audioVolume, setAudioVolume] = useState(() => {
    const stored = Number(readPreference("audio-volume", "80"));
    return Number.isInteger(stored) && stored >= 0 && stored <= 100 ? stored : 80;
  });
  const [includeAudioInRecordings, setIncludeAudioInRecordings] = useState(() => readPreference("include-audio-in-recordings") === "true");
  const [recordingVideoBitrate, setRecordingVideoBitrate] = useState(() => {
    const stored = Number(readPreference("recording-video-bitrate", "8000000"));
    return Number.isInteger(stored) && stored >= 500_000 && stored <= 20_000_000 ? stored : 8_000_000;
  });
  const [recordingAudioBitrate, setRecordingAudioBitrate] = useState(() => {
    const stored = Number(readPreference("recording-audio-bitrate", "128000"));
    return Number.isInteger(stored) && stored >= 32_000 && stored <= 512_000 ? stored : 128_000;
  });
  const [recordingAudioSampleRate, setRecordingAudioSampleRate] = useState(() => {
    const stored = Number(readPreference("recording-audio-sample-rate", "44100"));
    return [22_050, 44_100, 48_000, 96_000].includes(stored) ? stored : 44_100;
  });
  const [recordingOutputPath, setRecordingOutputPath] = useState(() => readPreference("recording-output-path"));
  const [capturePreset, setCapturePreset] = useState<CapturePreset>(() => {
    const stored = readPreference("capture-quality", "1080p30");
    return stored in capturePresetConstraints ? stored as CapturePreset : "1080p30";
  });
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [resettingConnection, setResettingConnection] = useState(false);
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [environmentCopied, setEnvironmentCopied] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticsLastChecked, setDiagnosticsLastChecked] = useState("");
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [firmwareDialogOpen, setFirmwareDialogOpen] = useState(false);
  const [wchFirmwareOpen, setWchFirmwareOpen] = useState(false);
  const [firmwareVersion, setFirmwareVersion] = useState("");
  const [firmwareVersionLoading, setFirmwareVersionLoading] = useState(false);
  const [firmwareChecking, setFirmwareChecking] = useState(false);
  const [firmwareInstalling, setFirmwareInstalling] = useState(false);
  const [firmwareBackingUp, setFirmwareBackingUp] = useState(false);
  const [firmwareInstallConfirmOpen, setFirmwareInstallConfirmOpen] = useState(false);
  const [firmwareRestoreConfirmOpen, setFirmwareRestoreConfirmOpen] = useState(false);
  const [firmwareRestorePending, setFirmwareRestorePending] = useState<{ fileName: string; bytes: Uint8Array } | null>(null);
  const [firmwareInstallResult, setFirmwareInstallResult] = useState("");
  const [firmwareUpdateCheck, setFirmwareUpdateCheck] = useState<FirmwareUpdateCheck | null>(null);
  const [firmwareVersionError, setFirmwareVersionError] = useState("");
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
  const recordingAudioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioRequestId = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStopPromiseRef = useRef<Promise<void> | null>(null);
  const recordingSavePromiseRef = useRef<Promise<void> | null>(null);
  const recordingClockRef = useRef({ elapsedMs: 0, segmentStartedAt: 0 });
  const videoRequestId = useRef(0);
  const captureRequestId = useRef(0);
  const heldKeys = useRef(new Set<string>());
  const keyboardSendQueue = useRef<Promise<void>>(Promise.resolve());
  const heldButtons = useRef(0);
  const mouseReportJobs = useRef<MouseReportJob[]>([]);
  const mouseReportPumpRunning = useRef(false);
  const lastMouseSend = useRef(0);
  const lastMousePosition = useRef({ x: 0, y: 0 });
  const pointerLockIntent = useRef(false);
  const selectedDevice = devices.find((device) => device.portName === selectedPort);
  const selectedVideoInput = videoDevices.find((device) => device.deviceId === videoDeviceId);
  const environmentRows = [
    { label: "Application", value: `Openterface Mini-KVM ${appVersion}` },
    { label: "Desktop runtime", value: isTauri() ? "Tauri with WebView2" : "Browser preview" },
    { label: "Operating system", value: navigator.platform || "Unknown" },
    { label: "Controller", value: connected ? selectedDevice?.controller ?? "Connected" : "Disconnected" },
    { label: "Serial port", value: connected ? selectedPort : "Not connected" },
    { label: "Target status", value: controllerStatus ? controllerStatus.targetConnected ? "Online" : "Offline" : connected ? "Unknown" : "Not connected" },
    { label: "Video source", value: videoStream ? videoStream.getVideoTracks()[0]?.label || targetName : "Not streaming" },
    { label: "KVM capture input", value: selectedVideoInput?.label || (selectedDevice?.hasCamera ? "Detected" : "Not detected") },
    { label: "Capture preset", value: capturePreset },
    { label: "Target recording", value: recordingStatus === "idle" ? "Stopped" : recordingStatus === "paused" ? "Paused" : recordingStatus === "stopping" ? "Saving" : "Recording" },
    { label: "System shortcut capture", value: captureSystemShortcuts ? "Enabled" : "Disabled" },
    { label: "Screen-saver inhibition", value: inhibitScreenSaver ? "Enabled" : "Disabled" },
  ];
  const environmentReport = [
    ...environmentRows.map(({ label, value }) => `${label}: ${value}`),
    `Runtime details: ${navigator.userAgent}`,
  ].join("\n");

  const selectedAudioInput = audioDevices.find((device) => device.deviceId === audioDeviceId);
  const recorderAvailable = typeof MediaRecorder !== "undefined"
    && ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].some((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  const diagnosticChecks: DiagnosticCheck[] = [
    {
      label: "Controller discovery",
      status: devices.length ? "pass" : "attention",
      detail: devices.length ? `${devices.length} Mini-KVM controller${devices.length === 1 ? "" : "s"} found${selectedDevice ? ` · selected ${selectedDevice.portName}` : ""}.` : "No supported Mini-KVM controller is currently detected.",
    },
    {
      label: "Serial controller link",
      status: connected ? "pass" : "attention",
      detail: connected ? `${selectedDevice?.controller ?? "Controller"} connected on ${selectedPort}.` : "Connect a detected controller to check its serial link.",
    },
    {
      label: "Target connection",
      status: controllerStatus ? controllerStatus.targetConnected ? "pass" : "attention" : "unknown",
      detail: controllerStatus ? controllerStatus.targetConnected ? "The controller reports an attached target." : "The controller is connected, but reports no attached target." : "Target status is available after connecting to a controller.",
    },
    {
      label: "Video capture",
      status: videoStream ? "pass" : "attention",
      detail: videoStream ? `${videoStream.getVideoTracks()[0]?.label || targetName} is streaming.` : selectedDevice?.hasCamera ? "The Mini-KVM capture interface is detected, but its video stream is not open." : "The Mini-KVM capture interface is not detected.",
    },
    {
      label: "Audio capture",
      status: selectedAudioInput ? "pass" : "attention",
      detail: selectedAudioInput ? `${selectedAudioInput.label || "Audio input"} selected · live pass-through ${audioEnabled ? "on" : "off"}.` : `${audioDevices.length} audio input${audioDevices.length === 1 ? "" : "s"} found; choose an input in Preferences.`,
    },
    {
      label: "WebM recording",
      status: recorderAvailable ? "pass" : "attention",
      detail: recorderAvailable ? `WebView2 recording is available${includeAudioInRecordings ? " with optional audio" : " for video"}.` : "This WebView does not report a supported WebM encoder.",
    },
  ];

  const copyEnvironmentReport = async () => {
    try {
      await navigator.clipboard.writeText(environmentReport);
      setEnvironmentCopied(true);
    } catch (cause) {
      setError(`Could not copy the environment report: ${String(cause)}`);
    }
  };

  const runDiagnostics = async () => {
    setDiagnosticsRunning(true);
    setDiagnosticsCopied(false);
    const results = await Promise.allSettled([
      refreshDevices(),
      enumerateVideoInputs().then(setVideoDevices),
      refreshAudioDevices(),
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) setError(`Some device checks could not complete: ${failures.map((failure) => String(failure.reason)).join("; ")}`);
    setDiagnosticsLastChecked(new Date().toLocaleString());
    setDiagnosticsRunning(false);
  };

  const readCaptureFirmwareVersion = async () => {
    if (!selectedPort) return;
    setFirmwareVersionLoading(true);
    setFirmwareVersionError("");
    try {
      const version = await invoke<string>("read_capture_firmware_version", { portName: selectedPort });
      setFirmwareVersion(version);
    } catch (cause) {
      setFirmwareVersionError(String(cause));
    } finally {
      setFirmwareVersionLoading(false);
    }
  };

  const checkCaptureFirmwareUpdate = async () => {
    if (!selectedPort) return;
    setFirmwareChecking(true);
    setFirmwareVersionError("");
    setFirmwareInstallResult("");
    setFirmwareUpdateCheck(null);
    try {
      const result = await invoke<FirmwareUpdateCheck>("check_capture_firmware_update", { portName: selectedPort });
      setFirmwareUpdateCheck(result);
      setFirmwareVersion(result.currentVersion);
    } catch (cause) {
      setFirmwareVersionError(String(cause));
    } finally {
      setFirmwareChecking(false);
    }
  };

  const installCaptureFirmware = async () => {
    if (!selectedPort) return;
    setFirmwareInstalling(true);
    setFirmwareVersionError("");
    setFirmwareInstallResult("");
    try {
      const result = await invoke<string>("install_capture_firmware", { portName: selectedPort });
      setFirmwareInstallResult(result);
      setFirmwareUpdateCheck(null);
      setFirmwareInstallConfirmOpen(false);
    } catch (cause) {
      setFirmwareVersionError(String(cause));
      setFirmwareInstallConfirmOpen(false);
    } finally {
      setFirmwareInstalling(false);
    }
  };

  const backupCaptureFirmware = async () => {
    if (!selectedPort) return;
    const chipName = selectedDevice?.captureChip ?? "capture";
    let outputPath: string | null;
    try {
      outputPath = await save({
        defaultPath: `openterface-${chipName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-firmware-backup.bin`,
        filters: [{ name: "Firmware binary", extensions: ["bin"] }],
      });
    } catch (cause) {
      setFirmwareVersionError(String(cause));
      return;
    }
    if (!outputPath) return;
    setFirmwareBackingUp(true);
    setFirmwareVersionError("");
    setFirmwareInstallResult("");
    try {
      const bytes = await invoke<number[]>("backup_capture_firmware", { portName: selectedPort });
      const file = await openFile(outputPath, { write: true, create: true, truncate: true });
      try {
        await file.write(new Uint8Array(bytes));
      } finally {
        await file.close();
      }
      setFirmwareInstallResult(`Firmware backup saved to ${outputPath}.`);
    } catch (cause) {
      setFirmwareVersionError(String(cause));
    } finally {
      setFirmwareBackingUp(false);
    }
  };

  const chooseFirmwareRestore = async () => {
    if (!selectedPort) return;
    try {
      const selectedFile = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Firmware binary", extensions: ["bin"] }],
      });
      if (typeof selectedFile !== "string") return;
      const file = await openFile(selectedFile, { read: true });
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        const buffer = new Uint8Array(8192);
        while (true) {
          const bytesRead = await file.read(buffer);
          if (!bytesRead) break;
          totalBytes += bytesRead;
          if (totalBytes > 65536) throw new Error("The firmware file exceeds the supported EEPROM image size.");
          chunks.push(buffer.slice(0, bytesRead));
        }
      } finally {
        await file.close();
      }
      if (totalBytes < 16) throw new Error("The selected file is too small to be a capture firmware image.");
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      setFirmwareRestorePending({ fileName: selectedFile.split(/[\\/]/).pop() || "firmware.bin", bytes });
      setFirmwareVersionError("");
      setFirmwareRestoreConfirmOpen(true);
    } catch (cause) {
      setFirmwareVersionError(String(cause));
    }
  };

  const restoreCaptureFirmware = async () => {
    if (!selectedPort || !firmwareRestorePending) return;
    setFirmwareInstalling(true);
    setFirmwareVersionError("");
    setFirmwareInstallResult("");
    try {
      const result = await invoke<string>("restore_capture_firmware", {
        portName: selectedPort,
        bytes: Array.from(firmwareRestorePending.bytes),
      });
      setFirmwareInstallResult(result);
      setFirmwareRestorePending(null);
      setFirmwareRestoreConfirmOpen(false);
    } catch (cause) {
      setFirmwareVersionError(String(cause));
      setFirmwareRestoreConfirmOpen(false);
      setFirmwareRestorePending(null);
    } finally {
      setFirmwareInstalling(false);
    }
  };

  const copyDiagnosticsReport = async () => {
    const report = [
      `Openterface hardware diagnostics · ${new Date().toLocaleString()}`,
      ...diagnosticChecks.map((check) => `${check.status.toUpperCase()} · ${check.label}: ${check.detail}`),
      `Runtime: ${navigator.userAgent}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      setDiagnosticsCopied(true);
    } catch (cause) {
      setError(`Could not copy the diagnostic report: ${String(cause)}`);
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
          if (isLanguageCode(saved.language)) setLanguage(saved.language);
          setSelectedPort(saved.preferredControllerPort);
          setAudioDeviceId(saved.preferredAudioDevice || "");
          setAudioVolume(Number.isInteger(saved.audioVolume) && saved.audioVolume >= 0 && saved.audioVolume <= 100 ? saved.audioVolume : 80);
          setIncludeAudioInRecordings(saved.includeAudioInRecordings);
          setRecordingVideoBitrate(Number.isInteger(saved.recordingVideoBitrate) && saved.recordingVideoBitrate >= 500_000 && saved.recordingVideoBitrate <= 20_000_000 ? saved.recordingVideoBitrate : 8_000_000);
          setRecordingAudioBitrate(Number.isInteger(saved.recordingAudioBitrate) && saved.recordingAudioBitrate >= 32_000 && saved.recordingAudioBitrate <= 512_000 ? saved.recordingAudioBitrate : 128_000);
          setRecordingAudioSampleRate([22_050, 44_100, 48_000, 96_000].includes(saved.recordingAudioSampleRate) ? saved.recordingAudioSampleRate : 44_100);
          setRecordingOutputPath(saved.recordingOutputPath || "");
          setCapturePreset(saved.captureQuality in capturePresetConstraints ? saved.captureQuality : "1080p30");
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
    if (!recorder || recorder.state === "inactive") return recordingSavePromiseRef.current ?? Promise.resolve();
    if (recordingClockRef.current.segmentStartedAt) {
      recordingClockRef.current.elapsedMs += Date.now() - recordingClockRef.current.segmentStartedAt;
      recordingClockRef.current.segmentStartedAt = 0;
      setRecordingDurationMs(recordingClockRef.current.elapsedMs);
    }
    setRecordingStatus("stopping");
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    const completed = stopped.then(async () => {
      await recordingSavePromiseRef.current;
    });
    recordingStopPromiseRef.current = completed;
    void completed.then(() => {
      if (recordingStopPromiseRef.current === completed) recordingStopPromiseRef.current = null;
    }, () => {
      if (recordingStopPromiseRef.current === completed) recordingStopPromiseRef.current = null;
    });
    recorder.stop();
    return completed;
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
      if ((!recorder || recorder.state === "inactive") && !recordingSavePromiseRef.current) return;
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

  const startRecording = useCallback(async () => {
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
    let audioStream: MediaStream | null = null;
    let outputPath: string | null = null;
    try {
      if (isTauri()) {
        const directory = recordingOutputPath ? await dirname(recordingOutputPath) : await videoDir();
        const path = await save({
          defaultPath: await join(directory, recordingFilename()),
          filters: [{ name: "WebM video", extensions: ["webm"] }],
        });
        if (!path) return;
        if (!path.toLowerCase().endsWith(".webm")) {
          throw new Error("WebView2 recordings are saved as WebM. Choose a .webm filename.");
        }
        outputPath = path;
        setRecordingOutputPath(path);
      }
      if (includeAudioInRecordings) {
        if (!audioDeviceId) throw new Error("Choose an audio input in Preferences before recording with audio.");
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Audio capture is unavailable in this Windows WebView.");
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: audioDeviceId },
            sampleRate: { ideal: recordingAudioSampleRate },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
        if (!audioStream.getAudioTracks().some((track) => track.readyState === "live")) {
          throw new Error("The selected audio input did not provide a live audio track.");
        }
      }
      if (activeVideoStream.current !== stream || stream.getVideoTracks().every((track) => track.readyState !== "live")) {
        throw new Error("The video source changed while audio access was being requested.");
      }
      recordingChunksRef.current = [];
      recordingStopPromiseRef.current = null;
      recordingSavePromiseRef.current = null;
      recordingClockRef.current = { elapsedMs: 0, segmentStartedAt: Date.now() };
      setRecordingDurationMs(0);
      const videoBitsPerSecond = recordingVideoBitrate;
      const recordingStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...(audioStream?.getAudioTracks() ?? []),
      ]);
      const recorder = new MediaRecorder(recordingStream, {
        mimeType,
        videoBitsPerSecond,
        ...(audioStream ? { audioBitsPerSecond: recordingAudioBitrate } : {}),
      });
      recordingAudioStreamRef.current = audioStream;
      audioStream = null;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => setError("Recording stopped because the capture stream reported an error.");
      recorder.onstop = () => {
        recordingAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingAudioStreamRef.current = null;
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        recorderRef.current = null;
        setRecordingDurationMs(0);
        recordingClockRef.current = { elapsedMs: 0, segmentStartedAt: 0 };
        const recording = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!recording.size) {
          setError("The recording did not contain any video data.");
          setRecordingStatus("idle");
          return;
        }
        recordingSavePromiseRef.current = (async () => {
          try {
            if (outputPath) {
              const file = await openFile(outputPath, { write: true, create: true, truncate: true });
              try {
                for (const chunk of chunks) {
                  if (chunk.size) await file.write(new Uint8Array(await chunk.arrayBuffer()));
                }
              } finally {
                await file.close();
              }
              setNoticeMessage(`Recording saved as ${outputPath.split(/[\\/]/).pop() || "WebM video"}.`);
            } else {
              const url = URL.createObjectURL(recording);
              const link = document.createElement("a");
              link.href = url;
              link.download = recordingFilename();
              document.body.appendChild(link);
              link.click();
              link.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNoticeMessage("Recording saved to your Downloads folder as WebM.");
            }
          } catch (cause) {
            setError(`Could not save the recording: ${String(cause)}`);
          } finally {
            setRecordingStatus("idle");
            recordingSavePromiseRef.current = null;
          }
        })();
      };
      recorder.start(1000);
      setRecordingStatus("recording");
    } catch (cause) {
      audioStream?.getTracks().forEach((track) => track.stop());
      recordingAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingAudioStreamRef.current = null;
      recorderRef.current = null;
      recordingClockRef.current = { elapsedMs: 0, segmentStartedAt: 0 };
      setRecordingStatus("idle");
      setError(`Could not start recording: ${String(cause)}`);
    }
  }, [audioDeviceId, includeAudioInRecordings, recordingAudioBitrate, recordingAudioSampleRate, recordingOutputPath, recordingVideoBitrate]);

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

  const queueMouseReport = useCallback((command: MouseReportCommand, payload: Record<string, number>, coalesceMoves = false) => {
    const completion = new Promise<void>((resolve) => {
      const jobs = mouseReportJobs.current;
      const lastJob = jobs[jobs.length - 1];
      const merged = coalesceMoves && lastJob?.coalesceMoves && lastJob.command === command
        ? mergeMouseMoves(command, lastJob.payload, payload) : null;
      if (lastJob && merged) {
        lastJob.payload = merged;
        lastJob.completions.push(resolve);
      } else {
        jobs.push({ command, payload, coalesceMoves, completions: [resolve] });
      }

      if (mouseReportPumpRunning.current) return;
      mouseReportPumpRunning.current = true;
      void (async () => {
        while (mouseReportJobs.current.length) {
          const job = mouseReportJobs.current.shift()!;
          try {
            if (job.command === "send_relative_mouse_report" && job.coalesceMoves) {
              let remaining = job.payload;
              while (remaining.dx !== 0 || remaining.dy !== 0) {
                const step = splitRelativeMove(remaining);
                await invoke<void>(job.command, step.report);
                remaining = step.remaining;
              }
            } else {
              await invoke<void>(job.command, job.payload);
            }
          } catch (cause) {
            setError(String(cause));
          } finally {
            job.completions.forEach((finish) => finish());
          }
        }
        mouseReportPumpRunning.current = false;
      })();
    });
    return completion;
  }, []);

  const releaseMouseButtons = useCallback(async () => {
    if (!heldButtons.current) return;
    heldButtons.current = 0;
    if (mouseMode === "relative") {
      await queueMouseReport("send_relative_mouse_report", { dx: 0, dy: 0, buttons: 0, wheel: 0 });
    } else {
      const { x, y } = lastMousePosition.current;
      await queueMouseReport("send_mouse_report", { x, y, buttons: 0, wheel: 0 });
    }
  }, [mouseMode, queueMouseReport]);

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
      if (document.pointerLockElement === videoRef.current) {
        pointerLockIntent.current = false;
        return;
      }
      void releaseMouseButtons();
      if (pointerLockIntent.current && mouseMode === "relative") {
        pointerLockIntent.current = false;
        setMouseMode("absolute");
      }
    };
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    return () => document.removeEventListener("pointerlockchange", handlePointerLockChange);
  }, [mouseMode, releaseMouseButtons]);

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
    let cancelled = false;
    void loadLanguage(language)
      .then(() => { if (!cancelled) setTranslationRevision((revision) => revision + 1); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [language]);

  useLayoutEffect(() => {
    setActiveLanguage(language);
    setTranslationRevision((revision) => revision + 1);
  }, [language]);

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

  const openVideo = useCallback(async (cameraHint?: string | null) => {
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
        const hinted = cameraHint
          ? devices.find((device) => device.label.toLowerCase().includes(cameraHint.toLowerCase()))
          : undefined;
        const capture = devices.find((device) => /openterface|usb.*(video|capture)|capture.*usb|hdmi/i.test(device.label));
        return hinted ?? capture;
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
      if (preferred) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraintsFor(preferred.deviceId));
        } catch {
          if (!isCurrentRequest()) return;
          throw new Error("Could not open the Mini-KVM capture input");
        }
      } else {
        // WebView2 hides camera labels until a camera permission has been
        // granted. Open a temporary stream only to reveal labels, then stop
        // it before selecting the Mini-KVM input below.
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
      preferred = findPreferred(inputs);
      if (!preferred) {
        stream.getTracks().forEach((track) => track.stop());
        setVideoStream((current) => {
          current?.getTracks().forEach((track) => track.stop());
          activeVideoStream.current = null;
          return null;
        });
        setVideoError("Could not identify the Mini-KVM capture input. Check the device connection and reconnect.");
        setTargetName("No signal");
        return;
      }
      const currentDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (preferred.deviceId !== currentDeviceId) {
        let preferredStream: MediaStream;
        try {
          preferredStream = await navigator.mediaDevices.getUserMedia(constraintsFor(preferred.deviceId));
        } catch {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("Could not open the Mini-KVM capture input");
        }
        if (!isCurrentRequest()) {
          preferredStream.getTracks().forEach((track) => track.stop());
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getTracks().forEach((track) => track.stop());
        stream = preferredStream;
      }
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? preferred.deviceId;
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
      setVideoError(`Could not open the Mini-KVM capture input: ${String(cause)}`);
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
      await openVideo(selectedDevice?.cameraName);
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
    heldKeys.current.clear();
    await sendKeys(true);
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

  const sendKeys = useCallback((forceRelease = false) => {
    if (appliedControllerMode === 3) return Promise.resolve();
    const keysDown = forceRelease ? [] : [...heldKeys.current];
    const modifiers = keysDown.reduce((mask, code) => mask | (modifierBits[code] ?? 0), 0);
    const keys = keysDown.map((code) => keyUsages[code]).filter((key): key is number => key !== undefined).slice(0, 6);
    keyboardSendQueue.current = keyboardSendQueue.current
      .catch(() => undefined)
      .then(async () => {
        await invoke<void>("send_keyboard_report", { modifiers, keys });
        if (forceRelease) await invoke<void>("send_keyboard_report", { modifiers: 0, keys: [] });
      })
      .catch((cause) => { setError(String(cause)); });
    return keyboardSendQueue.current;
  }, [appliedControllerMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("preferred-controller-port", selectedPort);
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
  }, [selectedPort]);

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
      language,
      preferredControllerPort: selectedPort,
      preferredVideoDevice: videoDeviceId,
      preferredAudioDevice: audioDeviceId || readPreference("preferred-audio-device"),
      audioVolume,
      includeAudioInRecordings,
      recordingVideoBitrate,
      recordingAudioBitrate,
      recordingAudioSampleRate,
      recordingOutputPath,
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
  }, [appliedControllerMode, audioDeviceId, audioVolume, capturePreset, captureSystemShortcuts, includeAudioInRecordings, inhibitScreenSaver, keyboardLayout, language, mouseAutoHide, mouseMode, preferencesReady, recordingAudioBitrate, recordingAudioSampleRate, recordingOutputPath, recordingVideoBitrate, selectedPort, videoDeviceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem("keyboard-layout", keyboardLayout);
    } catch {
      // Preferences remain active for the current session when storage is unavailable.
    }
  }, [keyboardLayout]);

  useEffect(() => {
    try {
      window.localStorage.setItem("include-audio-in-recordings", String(includeAudioInRecordings));
    } catch {
      // The Tauri preferences file remains authoritative in the desktop app.
    }
  }, [includeAudioInRecordings]);

  useEffect(() => {
    try {
      window.localStorage.setItem("recording-video-bitrate", String(recordingVideoBitrate));
    } catch {
      // The Tauri preferences file remains authoritative in the desktop app.
    }
  }, [recordingVideoBitrate]);

  useEffect(() => {
    try {
      window.localStorage.setItem("recording-output-path", recordingOutputPath);
    } catch {
      // The Tauri preferences file remains authoritative in the desktop app.
    }
  }, [recordingOutputPath]);

  useEffect(() => {
    try {
      window.localStorage.setItem("recording-audio-bitrate", String(recordingAudioBitrate));
      window.localStorage.setItem("recording-audio-sample-rate", String(recordingAudioSampleRate));
    } catch {
      // The Tauri preferences file remains authoritative in the desktop app.
    }
  }, [recordingAudioBitrate, recordingAudioSampleRate]);

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
      if (!keyUsages[event.code] && !modifierBits[event.code]) return;
      if (!controlActive && !heldKeys.current.has(event.code)) return;
      event.preventDefault();
      heldKeys.current.delete(event.code);
      void sendKeys();
    };
    const release = () => {
      heldKeys.current.clear();
      void sendKeys(true);
      void releaseMouseButtons();
    };
    const releaseOnHide = () => {
      if (document.visibilityState !== "visible") release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", releaseOnHide);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", releaseOnHide);
      release();
    };
  }, [connected, controlActive, releaseMouseButtons, sendKeys]);

  const sendPointer = (event: PointerEvent<HTMLVideoElement>) => {
    if (!connected || appliedControllerMode === 1 || appliedControllerMode === 3 || !videoRef.current) return;
    const now = performance.now();
    const pointerReportInterval = 16;
    // Mouse button chords can change on pointermove: pointerdown/up only fire
    // when the first button is pressed or the last button is released.
    const buttons = event.buttons & 7;
    const buttonsChanged = event.type === "pointermove" && heldButtons.current !== buttons;
    if (buttonsChanged) {
      heldButtons.current = buttons;
      if (mouseMode === "relative") {
        void queueMouseReport("send_relative_mouse_report", { dx: 0, dy: 0, buttons, wheel: 0 });
      } else {
        const { x, y } = targetCoordinates(event, videoRef.current, videoZoom);
        lastMousePosition.current = { x, y };
        void queueMouseReport("send_mouse_report", { x, y, buttons, wheel: 0 });
        lastMouseSend.current = now;
        return;
      }
    }
    if (mouseMode === "relative") {
      const dx = event.type === "pointermove" ? event.movementX : 0;
      const dy = event.type === "pointermove" ? event.movementY : 0;
      if (event.type === "pointermove" && dx === 0 && dy === 0) return;
      void queueMouseReport("send_relative_mouse_report", { dx, dy, buttons: heldButtons.current, wheel: 0 }, event.type === "pointermove");
      return;
    }
    if (event.type === "pointermove" && now - lastMouseSend.current < pointerReportInterval) return;
    lastMouseSend.current = now;
    const { x, y } = targetCoordinates(event, videoRef.current, videoZoom);
    lastMousePosition.current = { x, y };
    void queueMouseReport("send_mouse_report", { x, y, buttons: heldButtons.current, wheel: 0 }, event.type === "pointermove");
  };

  const setPointerButton = (event: PointerEvent<HTMLVideoElement>, pressed: boolean) => {
    event.preventDefault();
    if (appliedControllerMode === 1 || appliedControllerMode === 3) return;
    const buttons = event.buttons & 7;
    if (buttons === heldButtons.current) return;
    if (mouseMode === "relative" && pressed && buttons) requestPointerCapture();
    if (pressed && buttons && mouseMode === "absolute") {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The pointer may have been cancelled by the window manager. */ }
    }
    heldButtons.current = buttons;
    sendPointer(event);
    if (!buttons && mouseMode === "absolute") {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
      if (bounds && (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom)) {
        setControlActive(false);
      }
    }
  };

  const scroll = (event: WheelEvent<HTMLVideoElement>) => {
    event.preventDefault();
    if (!connected || appliedControllerMode === 1 || appliedControllerMode === 3 || !videoRef.current) return;
    const wheel = Math.max(-127, Math.min(127, Math.trunc(-event.deltaY / 50)));
    if (mouseMode === "relative") {
      void queueMouseReport("send_relative_mouse_report", { dx: 0, dy: 0, buttons: heldButtons.current, wheel });
      return;
    }
    const { x, y } = targetCoordinates(event, videoRef.current, videoZoom);
    // DOM deltaY is positive down; CH9329 expects positive values for up.
    void queueMouseReport("send_mouse_report", { x, y, buttons: heldButtons.current, wheel });
  };

  const menuActions: AppMenuActions = {
    preferences: () => setPreferencesOpen(true),
    paste: () => void pasteToTarget(),
    screenshot: takeScreenshot,
    toggleRecording: () => { if (recordingStatus === "idle") startRecording(); else void stopRecording(); },
    setMouseMode: switchMouseMode,
    zoomIn,
    zoomOut,
    resetZoom,
    fullscreen: () => void toggleFullscreen(),
    resetConnection: () => setResetConfirmationOpen(true),
    factoryReset: () => setFactoryResetOpen(true),
    environment: () => { setEnvironmentCopied(false); setEnvironmentOpen(true); },
    diagnostics: () => { setDiagnosticsCopied(false); setDiagnosticsOpen(true); },
    firmware: () => { setFirmwareVersion(""); setFirmwareVersionError(""); setFirmwareUpdateCheck(null); setFirmwareInstallResult(""); setFirmwareDialogOpen(true); },
    wchFirmware: () => setWchFirmwareOpen(true),
    checkForUpdates: () => void checkForUpdates(),
    about: () => setAboutOpen(true),
    website: () => void openExternalLink("website"),
    feedback: () => void openExternalLink("feedback"),
    releases: () => void openExternalLink("releases"),
    closeWindow: () => void closeWindow(),
  };

  return (
    <div className={`app-shell ${fullscreenActive ? "is-fullscreen" : ""}`}>
      {!fullscreenActive && (
        <TitleBar
          connected={connected}
          onClose={() => void closeWindow()}
          actions={<>
            <button className="icon-button" type="button" aria-label="Open preferences" title="Preferences" onClick={() => setPreferencesOpen(true)}>
              <Settings2 size={16} />
            </button>
            <AppMenu
              open={appMenuOpen}
              onOpenChange={setAppMenuOpen}
              wrapRef={appMenuRef}
              triggerRef={appMenuTriggerRef}
              actions={menuActions}
              connected={connected}
              hasVideo={!!videoStream}
              pasting={pasting}
              pasteDisabled={appliedControllerMode === 3}
              recordingStatus={recordingStatus}
              mouseMode={mouseMode}
              fullscreenActive={fullscreenActive}
              updateChecking={updateChecking}
              resettingConnection={resettingConnection}
              factoryResetting={factoryResetting}
              firmwareAvailable={!!selectedDevice?.captureChip}
            />
          </>}
        />
      )}

      <div className="workspace">
        <DeviceRail
          devices={devices}
          selectedPort={selectedPort}
          onSelectPort={setSelectedPort}
          selectedDevice={selectedDevice}
          connected={connected}
          connecting={connecting}
          loadingDevices={loadingDevices}
          controllerStatus={controllerStatus}
          hasVideo={!!videoStream}
          usbRoute={usbRoute}
          switchingUsbRoute={switchingUsbRoute}
          onSwitchRoute={(route) => void switchUsbRoute(route)}
          onConnect={() => void connect()}
          onDisconnect={() => void disconnect()}
          onScan={() => void refreshDevices()}
          connectionLabel={connectionLabel}
          controllerMode={appliedControllerMode}
          mouseMode={mouseMode}
          onOpenPreferences={() => setPreferencesOpen(true)}
        />

        <main className="main-area">
          {(error || videoError) && <div className="banner banner-error" role="alert"><span>{error || videoError}</span><button type="button" aria-label="Dismiss error" onClick={() => { setError(""); setVideoError(""); }}><X size={14} /></button></div>}
          {noticeMessage && <div className="banner" role="status"><span>{noticeMessage}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNoticeMessage("")}><X size={14} /></button></div>}

          <CommandBar
            hasVideo={!!videoStream}
            targetName={targetName}
            recordingStatus={recordingStatus}
            recordingDurationMs={recordingDurationMs}
            onStartRecording={startRecording}
            onStopRecording={() => void stopRecording()}
            onTogglePause={toggleRecordingPause}
            zoom={videoZoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onScreenshot={takeScreenshot}
            fullscreenActive={fullscreenActive}
            onToggleFullscreen={() => void toggleFullscreen()}
          />

          <div className={`video-stage ${videoStream ? "has-video" : ""} ${mouseAutoHide && controlActive ? "auto-hide-cursor" : ""}`} tabIndex={connected ? 0 : -1} aria-label={connected ? "Target display, keyboard and mouse control active when focused" : "Target display unavailable until a device is connected"} onPointerEnter={() => setControlActive(true)} onPointerLeave={() => { if (heldButtons.current || document.pointerLockElement === videoRef.current) return; setControlActive(false); if (heldKeys.current.size) { heldKeys.current.clear(); void sendKeys(); } }} onFocus={() => setControlActive(true)}>
            {videoStream ? <video ref={videoRef} style={{ transform: `scale(${videoZoom})` }} autoPlay playsInline muted onContextMenu={(event) => event.preventDefault()} onPointerMove={sendPointer} onPointerDown={(event) => setPointerButton(event, true)} onPointerUp={(event) => setPointerButton(event, false)} onPointerCancel={() => void releaseMouseButtons()} onWheel={scroll} /> : <div className="empty-display">
              <Video size={20} strokeWidth={1.5} aria-hidden="true" />
              <div className="empty-copy"><h2>{connected ? "No video signal" : "No target display"}</h2><p>{connected ? "Waiting for the Mini-KVM capture input." : "Connect a Mini-KVM to view its video input."}</p></div>
            </div>}
          </div>

          <StatusBar connected={connected} controllerMode={appliedControllerMode} mouseMode={mouseMode} audioStarting={audioStarting} audioEnabled={audioEnabled} audioVolume={audioVolume} />
        </main>
      </div>
      <PreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        language={language}
        onLanguageChange={(value) => {
          setActiveLanguage(value);
          setLanguage(value);
          try { window.localStorage.setItem("language", value); } catch { /* Preferences still save through Tauri. */ }
        }}
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
        audioDevices={audioDevices}
        audioDeviceId={audioDeviceId}
        onSelectAudioDevice={(deviceId) => { setAudioDeviceId(deviceId); if (audioEnabled) { stopAudio(); if (deviceId) void startAudio(deviceId); } }}
        onRefreshAudioDevices={() => void refreshAudioDevices()}
        audioEnabled={audioEnabled}
        audioStarting={audioStarting}
        onToggleAudio={(enabled) => { if (enabled) void startAudio(); else stopAudio(); }}
        audioVolume={audioVolume}
        onAudioVolumeChange={setAudioVolume}
        includeAudioInRecordings={includeAudioInRecordings}
        onIncludeAudioInRecordingsChange={setIncludeAudioInRecordings}
        capturePreset={capturePreset}
        onCapturePresetChange={setCapturePreset}
        recordingVideoBitrate={recordingVideoBitrate}
        onRecordingVideoBitrateChange={setRecordingVideoBitrate}
        recordingAudioBitrate={recordingAudioBitrate}
        onRecordingAudioBitrateChange={setRecordingAudioBitrate}
        recordingAudioSampleRate={recordingAudioSampleRate}
        onRecordingAudioSampleRateChange={setRecordingAudioSampleRate}
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
      <DiagnosticsDialog open={diagnosticsOpen} checks={diagnosticChecks} running={diagnosticsRunning} lastChecked={diagnosticsLastChecked} copied={diagnosticsCopied} onRefresh={() => void runDiagnostics()} onClose={() => setDiagnosticsOpen(false)} onCopy={() => void copyDiagnosticsReport()} />
      <FirmwareDialog open={firmwareDialogOpen && !firmwareInstallConfirmOpen && !firmwareRestoreConfirmOpen} chip={selectedDevice?.captureChip ?? null} portName={selectedPort} version={firmwareVersion} reading={firmwareVersionLoading} checking={firmwareChecking} installing={firmwareInstalling} backingUp={firmwareBackingUp} updateCheck={firmwareUpdateCheck} installResult={firmwareInstallResult} error={firmwareVersionError} onReadVersion={() => void readCaptureFirmwareVersion()} onCheckUpdate={() => void checkCaptureFirmwareUpdate()} onInstall={() => setFirmwareInstallConfirmOpen(true)} onBackup={() => void backupCaptureFirmware()} onRestore={() => void chooseFirmwareRestore()} onClose={() => setFirmwareDialogOpen(false)} />
      <WchFirmwareDialog open={wchFirmwareOpen} onClose={() => setWchFirmwareOpen(false)} />
      <UpdateDialog open={updateDialogOpen} currentVersion={appVersion} release={latestRelease} loading={updateChecking} error={updateCheckError} onClose={() => setUpdateDialogOpen(false)} onOpenReleases={() => void openExternalLink("releases")} />
      <ResetConfirmationDialog open={resetConfirmationOpen} busy={resettingConnection} onClose={() => setResetConfirmationOpen(false)} onConfirm={() => void resetSerialConnection()} />
      <FactoryResetDialog open={factoryResetOpen} busy={factoryResetting} onClose={() => setFactoryResetOpen(false)} onConfirm={() => void factoryResetController()} />
      <FirmwareInstallDialog open={firmwareInstallConfirmOpen} busy={firmwareInstalling} chip={firmwareUpdateCheck?.chip ?? selectedDevice?.captureChip ?? "capture"} version={firmwareUpdateCheck?.latestVersion ?? ""} onClose={() => setFirmwareInstallConfirmOpen(false)} onConfirm={() => void installCaptureFirmware()} />
      <FirmwareRestoreDialog open={firmwareRestoreConfirmOpen} busy={firmwareInstalling} chip={selectedDevice?.captureChip ?? "capture"} fileName={firmwareRestorePending?.fileName ?? "firmware.bin"} onClose={() => { setFirmwareRestoreConfirmOpen(false); setFirmwareRestorePending(null); }} onConfirm={() => void restoreCaptureFirmware()} />
    </div>
  );
}

export default App;
