import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { writeBehaviourSnapshot, previousBehaviourSnapshot } from '../src/gaps/behaviour-store.ts';
import type { BehaviourSnapshot } from '../src/gaps/behaviour.ts';

function snap(version: string, build: string, results: Record<string, string> = {}): BehaviourSnapshot {
  return { version, build, date: '2026-09-24', results };
}

describe('previousBehaviourSnapshot', () => {
  it('returns null when there is no gaps/behaviour directory yet', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-bh-'));
    expect(previousBehaviourSnapshot(root, '0.7.0', '1')).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('picks the previous build by build number, not by filename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-bh-'));
    writeBehaviourSnapshot(root, snap('0.8.0', 'beta.0-29827611', { probe: 'beta' }));
    writeBehaviourSnapshot(root, snap('0.8.0', '29834929', { probe: 'ga' }));
    // '0.8.0-29834929' sorts before '0.8.0-beta.0-29827611' as a string, but the GA's build is later.
    const prev = previousBehaviourSnapshot(root, '0.9.0', '29846589');
    expect(prev?.results.probe).toBe('ga');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
