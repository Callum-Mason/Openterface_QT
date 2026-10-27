// Return true only when the target's held-key state actually changes.
export function updateHeldKey(held: Set<string>, code: string, down: boolean): boolean {
  if (down) {
    if (held.has(code)) return false;
    held.add(code);
    return true;
  }
  return held.delete(code);
}
