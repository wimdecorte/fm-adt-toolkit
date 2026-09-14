import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegister, saveRegister } from '../src/gaps/register.ts';
import type { SubjectEntry } from '../src/gaps/register.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fm-gaps-register-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function baseEntry(id: string): SubjectEntry {
  return {
    id, op: 'read:layout', kind: 'object:Edit Box',
    probe: { ops: [{ op: 'read:layout', name: 'File Open', detail: true }], select: '**objects[id=21]' },
    attributes: [
      { name: 'top', path: 'Bounds@top', knownFrom: 'SaXML LayoutCatalog Bounds@top', fmKey: 'bounds.top', reported: true },
      { name: 'cond', path: 'ConditionalFormatting', knownFrom: 'SaXML LayoutCatalog ConditionalFormatting', fmKey: null, reported: false },
    ],
    firstSeen: '0.6.0', reportedToClaris: null, lastChecked: null, blocks: [],
  };
}

describe('loadRegister', () => {
  it('loads a valid one-entry register with an attribute that has an fmKey and one that does not', () => {
    const path = join(tempDir(), 'register.json');
    writeFileSync(path, JSON.stringify([baseEntry('a')]));
    const loaded = loadRegister(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].attributes[0].fmKey).toBe('bounds.top');
    expect(loaded[0].attributes[1].fmKey).toBeNull();
  });

  it('refuses a duplicate id', () => {
    const path = join(tempDir(), 'register.json');
    writeFileSync(path, JSON.stringify([baseEntry('a'), baseEntry('a')]));
    expect(() => loadRegister(path)).toThrow(/duplicate/);
  });

  it('refuses a probe with two ops', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.probe.ops = [{ op: 'read:layout', name: 'File Open', detail: true }, { op: 'read:layout', name: 'File Open', detail: true }];
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/exactly one op/);
  });

  it('refuses a create: probe', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.probe.ops = [{ op: 'create:table' }];
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/read-only/);
  });

  it('refuses two attributes with the same name', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.attributes = [entry.attributes[0], { ...entry.attributes[1], name: entry.attributes[0].name }];
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/duplicate attribute/);
  });

  it('loads an attribute-level verifiedOn probe (exactly one read-only op)', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.attributes[0].verifiedOn = { ops: [{ op: 'read:layout', name: 'List', detail: true }], select: 'contents.parts[type=Body]' };
    writeFileSync(path, JSON.stringify([entry]));
    const loaded = loadRegister(path);
    expect(loaded[0].attributes[0].verifiedOn).toEqual(entry.attributes[0].verifiedOn);
  });

  it('refuses a verifiedOn with two ops', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.attributes[0].verifiedOn = {
      ops: [{ op: 'read:layout', name: 'List', detail: true }, { op: 'read:layout', name: 'List', detail: true }],
    };
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/exactly one op/);
  });

  it('refuses a verifiedOn with a non-read op', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.attributes[0].verifiedOn = { ops: [{ op: 'create:table' }] };
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/read-only/);
  });

  it('refuses a blocks row naming an attribute the entry does not have', () => {
    const path = join(tempDir(), 'register.json');
    const entry = baseEntry('a');
    entry.blocks = [{ app: 'inspector', feature: 'x', attribute: 'nonexistent' }];
    writeFileSync(path, JSON.stringify([entry]));
    expect(() => loadRegister(path)).toThrow(/unknown attribute/);
  });

  it('save and reload byte-stable with 2-space JSON and one trailing newline', () => {
    const path = join(tempDir(), 'register.json');
    writeFileSync(path, JSON.stringify([baseEntry('a')]));
    const loaded = loadRegister(path);
    saveRegister(path, loaded);
    const text = readFileSync(path, 'utf8');
    expect(text).toBe(JSON.stringify(loaded, null, 2) + '\n');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    const reloaded = loadRegister(path);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe('a');
  });
});
