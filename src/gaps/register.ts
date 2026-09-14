import fs from 'node:fs';
import type { AdtOp } from '../types.ts';
import { isReadOnlyOp } from '../read-only.ts';

/** A read-only probe: exactly one op, and an optional selector into its result. Shared
 *  shape for an entry's own probe and an attribute's `verifiedOn` override. */
export interface Probe {
  ops: AdtOp[];
  select?: string;
}

export interface Attribute {
  name: string;               // human name, defaults to the SaXML path until a human renames it
  path: string;               // SaXML path from the reference
  knownFrom: string;          // 'SaXML <file> <path>' by default; humans add 'Inspector > ...'
  fmKey: string | null;       // dotted key on the selected instance
  reported: boolean;
  wontfix?: string;           // reason this attribute is not expected from fm (export artifact, deprecated, ...)
  /** What the fmKey's value must say for this attribute to count as reported, for a key
   *  whose presence is not the answer. `contains` names one member of an array value: fm
   *  reports a layout's flags as one `flags.set` list, so every bit row shares that key and
   *  only membership tells them apart. Without it the key's presence alone is the test. */
  expect?: { contains: string };
  /** Evaluate this attribute on the instance selected from a DIFFERENT probe than the
   *  entry's own, instead of the entry's probe instance — for a fact fm reports, but not
   *  on the instance the entry happens to probe (e.g. a menu item whose action carries no
   *  value on this row, but does on another item of the same menu). The op joins the
   *  checker's distinct-probe batch like any other; validated the same as `probe` below. */
  verifiedOn?: Probe;
}

export interface SubjectEvidence {
  version: string; build: string; date: string;
  command: string;
  batch: { size: number; position: number };
  evidence: string;                                  // relative path of the evidence file
  attributes: Record<string, 'reported' | 'absent' | 'error'>;
  /** Evidence path per attribute name, present only for an attribute with `verifiedOn`
   *  whose evidence differs from this entry's own `evidence` above. */
  attributeEvidence?: Record<string, string>;
  /** Reason per attribute name, present only for an attribute with `verifiedOn` whose
   *  probe or selector failed — the attribute's own outcome is `error`, but (unlike the
   *  entry-level `reason` below) it does not mark the whole entry errored. */
  attributeReasons?: Record<string, string>;
  unexplainedKeys: string[];                         // top-level keys on the instance no attribute claims and not in ignoreKeys
  /** The same question asked at every depth (3 levels, array markers normalised away):
   *  keys no attribute claims, minus `ignoreKeys`, minus everything under a container
   *  another entry's selector owns on the same probe. A gap closed by a NESTED key --
   *  `contents.parts`, `options.validation.*`, a theme's styles -- can only show up here. */
  unexplainedNestedKeys?: string[];
  reason?: string;                                   // set when the probe or the selector failed
}

export interface SubjectEntry {
  id: string; op: string; kind: string;
  probe: Probe;
  /** The `(type, control)` pair the reference export says this kind's instances carry, for
   *  a layout-object kind whose selector addresses one object among hundreds. `check`
   *  refuses to score an instance that does not match it. */
  fmType?: { type: string; control: string | null };
  attributes: Attribute[];
  ignoreKeys?: string[];                             // instance keys reviewed and declared not attributes (e.g. 'kind', 'id')
  /** The one probe failure the owner accepts for this entry: a `lastChecked.reason`
   *  prefix, or the bare fm error code of a refused probe. An errored entry it matches is
   *  listed apart and does not raise the exit code; the same entry succeeding does, since
   *  that is the gap closing. */
  expectedError?: string;
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
      if (a.verifiedOn) {
        if (a.verifiedOn.ops.length !== 1) throw new Error(`subject ${e.id}: attribute ${a.name} verifiedOn is exactly one op`);
        if (!isReadOnlyOp(a.verifiedOn.ops[0])) throw new Error(`subject ${e.id}: attribute ${a.name} verifiedOn op must be read-only (read:*, evaluate:calculation, validate:calculation)`);
      }
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
