import fs from 'node:fs';
import type { AdtOp } from '../types.ts';
import { isReadOnlyOp } from '../read-only.ts';
import type { GapCheck } from './checks.ts';

export type GapStatus = 'open' | 'fixed' | 'wontfix';

export interface GapEvidence {
  version: string;
  build: string;
  date: string;
  outcome: 'open' | 'passed' | 'error';
  /** Set only when `outcome` is 'error' for a reason the checker itself
   *  detected (as opposed to fm refusing the op), e.g. a result/probe op
   *  mismatch at this entry's position in the batch. */
  reason?: string;
  /** The exact command line the checker ran, temp paths included. */
  command: string;
  /** The exact ops written to the ops file for this entry. */
  ops: AdtOp[];
  /** fm's response verbatim: every stdout line and every stderr line as parsed
   *  JSON, in order, plus the exit code. Never summarised or trimmed. */
  response: { stdout: unknown[]; stderr: unknown[]; exitCode: number };
  /** Where this entry's probe sat in the one fm invocation that ran every
   *  probe together. `position` is 0-based. The summary and exit code in
   *  `response` belong to the whole batch, not to this one op. */
  batch: { size: number; position: number };
}

export interface GapEntry {
  id: string;
  title: string;
  /** `catalog:<name>`, `step:<step name>`, or `cli`. */
  area: string;
  description: string;
  status: GapStatus;
  firstSeen: string;
  lastChecked: GapEvidence | null;
  reportedToClaris: string | null;
  blocks: Array<{ app: string; feature: string; where?: string }>;
  probe: { target: 'reference'; ops: AdtOp[]; check: GapCheck };
}

export function loadRegister(path: string): GapEntry[] {
  const entries = JSON.parse(fs.readFileSync(path, 'utf8')) as GapEntry[];
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`duplicate gap id ${e.id}`);
    ids.add(e.id);
    if (e.probe.ops.length !== 1) throw new Error(`gap ${e.id}: a probe is exactly one op`);
    if (!isReadOnlyOp(e.probe.ops[0])) throw new Error(`gap ${e.id}: probe op must be a read-only op (read:*, evaluate:calculation, validate:calculation)`);
  }
  return entries;
}

export function saveRegister(path: string, entries: GapEntry[]): void {
  fs.writeFileSync(path, JSON.stringify(entries, null, 2) + '\n');
}
