import { describe, expect, it } from 'vitest';
import { assertReadOnly, isReadOnlyOp, READ_ONLY_VERBS, WRITE_VERBS } from '../src/read-only.js';
import help from '../gaps/help/0.8.0-beta.0-29827611.json' with { type: 'json' };

describe('the read-only guard classifies by verb', () => {
  it('admits every verb fm declares does not write', () => {
    for (const op of ['read:layout', 'search:layout', 'search:text', 'search:variable', 'evaluate:calculation', 'validate:calculation']) {
      expect(isReadOnlyOp({ op }), op).toBe(true);
    }
  });

  it('refuses every write verb, including duplicate', () => {
    for (const op of ['create:layout', 'update:fileOptions', 'delete:script', 'duplicate:script']) {
      expect(isReadOnlyOp({ op }), op).toBe(false);
    }
    expect(() => assertReadOnly([{ op: 'read:layout' }, { op: 'duplicate:script' }])).toThrow(/duplicate:script/);
  });

  // The ratchet: a build that adds a verb fails here rather than landing on the
  // permissive side (a write verb admitted) or the restrictive side (a read verb
  // quietly unusable, which is how search:* was missed for a whole release).
  it('every verb in the help snapshot is classified', () => {
    const verbs = new Set(
      (help.nodes as Array<{ kind: string; title?: string }>)
        .filter((n) => n.kind === 'op' && typeof n.title === 'string')
        .map((n) => n.title!.split(':')[0]),
    );
    expect(verbs.size).toBeGreaterThan(0);
    const unclassified = [...verbs].filter((v) => !READ_ONLY_VERBS.has(v) && !WRITE_VERBS.has(v));
    expect(unclassified, `unclassified fm verbs: add each to READ_ONLY_VERBS or WRITE_VERBS in src/read-only.ts after reading fm's help for whether it writes`).toEqual([]);
  });

  it('the two sets are disjoint and cover the build', () => {
    expect([...READ_ONLY_VERBS].filter((v) => WRITE_VERBS.has(v))).toEqual([]);
    expect([...READ_ONLY_VERBS].sort()).toEqual(['evaluate', 'read', 'search', 'validate']);
    expect([...WRITE_VERBS].sort()).toEqual(['create', 'delete', 'duplicate', 'update']);
  });
});
