import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegister, saveRegister } from '../src/gaps/register.ts';
import type { GapEntry } from '../src/gaps/register.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fm-gaps-register-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function baseEntry(id: string): GapEntry {
  return {
    id, title: id, area: 'cli', description: '', status: 'open', firstSeen: '0.6.0',
    lastChecked: null, reportedToClaris: null, blocks: [],
    probe: { target: 'reference', ops: [{ op: 'read:file' }], check: { kind: 'opAccepted' } },
  };
}

describe('loadRegister', () => {
  it('refuses a duplicate id', () => {
    const path = join(tempDir(), 'register.json');
    writeFileSync(path, JSON.stringify([baseEntry('a'), baseEntry('a')]));
    expect(() => loadRegister(path)).toThrow(/duplicate gap id/);
  });

  it('refuses a probe with two ops', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.probe.ops = [{ op: 'read:file' }, { op: 'read:file' }];
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/exactly one op/);
  });

  it('refuses a probe op that is not a read', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.probe.ops = [{ op: 'create:table' }];
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/must be a read/);
  });

  it('loads a valid one-entry register, and saveRegister round-trips it', () => {
    const path = join(tempDir(), 'register.json');
    writeFileSync(path, JSON.stringify([baseEntry('a')]));
    const loaded = loadRegister(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('a');

    saveRegister(path, loaded);
    const text = readFileSync(path, 'utf8');
    // 2-space-indented JSON ending in exactly one trailing newline.
    expect(text).toBe(JSON.stringify(loaded, null, 2) + '\n');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);

    const reloaded = loadRegister(path);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe('a');
  });
});

describe('loadRegister accepts the calculation verbs as read-only probes', () => {
  it('loads an evaluate:calculation probe', () => {
    const file = join(tempDir(), 'register.json');
    writeFileSync(file, JSON.stringify([{
      id: 'x', title: 'x', area: 'cli', description: '', status: 'open', firstSeen: '0.6.0',
      lastChecked: null, reportedToClaris: null, blocks: [],
      probe: { target: 'reference', ops: [{ op: 'evaluate:calculation', calculation: 'Get ( EncryptionState )' }], check: { kind: 'valueEquals', path: 'value', value: '1' } },
    }]));
    expect(loadRegister(file)).toHaveLength(1);
  });
});
