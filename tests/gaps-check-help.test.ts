import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { captureHelpSince, helpSurfaceSince } from '../src/gaps/check.ts';
import { writeHelpSnapshot } from '../src/gaps/help-snapshot.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-help-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fakeCli(dir: string, stdout: string): string {
  const p = path.join(dir, 'fake-fm.mjs');
  fs.writeFileSync(p, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

/** A fake CLI whose `help` subcommand exits non-zero, the way a real `fm` older than the
 *  `help --json` support (or one hitting an unrelated crash) would. */
function fakeCliThatFailsHelp(dir: string): string {
  const p = path.join(dir, 'fake-fm-fails.mjs');
  fs.writeFileSync(p, `#!/usr/bin/env node\nprocess.stderr.write('help: unknown flag --json\\n');\nprocess.exit(1);\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

const helpJson = (nodes: unknown[]): string => JSON.stringify({ type: 'help', all: true, total: nodes.length, nodes });

describe('captureHelpSince', () => {
  it('captures and writes the current build\'s snapshot, returning null when there is no previous one', async () => {
    const root = tmp();
    const cli = fakeCli(root, helpJson([{ path: ['account'], kind: 'item' }]));
    const result = await captureHelpSince(cli, root, '0.7.0', '1');
    expect(result).toBeNull();
    expect(fs.existsSync(path.join(root, 'gaps', 'help', '0.7.0-1.json'))).toBe(true);
  });

  it('renders the diff against the previously stored build, labelling both sides', async () => {
    const root = tmp();
    writeHelpSnapshot(root, '0.6.0', '9', helpJson([{ path: ['account'], kind: 'item' }]));
    const cli = fakeCli(root, helpJson([
      { path: ['account'], kind: 'item' },
      { path: ['theme'], kind: 'item' },
    ]));
    const result = await captureHelpSince(cli, root, '0.7.0', '1');
    expect(result).not.toBeNull();
    expect(result!.prevLabel).toBe('0.6.0-9');
    expect(result!.text).toContain('0.6.0-9 -> 0.7.0-1');
    expect(result!.text).toContain('+ catalog theme');
  });

  it('never rejects when the CLI\'s help subcommand fails: warns and writes nothing', async () => {
    const root = tmp();
    const cli = fakeCliThatFailsHelp(root);
    const warnings: string[] = [];
    const result = await captureHelpSince(cli, root, '0.7.0', '1', (line) => warnings.push(line));
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^help snapshot skipped: /);
    expect(fs.existsSync(path.join(root, 'gaps', 'help', '0.7.0-1.json'))).toBe(false);
  });

  it('still writes the current snapshot when the previous one is corrupted, and warns instead of throwing', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'gaps', 'help'), { recursive: true });
    fs.writeFileSync(path.join(root, 'gaps', 'help', '0.6.0-9.json'), 'not valid json {{{');
    const cli = fakeCli(root, helpJson([{ path: ['account'], kind: 'item' }]));
    const warnings: string[] = [];
    const result = await captureHelpSince(cli, root, '0.7.0', '1', (line) => warnings.push(line));
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^help snapshot skipped: /);
    expect(fs.existsSync(path.join(root, 'gaps', 'help', '0.7.0-1.json'))).toBe(true);
  });
});

describe('helpSurfaceSince', () => {
  it('returns null when no snapshot has ever been stored for this build', () => {
    const root = tmp();
    expect(helpSurfaceSince(root, '0.7.0', '1')).toBeNull();
  });

  it('reads the already-stored current snapshot and diffs it against the previous one, without capturing anything new', () => {
    const root = tmp();
    writeHelpSnapshot(root, '0.6.0', '9', helpJson([{ path: ['account'], kind: 'item' }]));
    writeHelpSnapshot(root, '0.7.0', '1', helpJson([
      { path: ['account'], kind: 'item' },
      { path: ['theme'], kind: 'item' },
    ]));
    const result = helpSurfaceSince(root, '0.7.0', '1');
    expect(result!.prevLabel).toBe('0.6.0-9');
    expect(result!.text).toContain('+ catalog theme');
  });
});
