import assert from "node:assert/strict";
import test from "node:test";
import { updateHeldKey } from "../src/keyboardState.ts";

test("repeated Windows key-down events produce one press and one release", () => {
  const held = new Set<string>();
  const changes = [true, true, true, false, false].map((down) => updateHeldKey(held, "KeyA", down));
  assert.deepEqual(changes, [true, false, false, true, false]);
  assert.equal(held.size, 0);
});

test("releasing one key keeps other held keys and modifiers", () => {
  const held = new Set<string>();
  assert.equal(updateHeldKey(held, "ShiftLeft", true), true);
  assert.equal(updateHeldKey(held, "KeyA", true), true);
  assert.equal(updateHeldKey(held, "KeyA", false), true);
  assert.deepEqual([...held], ["ShiftLeft"]);
  assert.equal(updateHeldKey(held, "ShiftLeft", false), true);
  assert.equal(held.size, 0);
});
