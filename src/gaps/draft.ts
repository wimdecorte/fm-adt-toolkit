import type { AdtOp } from '../types.ts';
import type { Reference, ReferenceInstance } from './enumerate.ts';
import { autoMatch, flattenKeys } from './match.ts';
import type { SubjectEntry } from './register.ts';

function readable(path: string): string {
  return path.replace(/^@/, '').replace(/[/@]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A first draft of a subject entry: every reference path becomes an attribute, matched to
 *  the fm instance's keys by name where the name is unambiguous. Everything unmatched is
 *  `reported: false` with `fmKey: null` until a human either names the key or confirms
 *  the absence. `name` starts as a readable form of the path and is meant to be edited. */
export function draftEntry(reference: Reference, instance: ReferenceInstance, probe: { ops: AdtOp[]; select?: string }, fmInstance: unknown, firstSeen: string): SubjectEntry {
  const paths = reference.attributes.map((a) => a.path);
  const matches = autoMatch(paths, flattenKeys(fmInstance));
  void instance;
  return {
    id: reference.kindId,
    op: reference.op,
    kind: reference.kind,
    probe,
    attributes: paths.map((p) => ({
      name: readable(p), path: p, knownFrom: `SaXML ${reference.file} ${p}`, fmKey: matches[p], reported: matches[p] !== null,
    })),
    ignoreKeys: [],
    firstSeen,
    reportedToClaris: null,
    lastChecked: null,
    blocks: [],
  };
}
