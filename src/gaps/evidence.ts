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

/** The directory one fm build's evidence lives in: `<version>-<build>`. Two builds of the
 *  same version answer differently often enough that keeping both is the point — the
 *  build-to-build key is what lets a check diff this run's keys against the previous
 *  build's. A build-less caller (a test, an fm that reports no build) falls back to the
 *  bare version. */
export function evidenceDir(version: string, build: string): string {
  return build ? `${version}-${build}` : version;
}

export function evidencePath(version: string, build: string, op: AdtOp): string {
  return path.posix.join('gaps', 'evidence', evidenceDir(version, build), probeId(op) + '.ndjson');
}

/** One file per probe per fm version: a meta line, then every stdout line, then every
 *  stderr line, all verbatim. Overwritten on every check of that version. */
export function writeEvidence(
  root: string, version: string, build: string, op: AdtOp,
  data: { command: string; batch: { size: number; position: number }; stdout: unknown[]; stderr: unknown[]; exitCode: number; date?: string },
): string {
  const rel = evidencePath(version, build, op);
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const lines = [
    JSON.stringify({ type: 'meta', op, version, build, date: data.date ?? '', command: data.command, batch: data.batch, exitCode: data.exitCode }),
    ...data.stdout.map((line) => JSON.stringify({ type: 'stdout', line })),
    ...data.stderr.map((line) => JSON.stringify({ type: 'stderr', line })),
  ];
  fs.writeFileSync(abs, lines.join('\n') + '\n');
  return rel;
}

/** The newest evidence directory that is not this run's own, or null when this is the
 *  first build recorded. Directories are named `<version>-<build>` and sort in build
 *  order within a version, so the greatest name below the current one is "the previous
 *  build" -- which is what the key diff compares against. */
export function previousEvidenceDir(root: string, version: string, build: string): string | null {
  const dir = path.join(root, 'gaps', 'evidence');
  if (!fs.existsSync(dir)) return null;
  const current = evidenceDir(version, build);
  const others = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== current)
    .map((d) => d.name)
    .sort();
  return others.length ? others[others.length - 1] : null;
}

export function readEvidence(root: string, rel: string): { meta: Record<string, unknown>; stdout: unknown[]; stderr: unknown[] } {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; line?: unknown } & Record<string, unknown>);
  const meta = lines.find((l) => l.type === 'meta') ?? {};
  return { meta, stdout: lines.filter((l) => l.type === 'stdout').map((l) => l.line), stderr: lines.filter((l) => l.type === 'stderr').map((l) => l.line) };
}
