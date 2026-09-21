import type { AdtOp } from './types.ts';

/** The verbs fm's own help declares do not write. `read` and `search` are the two
 *  that answer questions: a search's help is explicit -- "NOTHING HERE WRITES. No
 *  scanner opens a catalog for writing, nothing joins the commit lifecycle, no
 *  result reports `dry-run`, and `--dry-run` does not change what this op does."
 *  `evaluate` and `validate` are the calculation verbs, whose help says a file's
 *  bytes are identical after evaluating -- including a formula that assigns a
 *  global.
 *
 *  Classified by VERB rather than by name prefix, and that is the point. The
 *  previous rule was `name.startsWith('read:')`, which encoded "a read-only op is
 *  spelled read:" -- true until fm 0.8.0 added nine `search:*` ops, every one of
 *  which this guard then refused. A tool built on this guard silently lost a
 *  capability the CLI had gained. Verb is stable, there are eight of them, and fm
 *  names every one of its 102 ops `verb:noun`. */
export const READ_ONLY_VERBS: ReadonlySet<string> = new Set(['read', 'search', 'evaluate', 'validate']);

/** The verbs that change a file. Kept explicitly, and not as "everything else",
 *  so that a verb fm adds later is in NEITHER set and fails the classification
 *  test rather than defaulting into one of them. */
export const WRITE_VERBS: ReadonlySet<string> = new Set(['create', 'delete', 'duplicate', 'update']);

/** Kept for callers that referenced it; the verb sets are the classification now. */
export const READ_ONLY_CALCULATION_OPS = new Set(['evaluate:calculation', 'validate:calculation']);

export function isReadOnlyOp(op: unknown): boolean {
  const name = (op as { op?: unknown })?.op;
  if (typeof name !== 'string') return false;
  const at = name.indexOf(':');
  if (at <= 0) return false;
  return READ_ONLY_VERBS.has(name.slice(0, at));
}

/** The one guard every read-only entry point shares (the inspector's /api/read and
 *  fm-gaps check): throws naming the first op that could change a file. Browser safe. */
export function assertReadOnly(ops: AdtOp[]): void {
  for (const op of ops) {
    if (!isReadOnlyOp(op)) {
      throw new Error(
        `op ${JSON.stringify((op as { op?: unknown })?.op)} is not read-only; only ${[...READ_ONLY_VERBS].sort().map((v) => `${v}:*`).join(', ')} may be sent`,
      );
    }
  }
}
