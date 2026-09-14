import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AdtOp } from '../types.ts';

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}

export function probeId(op: AdtOp): string {
  return createHash('sha1').update(canonical(op)).digest('hex').slice(0, 8);
}

export function evidencePath(version: string, op: AdtOp): string {
  return path.posix.join('gaps', 'evidence', version, probeId(op) + '.ndjson');
}

/** One file per probe per fm version: a meta line, then every stdout line, then every
 *  stderr line, all verbatim. Overwritten on every check of that version. */
export function writeEvidence(
  root: string, version: string, op: AdtOp,
  data: { command: string; batch: { size: number; position: number }; stdout: unknown[]; stderr: unknown[]; exitCode: number; build?: string; date?: string },
): string {
  const rel = evidencePath(version, op);
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const lines = [
    JSON.stringify({ type: 'meta', op, version, build: data.build ?? '', date: data.date ?? '', command: data.command, batch: data.batch, exitCode: data.exitCode }),
    ...data.stdout.map((line) => JSON.stringify({ type: 'stdout', line })),
    ...data.stderr.map((line) => JSON.stringify({ type: 'stderr', line })),
  ];
  fs.writeFileSync(abs, lines.join('\n') + '\n');
  return rel;
}

export function readEvidence(root: string, rel: string): { meta: Record<string, unknown>; stdout: unknown[]; stderr: unknown[] } {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; line?: unknown } & Record<string, unknown>);
  const meta = lines.find((l) => l.type === 'meta') ?? {};
  return { meta, stdout: lines.filter((l) => l.type === 'stdout').map((l) => l.line), stderr: lines.filter((l) => l.type === 'stderr').map((l) => l.line) };
}
