export type MouseReportCommand = "send_mouse_report" | "send_relative_mouse_report";
export type MousePayload = Record<string, number>;

// Absolute positions replace one another. Relative movement is a distance and
// must be added, or motion disappears whenever the serial queue is busy.
export function mergeMouseMoves(command: MouseReportCommand, previous: MousePayload, next: MousePayload): MousePayload | null {
  if (previous.buttons !== next.buttons) return null;
  if (command === "send_mouse_report") return next;
  const sameDirection = (a: number, b: number) => a === 0 || b === 0 || Math.sign(a) === Math.sign(b);
  if (!sameDirection(previous.dx, next.dx) || !sameDirection(previous.dy, next.dy)) return null;
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
