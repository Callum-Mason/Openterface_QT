export type MouseReportCommand = "send_mouse_report" | "send_relative_mouse_report";
export type MousePayload = Record<string, number>;

// Absolute positions replace one another. Relative movement is a distance and
// must be added, or motion disappears whenever the serial queue is busy.
export function mergeMouseMoves(command: MouseReportCommand, previous: MousePayload, next: MousePayload): MousePayload | null {
  if (previous.buttons !== next.buttons) return null;
  if (command === "send_mouse_report") return next;
  return { ...next, dx: previous.dx + next.dx, dy: previous.dy + next.dy };
}

export function splitRelativeMove(payload: MousePayload): { report: MousePayload; remaining: MousePayload } {
  const dx = Math.max(-127, Math.min(127, payload.dx));
  const dy = Math.max(-127, Math.min(127, payload.dy));
  return {
    report: { ...payload, dx, dy },
    remaining: { ...payload, dx: payload.dx - dx, dy: payload.dy - dy },
  };
}

// Keep movement below the 9600-baud report rate, including a final trailing
// update, while preserving the net distance from all relative events.
export class MouseMoveLimiter {
  private pending: { command: MouseReportCommand; payload: MousePayload } | null = null;
  private timer: number | null = null;
  private lastSent = -Infinity;
  private readonly send: (command: MouseReportCommand, payload: MousePayload) => void;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delay: number) => number;
  private readonly cancelTimer: (timer: number) => void;

  constructor(
    send: (command: MouseReportCommand, payload: MousePayload) => void,
    now = () => performance.now(),
    schedule = (callback: () => void, delay: number) => window.setTimeout(callback, delay),
    cancelTimer = (timer: number) => window.clearTimeout(timer),
  ) {
    this.send = send;
    this.now = now;
    this.schedule = schedule;
    this.cancelTimer = cancelTimer;
  }

  push(command: MouseReportCommand, payload: MousePayload) {
    if (this.pending) {
      const merged = this.pending.command === command ? mergeMouseMoves(command, this.pending.payload, payload) : null;
      if (merged) this.pending.payload = merged;
      else { this.flush(); this.pending = { command, payload }; }
    } else {
      this.pending = { command, payload };
    }
    if (this.timer !== null) return;
    const delay = Math.max(0, 16 - (this.now() - this.lastSent));
    if (delay === 0) this.flush();
    else this.timer = this.schedule(() => { this.timer = null; this.flush(); }, delay);
  }

  flush() {
    if (this.timer !== null) this.cancelTimer(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const { command, payload } = this.pending;
    this.pending = null;
    this.lastSent = this.now();
    this.send(command, payload);
  }

  cancel() {
    if (this.timer !== null) this.cancelTimer(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
