import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { evidenceDir } from './evidence.ts';
import { newestOther } from './build-order.ts';

const execFileAsync = promisify(execFile);

/** Runs `fm help --json --all` and returns stdout verbatim: the CLI's own description of
 *  every catalog, op and key it accepts. This is the authoritative surface -- a rename or
 *  an added catalog shows up here directly, rather than only being noticed through a probe
 *  that starts failing. `help --json --all` takes no ops file and opens no FileMaker file. */
export async function captureHelp(cliPath: string): Promise<string> {
  const { stdout } = await execFileAsync(cliPath, ['help', '--json', '--all'], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Where one build's help snapshot lives: the same `<version>-<build>` naming as
 *  `evidenceDir`, so a build's help and its probe evidence sit side by side under `gaps/`. */
export function helpSnapshotPath(root: string, version: string, build: string): string {
  return path.join(root, 'gaps', 'help', `${evidenceDir(version, build)}.json`);
}

/** Writes this build's help snapshot, but only when there is none yet or the stored text
 *  differs from `text` -- re-running `check` against the same build should not touch the
 *  file (or its mtime) every time. */
export function writeHelpSnapshot(root: string, version: string, build: string, text: string): void {
  const abs = helpSnapshotPath(root, version, build);
  if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === text) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** The newest OTHER stored snapshot -- what the current build's help should be diffed
 *  against -- or null when this is the first build recorded. Mirrors `previousEvidenceDir`,
 *  ordering by build number rather than by filename. */
export function previousHelpSnapshot(root: string, version: string, build: string): string | null {
  const dir = path.join(root, 'gaps', 'help');
  if (!fs.existsSync(dir)) return null;
  const current = path.basename(helpSnapshotPath(root, version, build));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const prev = newestOther(files, current);
  return prev ? path.join(dir, prev) : null;
}
