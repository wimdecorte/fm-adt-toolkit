import type { AdtOp } from './types.ts';

/** The two calculation verbs fm's own help declares are not writes: "a file's bytes
 *  are identical after evaluating -- including a formula that assigns a global".
 *  Every `read:*` op is read-only by construction. Nothing else is. */
export const READ_ONLY_CALCULATION_OPS: ReadonlySet<string> = new Set([
  'evaluate:calculation',
  'validate:calculation',
]);

export function isReadOnlyOp(op: AdtOp): boolean {
  const name = op?.op;
  if (typeof name !== 'string') return false;
  return name.startsWith('read:') || READ_ONLY_CALCULATION_OPS.has(name);
}

/** The one guard every read-only entry point shares (the inspector's /api/read and
 *  fm-gaps check): throws naming the first op that could change a file. Browser safe. */
export function assertReadOnly(ops: AdtOp[]): void {
  for (const op of ops) {
    if (!isReadOnlyOp(op)) {
      throw new Error(
        `op ${JSON.stringify(op?.op)} is not read-only; only read:*, evaluate:calculation and validate:calculation may be sent`,
      );
    }
  }
}
