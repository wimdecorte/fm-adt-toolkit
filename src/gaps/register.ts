import fs from 'node:fs';
import type { AdtOp } from '../types.ts';
import type { GapCheck } from './checks.ts';

export type GapStatus = 'open' | 'fixed' | 'wontfix';

export interface GapEvidence {
  version: string;
  build: string;
  date: string;
  outcome: 'open' | 'passed' | 'error';
  /** The exact command line the checker ran, temp paths included. */
  command: string;
  /** The exact ops written to the ops file for this entry. */
  ops: AdtOp[];
  /** fm's response verbatim: every stdout line and every stderr line as parsed
   *  JSON, in order, plus the exit code. Never summarised or trimmed. */
  response: { stdout: unknown[]; stderr: unknown[]; exitCode: number };
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
    if (!e.probe.ops[0].op.startsWith('read:')) throw new Error(`gap ${e.id}: probe op must be a read`);
  }
  return entries;
}

export function saveRegister(path: string, entries: GapEntry[]): void {
  fs.writeFileSync(path, JSON.stringify(entries, null, 2) + '\n');
}
