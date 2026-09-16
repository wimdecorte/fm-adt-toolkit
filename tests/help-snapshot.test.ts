import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureHelp, helpSnapshotPath, writeHelpSnapshot, previousHelpSnapshot } from '../src/gaps/help-snapshot.ts';

/** A tiny fake `fm` that echoes its argv as JSON, so `captureHelp` can be exercised without
 *  the real CLI. Written fresh per test into a temp dir, executable like the real binary. */
function fakeCli(dir: string, stdout: string): string {
  const p = path.join(dir, 'fake-fm.mjs');
  fs.writeFileSync(p, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-help-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('captureHelp', () => {
  it('runs `help --json --all` on the given CLI and returns stdout verbatim', async () => {
    const dir = tmp();
    const cli = path.join(dir, 'echo-argv.mjs');
    fs.writeFileSync(cli, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    fs.chmodSync(cli, 0o755);
    const out = await captureHelp(cli);
    expect(JSON.parse(out)).toEqual(['help', '--json', '--all']);
  });

  it('returns exactly what the CLI printed, unparsed', async () => {
    const dir = tmp();
    const cli = fakeCli(dir, '{"type":"help","nodes":[]}');
    const out = await captureHelp(cli);
    expect(out).toBe('{"type":"help","nodes":[]}');
  });
});

describe('helpSnapshotPath', () => {
  it('names the file <root>/gaps/help/<version>-<build>.json, mirroring evidenceDir', () => {
    expect(helpSnapshotPath('/root', '0.7.0', '29823677')).toBe(path.join('/root', 'gaps', 'help', '0.7.0-29823677.json'));
  });

  it('falls back to the bare version when there is no build', () => {
    expect(helpSnapshotPath('/root', '0.7.0', '')).toBe(path.join('/root', 'gaps', 'help', '0.7.0.json'));
  });
});

describe('writeHelpSnapshot', () => {
  it('writes a snapshot that does not yet exist', () => {
    const root = tmp();
    writeHelpSnapshot(root, '0.7.0', '1', '{"a":1}');
    const abs = helpSnapshotPath(root, '0.7.0', '1');
    expect(fs.readFileSync(abs, 'utf8')).toBe('{"a":1}');
  });

  it('does not touch the file when the text is unchanged', () => {
    const root = tmp();
    writeHelpSnapshot(root, '0.7.0', '1', '{"a":1}');
    const spy = vi.spyOn(fs, 'writeFileSync');
    writeHelpSnapshot(root, '0.7.0', '1', '{"a":1}');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('overwrites when the text differs', () => {
    const root = tmp();
    writeHelpSnapshot(root, '0.7.0', '1', '{"a":1}');
    writeHelpSnapshot(root, '0.7.0', '1', '{"a":2}');
    expect(fs.readFileSync(helpSnapshotPath(root, '0.7.0', '1'), 'utf8')).toBe('{"a":2}');
  });
});

describe('previousHelpSnapshot', () => {
  it('returns null when there is no gaps/help directory yet', () => {
    const root = tmp();
    expect(previousHelpSnapshot(root, '0.7.0', '1')).toBeNull();
  });

  it('returns null when the current build is the only snapshot stored', () => {
    const root = tmp();
    writeHelpSnapshot(root, '0.7.0', '1', '{}');
    expect(previousHelpSnapshot(root, '0.7.0', '1')).toBeNull();
  });

  it('returns the lexicographically greatest OTHER snapshot, excluding the current one', () => {
    const root = tmp();
    writeHelpSnapshot(root, '0.6.0', '29816214', '{"v":"0.6.0"}');
    writeHelpSnapshot(root, '0.7.0', '29823677', '{"v":"0.7.0-a"}');
    writeHelpSnapshot(root, '0.7.0', '29823678', '{"v":"0.7.0-b"}');
    // Checking the newest build: the previous is the next-greatest, not the current one.
    const prev = previousHelpSnapshot(root, '0.7.0', '29823678');
    expect(prev).toBe(helpSnapshotPath(root, '0.7.0', '29823677'));
    expect(fs.readFileSync(prev!, 'utf8')).toBe('{"v":"0.7.0-a"}');
  });
});
