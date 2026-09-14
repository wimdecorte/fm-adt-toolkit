import fs from 'node:fs';
import type { AdtOp } from '../types.ts';
import { isReadOnlyOp } from '../read-only.ts';

export interface Attribute {
  name: string;               // human name, defaults to the SaXML path until a human renames it
  path: string;               // SaXML path from the reference
  knownFrom: string;          // 'SaXML <file> <path>' by default; humans add 'Inspector > ...'
  fmKey: string | null;       // dotted key on the selected instance
  reported: boolean;
  wontfix?: string;           // reason this attribute is not expected from fm (export artifact, deprecated, ...)
}

export interface SubjectEvidence {
  version: string; build: string; date: string;
  command: string;
  batch: { size: number; position: number };
  evidence: string;                                  // relative path of the evidence file
  attributes: Record<string, 'reported' | 'absent' | 'error'>;
  unexplainedKeys: string[];                         // keys on the instance no attribute claims and not in ignoreKeys
  reason?: string;                                   // set when the probe or the selector failed
}

export interface SubjectEntry {
  id: string; op: string; kind: string;
  probe: { ops: AdtOp[]; select?: string };
  attributes: Attribute[];
  ignoreKeys?: string[];                             // instance keys reviewed and declared not attributes (e.g. 'kind', 'id')
  firstSeen: string;
  reportedToClaris: string | null;
  lastChecked: SubjectEvidence | null;
  blocks: Array<{ app: string; feature: string; attribute: string; where?: string }>;
}

export function loadRegister(path: string): SubjectEntry[] {
  const entries = JSON.parse(fs.readFileSync(path, 'utf8')) as SubjectEntry[];
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`duplicate subject id ${e.id}`);
    ids.add(e.id);
    if (e.probe.ops.length !== 1) throw new Error(`subject ${e.id}: a probe is exactly one op`);
    if (!isReadOnlyOp(e.probe.ops[0])) throw new Error(`subject ${e.id}: probe op must be read-only (read:*, evaluate:calculation, validate:calculation)`);
    const names = new Set<string>();
    for (const a of e.attributes) {
      if (names.has(a.name)) throw new Error(`subject ${e.id}: duplicate attribute name ${a.name}`);
      names.add(a.name);
    }
    for (const b of e.blocks ?? []) {
      if (!names.has(b.attribute)) throw new Error(`subject ${e.id}: blocks row names unknown attribute ${b.attribute}`);
    }
  }
  return entries;
}

export function saveRegister(path: string, entries: SubjectEntry[]): void {
  fs.writeFileSync(path, JSON.stringify(entries, null, 2) + '\n');
}
