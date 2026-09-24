import fs from 'node:fs';
import path from 'node:path';
import { evidenceDir } from './evidence.ts';
import type { BehaviourSnapshot } from './behaviour.ts';

/** Where one build's behaviour snapshot lives: the same `<version>-<build>` naming as
 *  `evidenceDir` and the help snapshots, so a build's three records sit side by side under
 *  `gaps/`. */
export function behaviourSnapshotPath(root: string, version: string, build: string): string {
  return path.join(root, 'gaps', 'behaviour', `${evidenceDir(version, build)}.json`);
}

export function writeBehaviourSnapshot(root: string, snapshot: BehaviourSnapshot): void {
  const abs = behaviourSnapshotPath(root, snapshot.version, snapshot.build);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(snapshot, null, 2) + '\n');
}

/** The newest OTHER stored snapshot -- what this build's answers should be compared against -- or
 *  null when this is the first run. Mirrors `previousHelpSnapshot`, including its wart: filenames
 *  are compared as strings, so a GA build sorts before its own prereleases (`0.8.0-29834929` <
 *  `0.8.0-beta.0-29827611`). Worth knowing when reading a diff that skipped a build. */
export function previousBehaviourSnapshot(root: string, version: string, build: string): BehaviourSnapshot | null {
  const dir = path.join(root, 'gaps', 'behaviour');
  if (!fs.existsSync(dir)) return null;
  const current = path.basename(behaviourSnapshotPath(root, version, build));
  const others = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== current).sort();
  if (!others.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, others[others.length - 1]), 'utf8')) as BehaviourSnapshot;
}
