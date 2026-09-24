import { describe, it, expect } from 'vitest';
import { diffBehaviour, renderBehaviourDiff, readOutcome, PROBE_IDS } from '../src/gaps/behaviour.ts';
import type { BehaviourSnapshot } from '../src/gaps/behaviour.ts';

function snap(results: Record<string, string>, build = '1'): BehaviourSnapshot {
  return { version: '0.8.0', build, date: '2026-09-24', results };
}

describe('diffBehaviour', () => {
  it('reports an outcome that changed between builds', () => {
    const prev = snap({ 'lock:concurrent-reads': 'locked/303' });
    const next = snap({ 'lock:concurrent-reads': 'both-succeeded' }, '2');
    const d = diffBehaviour(prev, next);
    expect(d.changed).toEqual([
      { id: 'lock:concurrent-reads', from: 'locked/303', to: 'both-succeeded' },
    ]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('separates a probe that is new from one that stopped being run', () => {
    const prev = snap({ a: 'ok', gone: 'ok' });
    const next = snap({ a: 'ok', fresh: 'ok' }, '2');
    const d = diffBehaviour(prev, next);
    expect(d.added).toEqual([{ id: 'fresh', to: 'ok' }]);
    expect(d.removed).toEqual([{ id: 'gone', from: 'ok' }]);
    expect(d.changed).toEqual([]);
  });

  it('reports nothing when every outcome is identical', () => {
    const s = snap({ a: 'ok', b: 'permission_denied/207' });
    expect(diffBehaviour(s, s)).toEqual({ changed: [], added: [], removed: [] });
  });

  it('has no previous snapshot to compare against on a first run', () => {
    const next = snap({ a: 'ok' });
    const d = diffBehaviour(null, next);
    // Everything is "added" rather than "changed": there is no earlier claim to contradict.
    expect(d.added).toEqual([{ id: 'a', to: 'ok' }]);
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe('renderBehaviourDiff', () => {
  it('renders one line per change, headed by the two build labels', () => {
    const d = diffBehaviour(
      snap({ 'lock:concurrent-reads': 'locked/303', keep: 'ok' }),
      snap({ 'lock:concurrent-reads': 'both-succeeded', keep: 'ok', extra: 'ok' }, '2'),
    );
    const lines = renderBehaviourDiff(d, '0.8.0-1', '0.8.0-2').split('\n');
    expect(lines[0]).toBe('0.8.0-1 -> 0.8.0-2');
    expect(lines).toContain('~ lock:concurrent-reads  locked/303 -> both-succeeded');
    expect(lines).toContain('+ extra  ok');
    // An unchanged probe is not worth a line.
    expect(lines.join('\n')).not.toContain('keep');
  });

  it('says so plainly when nothing moved', () => {
    const s = snap({ a: 'ok' });
    expect(renderBehaviourDiff(diffBehaviour(s, s), 'a', 'b')).toBe('no behaviour changes');
  });
});

describe('PROBE_IDS', () => {
  it('names every probe this command records, so a snapshot is self-describing', () => {
    // The ids are the snapshot's keys and appear in its diff output, so they are part of the
    // format rather than an implementation detail. This pins the ones the findings rest on.
    expect(PROBE_IDS).toContain('lock:concurrent-reads');
    expect(PROBE_IDS).toContain('no-developer-privilege:open');
    expect(PROBE_IDS).toContain('developer-only:read:layout');
    expect(PROBE_IDS).toContain('developer-only:create:layout');
    expect(PROBE_IDS).toContain('all-privileges:read:privilegeSet');
    expect(PROBE_IDS).toContain('extendedPrivilege:keywords');
  });

  it('has no duplicate ids, which would make one probe overwrite another in a snapshot', () => {
    expect(new Set(PROBE_IDS).size).toBe(PROBE_IDS.length);
  });
});

describe('readOutcome', () => {
  it('says the session saw everything the owner sees', () => {
    expect(readOutcome({ total: 22, items: 22 }, { total: 22, items: 22 })).toBe('ok all total=file');
  });

  it('says the session saw a subset, without embedding either count', () => {
    // The point of the token: a file that GAINS a layout must not read as a behaviour change.
    expect(readOutcome({ total: 22, items: 22 }, { total: 5, items: 1 })).toBe('ok subset total=session');
    expect(readOutcome({ total: 30, items: 30 }, { total: 6, items: 1 })).toBe('ok subset total=session');
  });

  it('says the session saw none of the real items even though the call succeeded', () => {
    expect(readOutcome({ total: 22, items: 22 }, { total: 4, items: 0 })).toBe('ok none total=session');
  });

  it('distinguishes a total that reports the FILE count from one scoped to the session', () => {
    // If fm ever fixes `total` to mean "how many the file has" while still filtering items, that
    // is a behaviour change worth a line, and this is what would catch it.
    expect(readOutcome({ total: 22, items: 22 }, { total: 22, items: 1 })).toBe('ok subset total=file');
  });

  it('reads an empty catalog as all-seen rather than as filtering', () => {
    expect(readOutcome({ total: 0, items: 0 }, { total: 0, items: 0 })).toBe('ok all total=file');
  });
});
