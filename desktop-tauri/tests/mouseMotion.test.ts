import assert from "node:assert/strict";
import test from "node:test";
import { mergeMouseMoves, splitRelativeMove } from "../src/mouseMotion.ts";

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

test("a change in direction or button state does not merge movement", () => {
  const previous = { dx: 10, dy: 0, buttons: 1, wheel: 0 };
  assert.equal(mergeMouseMoves("send_relative_mouse_report", previous, { ...previous, dx: -5 }), null);
  assert.equal(mergeMouseMoves("send_relative_mouse_report", previous, { ...previous, buttons: 0 }), null);
  assert.deepEqual(mergeMouseMoves("send_mouse_report", { x: 1, y: 2, buttons: 0 }, { x: 8, y: 9, buttons: 0 }), { x: 8, y: 9, buttons: 0 });
});
