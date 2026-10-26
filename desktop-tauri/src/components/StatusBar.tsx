import { AudioLines, Keyboard, MousePointer2 } from "lucide-react";
import type { MouseMode } from "../types";

type StatusBarProps = {
  connected: boolean;
  controllerMode: number;
  mouseMode: MouseMode;
  audioStarting: boolean;
  audioEnabled: boolean;
  audioVolume: number;
};

export function StatusBar({ connected, controllerMode, mouseMode, audioStarting, audioEnabled, audioVolume }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <span className="statusbar-item"><span className={`state-dot ${connected ? "on" : ""}`} aria-hidden="true" />{connected ? "Session active" : "Session idle"}</span>
        {controllerMode !== 1 && controllerMode !== 3 && <span className="statusbar-item"><MousePointer2 size={12} />{mouseMode === "relative" ? "Relative mouse" : "Absolute mouse"}</span>}
        {controllerMode !== 3 && <span className="statusbar-item"><Keyboard size={12} />Keyboard</span>}
      </div>
      <div className={`statusbar-group ${audioEnabled ? "audio-active" : ""}`}>
        <span className="statusbar-item"><AudioLines size={12} />{audioStarting ? "Audio starting" : audioEnabled ? `Audio live (${audioVolume}%)` : "Audio off"}</span>
      </div>
    </footer>
  );
}
