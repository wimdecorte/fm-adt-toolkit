import type { AdtOp } from '../types.ts';
import type { Reference, ReferenceInstance } from './enumerate.ts';
import { autoMatch, flattenKeys } from './match.ts';
import type { SubjectEntry } from './register.ts';

function readable(path: string): string {
  return path.replace(/^@/, '').replace(/[/@]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `readable` collapses distinct paths onto the same name: both '/' and '@' become a
 *  space, so 'Options' and '@Options' (the element and its like-named attribute) both
 *  read 'Options', and 'A/B'/'A@B' both read 'A B'. `loadRegister` refuses a register
 *  with two attributes sharing a name, so a collision here would make the whole draft
 *  unloadable. `readable(path)` is tried first; on a collision, the raw path is used
 *  instead -- it is always distinct, since every reference path is by construction --
 *  and, in the rare case that a raw path collides too, a counter is appended. */
function uniqueNames(paths: string[]): Record<string, string> {
  const used = new Set<string>();
  const names: Record<string, string> = {};
  for (const p of paths) {
    let name = readable(p);
    if (used.has(name)) name = p;
    let n = 2;
    while (used.has(name)) { name = `${p} (${n})`; n += 1; }
    used.add(name);
    names[p] = name;
  }
  return names;
}

/** A first draft of a subject entry: every reference path becomes an attribute, matched to
 *  the fm instance's keys by name where the name is unambiguous. Everything unmatched is
 *  `reported: false` with `fmKey: null` until a human either names the key or confirms
 *  the absence. `name` starts as a readable form of the path and is meant to be edited. */
export function draftEntry(reference: Reference, instance: ReferenceInstance, probe: { ops: AdtOp[]; select?: string }, fmInstance: unknown, firstSeen: string): SubjectEntry {
  const paths = reference.attributes.map((a) => a.path);
  const matches = autoMatch(paths, flattenKeys(fmInstance));
  const names = uniqueNames(paths);
  void instance;
  return {
    id: reference.kindId,
    op: reference.op,
    kind: reference.kind,
    probe,
    attributes: paths.map((p) => ({
      name: names[p], path: p, knownFrom: `SaXML ${reference.file} ${p}`, fmKey: matches[p], reported: matches[p] !== null,
    })),
    ignoreKeys: [],
    firstSeen,
    reportedToClaris: null,
    lastChecked: null,
    blocks: [],
  };
}
