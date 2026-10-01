import fs from 'node:fs';
import path from 'node:path';
import { evidenceDir } from './evidence.ts';
import { newestOther } from './build-order.ts';
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
 *  null when this is the first run. Mirrors `previousHelpSnapshot`, ordering by build number
 *  rather than by filename. */
export function previousBehaviourSnapshot(root: string, version: string, build: string): BehaviourSnapshot | null {
  const dir = path.join(root, 'gaps', 'behaviour');
  if (!fs.existsSync(dir)) return null;
  const current = path.basename(behaviourSnapshotPath(root, version, build));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const prev = newestOther(files, current);
  return prev ? JSON.parse(fs.readFileSync(path.join(dir, prev), 'utf8')) as BehaviourSnapshot : null;
}
