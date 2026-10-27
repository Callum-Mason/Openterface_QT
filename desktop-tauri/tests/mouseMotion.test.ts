import assert from "node:assert/strict";
import test from "node:test";
import { mergeMouseMoves, MouseMoveLimiter, splitRelativeMove } from "../src/mouseMotion.ts";

test("queued relative movement preserves the whole distance across HID reports", () => {
  let pending = mergeMouseMoves("send_relative_mouse_report",
    { dx: 110, dy: -80, buttons: 1, wheel: 0 },
    { dx: 210, dy: -90, buttons: 1, wheel: 0 });
  assert.ok(pending);
  const reports = [];
  while (pending.dx !== 0 || pending.dy !== 0) {
    const step = splitRelativeMove(pending);
    reports.push(step.report);
    pending = step.remaining;
  }
  assert.equal(reports.reduce((sum, report) => sum + report.dx, 0), 320);
  assert.equal(reports.reduce((sum, report) => sum + report.dy, 0), -170);
  assert.ok(reports.every((report) => Math.abs(report.dx) <= 127 && Math.abs(report.dy) <= 127 && report.buttons === 1));
});

test("relative movement combines direction changes but does not cross button states", () => {
  const previous = { dx: 10, dy: 0, buttons: 1, wheel: 0 };
  assert.deepEqual(mergeMouseMoves("send_relative_mouse_report", previous, { ...previous, dx: -5 }), { ...previous, dx: 5 });
  assert.equal(mergeMouseMoves("send_relative_mouse_report", previous, { ...previous, buttons: 0 }), null);
  assert.deepEqual(mergeMouseMoves("send_mouse_report", { x: 1, y: 2, buttons: 0 }, { x: 8, y: 9, buttons: 0 }), { x: 8, y: 9, buttons: 0 });
});

test("movement bursts are rate limited and retain their final displacement", () => {
  let now = 0;
  let scheduled: (() => void) | null = null;
  const reports: Array<{ command: string; payload: Record<string, number> }> = [];
  const limiter = new MouseMoveLimiter(
    (command, payload) => reports.push({ command, payload }),
    () => now,
    (callback) => { scheduled = callback; return 1; },
    () => { scheduled = null; },
  );
  limiter.push("send_relative_mouse_report", { dx: 10, dy: 0, buttons: 0, wheel: 0 });
  now = 5;
  limiter.push("send_relative_mouse_report", { dx: 20, dy: 3, buttons: 0, wheel: 0 });
  now = 10;
  limiter.push("send_relative_mouse_report", { dx: -5, dy: 2, buttons: 0, wheel: 0 });
  assert.equal(reports.length, 1);
  now = 16;
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.deepEqual(reports[1].payload, { dx: 15, dy: 5, buttons: 0, wheel: 0 });

  now = 17;
  limiter.push("send_mouse_report", { x: 1, y: 2, buttons: 0 });
  limiter.push("send_mouse_report", { x: 8, y: 9, buttons: 0 });
  limiter.flush(); // A button transition flushes movement before its report.
  assert.deepEqual(reports[2].payload, { x: 8, y: 9, buttons: 0 });
  assert.equal(scheduled, null);
});
