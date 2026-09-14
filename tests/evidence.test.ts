import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { probeId, writeEvidence, readEvidence, evidencePath } from '../src/gaps/evidence.ts';

describe('evidence store', () => {
  it('derives a stable id from the op regardless of key order', () => {
    expect(probeId({ op: 'read:layout', name: 'File Open', detail: true })).toBe(probeId({ detail: true, name: 'File Open', op: 'read:layout' }));
    expect(probeId({ op: 'read:layout', name: 'File Open', detail: true })).toMatch(/^[0-9a-f]{8}$/);
    expect(probeId({ op: 'read:layout', name: 'Other', detail: true })).not.toBe(probeId({ op: 'read:layout', name: 'File Open', detail: true }));
  });
  it('keys the evidence directory on version and build', () => {
    const op = { op: 'read:table' };
    expect(evidencePath('0.6.0', '29816214', op)).toBe(`gaps/evidence/0.6.0-29816214/${probeId(op)}.ndjson`);
    expect(evidencePath('0.6.0', '', op)).toBe(`gaps/evidence/0.6.0/${probeId(op)}.ndjson`);
  });
  it('writes one NDJSON file per probe and reads it back verbatim', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-ev-'));
    const op = { op: 'read:table' };
    const rel = writeEvidence(root, '0.6.0', '29816214', op, { command: 'fm --file=x', batch: { size: 3, position: 1 }, stdout: [{ op: 'read:table', status: 'ok', result: { kind: 'table' } }], stderr: [{ type: 'summary', total: 3 }], exitCode: 0 });
    expect(rel).toBe(`gaps/evidence/0.6.0-29816214/${probeId(op)}.ndjson`);
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'meta', command: 'fm --file=x', version: '0.6.0', build: '29816214', exitCode: 0, op });
    expect(lines[1]).toEqual({ type: 'stdout', line: { op: 'read:table', status: 'ok', result: { kind: 'table' } } });
    expect(lines[2]).toEqual({ type: 'stderr', line: { type: 'summary', total: 3 } });
    const back = readEvidence(root, rel);
    expect(back.stdout).toHaveLength(1); expect(back.stderr).toHaveLength(1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
