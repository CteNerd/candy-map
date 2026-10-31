/** Thin wrapper so handlers/tests don't import `node:crypto` directly. */
export function generateId(): string {
  return crypto.randomUUID();
}
