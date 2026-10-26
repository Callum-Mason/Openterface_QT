import type { LanguageCode } from "./i18n";

export type ExternalDestination = "website" | "purchase" | "feedback" | "releases";
export type ReleaseSummary = { version: string; title: string; notes: string; updateAvailable: boolean };

export type KvmDevice = {
  portName: string;
  manufacturer: string | null;
  product: string | null;
  serialNumber: string | null;
  vendorId: number | null;
  productId: number | null;
  controller: string | null;
  generation: string | null;
  captureChip: string | null;
  cameraName: string | null;
  hasHid: boolean;
  hasCamera: boolean;
  hasAudio: boolean;
};

export type ControllerStatus = {
  targetConnected: boolean;
  numLock: boolean;
  capsLock: boolean;
  scrollLock: boolean;
};

export type CapturePreset = "720p30" | "1080p30" | "1080p60";
export type MouseMode = "absolute" | "relative";
export type UsbRoute = "unknown" | "host" | "target";
export type RecordingStatus = "idle" | "recording" | "paused" | "stopping";
export type AppPreferences = {
  language: LanguageCode;
  preferredControllerPort: string;
  preferredVideoDevice: string;
  preferredAudioDevice: string;
  audioVolume: number;
  includeAudioInRecordings: boolean;
  recordingVideoBitrate: number;
  recordingAudioBitrate: number;
  recordingAudioSampleRate: number;
  recordingOutputPath: string;
  captureQuality: CapturePreset;
  captureSystemShortcuts: boolean;
  inhibitScreenSaver: boolean;
  controllerMode: number;
  mouseMode: MouseMode;
  mouseAutoHide: boolean;
  keyboardLayout: string;
};

export type KeyboardLayoutInfo = { id: string; name: string };
