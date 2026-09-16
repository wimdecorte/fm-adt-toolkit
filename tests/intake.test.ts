import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { intakePath, writeIntake, readIntake } from '../src/gaps/intake.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-intake-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('intakePath', () => {
  it('names one file under gaps/, not one per build', () => {
    const root = tmp();
    expect(intakePath(root)).toBe(path.join(root, 'gaps', 'intake.json'));
  });
});

describe('writeIntake', () => {
  it('records the version, build and date the check ran with', () => {
    const root = tmp();
    writeIntake(root, '0.7.0', '29823677', '2026-09-16');
    expect(JSON.parse(fs.readFileSync(intakePath(root), 'utf8'))).toEqual({
      version: '0.7.0', build: '29823677', checked: '2026-09-16',
    });
  });

  it('creates gaps/ when the evidence root is a bare directory', () => {
    const root = tmp();
    writeIntake(root, '0.7.0', '29823677', '2026-09-16');
    expect(fs.existsSync(intakePath(root))).toBe(true);
  });

  it('replaces the previous build rather than accumulating one file per build', () => {
    const root = tmp();
    writeIntake(root, '0.7.0', '29823677', '2026-09-16');
    writeIntake(root, '0.8.0', '29900001', '2026-10-01');
    expect(readIntake(root)).toEqual({ version: '0.8.0', build: '29900001', checked: '2026-10-01' });
    expect(fs.readdirSync(path.join(root, 'gaps'))).toEqual(['intake.json']);
  });

  it('writes text a human can read in a diff, newline-terminated', () => {
    const root = tmp();
    writeIntake(root, '0.7.0', '29823677', '2026-09-16');
    const text = fs.readFileSync(intakePath(root), 'utf8');
    expect(text).toMatch(/\n$/);
    expect(text.split('\n').length).toBeGreaterThan(3);
  });
});

describe('readIntake', () => {
  it('reads back what writeIntake wrote', () => {
    const root = tmp();
    writeIntake(root, '0.7.0', '29823677', '2026-09-16');
    expect(readIntake(root)).toEqual({ version: '0.7.0', build: '29823677', checked: '2026-09-16' });
  });

  it('is null when no check has ever run against this root', () => {
    expect(readIntake(tmp())).toBeNull();
  });

  it('is null rather than throwing when the file is corrupt', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'gaps'), { recursive: true });
    fs.writeFileSync(intakePath(root), '{ truncated');
    expect(readIntake(root)).toBeNull();
  });
});
