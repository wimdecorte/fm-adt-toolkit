import { describe, it, expect } from 'vitest';
import { isReadOnlyOp, assertReadOnly, READ_ONLY_CALCULATION_OPS } from '../src/read-only.ts';

describe('isReadOnlyOp', () => {
  it('accepts every read: op and the two calculation verbs fm guarantees never write', () => {
    expect(isReadOnlyOp({ op: 'read:table' })).toBe(true);
    expect(isReadOnlyOp({ op: 'read:layout', id: 11, detail: true })).toBe(true);
    expect(isReadOnlyOp({ op: 'evaluate:calculation', calculation: 'Get ( EncryptionState )' })).toBe(true);
    expect(isReadOnlyOp({ op: 'validate:calculation', calculation: 'Length ( Self ) > 3' })).toBe(true);
    expect([...READ_ONLY_CALCULATION_OPS].sort()).toEqual(['evaluate:calculation', 'validate:calculation']);
  });
  it('refuses writes, verb typos and malformed ops', () => {
    for (const op of ['create:table', 'update:script', 'delete:field', 'evaluate:table', 'read', 'reader:table']) {
      expect(isReadOnlyOp({ op }), op).toBe(false);
    }
    expect(isReadOnlyOp({} as { op: string })).toBe(false);
  });
});

describe('assertReadOnly', () => {
  it('passes a read-only batch through and names the offending op otherwise', () => {
    expect(() => assertReadOnly([{ op: 'read:table' }, { op: 'evaluate:calculation', calculation: '1' }])).not.toThrow();
    expect(() => assertReadOnly([{ op: 'read:table' }, { op: 'update:script', name: 'x' }])).toThrow(/"update:script" is not read-only/);
  });
});
