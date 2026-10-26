import { Circle, ImageDown, Maximize, Minimize, Pause, Play, Square, ZoomIn, ZoomOut } from "lucide-react";
import { formatRecordingDuration } from "../lib/format";
import type { RecordingStatus } from "../types";

type CommandBarProps = {
  connected: boolean;
  hasVideo: boolean;
  targetName: string;
  videoDevices: MediaDeviceInfo[];
  videoDeviceId: string;
  onSelectVideo: (deviceId: string) => void;
  recordingStatus: RecordingStatus;
  recordingDurationMs: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTogglePause: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onScreenshot: () => void;
  fullscreenActive: boolean;
  onToggleFullscreen: () => void;
};

export function CommandBar({
  connected, hasVideo, targetName, videoDevices, videoDeviceId, onSelectVideo, recordingStatus, recordingDurationMs, onStartRecording, onStopRecording,
  onTogglePause, zoom, onZoomIn, onZoomOut, onScreenshot, fullscreenActive, onToggleFullscreen,
}: CommandBarProps) {
  const stopping = recordingStatus === "stopping";
  return (
    <div className="commandbar" role="toolbar" aria-label="Target display tools">
      <div className="commandbar-title">
        <strong>Target display</strong>
        <span className="target-name">{hasVideo ? targetName : "No signal"}</span>
      </div>
      <div className="commandbar-tools">
        {connected && videoDevices.length > 1 && (
          <select className="select select-compact" aria-label="Video capture device" value={videoDeviceId} onChange={(event) => onSelectVideo(event.target.value)}>
            {videoDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Video device ${index + 1}`}</option>)}
          </select>
        )}
        <span className="tool-divider" aria-hidden="true" />
        {recordingStatus === "idle"
          ? <button className="console-tool recording-start" type="button" aria-label="Start video recording" title="Start video recording (Ctrl+Shift+R)" onClick={onStartRecording} disabled={!hasVideo}><Circle size={14} fill="currentColor" /></button>
          : <>
            <span className={`recording-clock ${recordingStatus === "recording" ? "is-recording" : ""}`} role="status">
              <span className="recording-dot" />
              {recordingStatus === "paused" ? `Paused ${formatRecordingDuration(recordingDurationMs)}` : stopping ? "Saving" : formatRecordingDuration(recordingDurationMs)}
            </span>
            <button className="console-tool" type="button" aria-label={recordingStatus === "paused" ? "Resume recording" : "Pause recording"} title={recordingStatus === "paused" ? "Resume recording" : "Pause recording"} onClick={onTogglePause} disabled={stopping}>
              {recordingStatus === "paused" ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button className="console-tool" type="button" aria-label="Stop and save recording" title="Stop and save recording" onClick={onStopRecording} disabled={stopping}><Square size={14} fill="currentColor" /></button>
          </>}
        <span className="tool-divider" aria-hidden="true" />
        <button className="console-tool" type="button" aria-label="Zoom out" title="Zoom out (Ctrl+-)" onClick={onZoomOut}><ZoomOut size={14} /></button>
        <span className="zoom-indicator mono" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span>
        <button className="console-tool" type="button" aria-label="Zoom in" title="Zoom in (Ctrl++)" onClick={onZoomIn}><ZoomIn size={14} /></button>
        <span className="tool-divider" aria-hidden="true" />
        <button className="console-tool" type="button" aria-label="Save target screenshot" title="Save target screenshot (Ctrl+Shift+S)" onClick={onScreenshot} disabled={!hasVideo}><ImageDown size={14} /></button>
        <button className="console-tool" type="button" aria-label={fullscreenActive ? "Exit full screen" : "Enter full screen"} title="Toggle full screen (Alt+F11)" onClick={onToggleFullscreen}>
          {fullscreenActive ? <Minimize size={14} /> : <Maximize size={14} />}
        </button>
      </div>
    </div>
  );
}
