import { describe, it, expect } from 'vitest';
import { evaluateCheck } from '../src/gaps/checks.ts';
import type { AdtOpResult } from '../src/types.ts';

const ok = (result: Record<string, unknown>): AdtOpResult => ({ op: 'read:x', status: 'ok', result });
const err: AdtOpResult = { op: 'read:x', status: 'error', error: { code: 'invalid_op', message: 'no' } };

describe('evaluateCheck', () => {
  it('keyPresent walks a dotted path', () => {
    expect(evaluateCheck({ kind: 'keyPresent', path: 'theme.styles' }, [ok({ theme: { styles: [] } })]).passed).toBe(true);
    expect(evaluateCheck({ kind: 'keyPresent', path: 'theme.styles' }, [ok({ theme: { name: 'x' } })]).passed).toBe(false);
    expect(evaluateCheck({ kind: 'keyPresent', path: 'theme.styles' }, [err]).passed).toBe(false);
  });
  it('opAccepted passes only on ok', () => {
    expect(evaluateCheck({ kind: 'opAccepted' }, [ok({})]).passed).toBe(true);
    expect(evaluateCheck({ kind: 'opAccepted' }, [err]).passed).toBe(false);
    expect(evaluateCheck({ kind: 'opAccepted' }, []).passed).toBe(false);
  });
  it('stepNotOpaque fails when any step of that name is opaque', () => {
    const body = [{ stepID: 42, step: 'Page Setup', opaque: true }, { stepID: 141, step: 'Set Variable', name: '$a' }];
    expect(evaluateCheck({ kind: 'stepNotOpaque', stepName: 'Page Setup' }, [ok({ body })]).passed).toBe(false);
    expect(evaluateCheck({ kind: 'stepNotOpaque', stepName: 'Set Variable' }, [ok({ body })]).passed).toBe(true);
    expect(evaluateCheck({ kind: 'stepNotOpaque', stepName: 'Print' }, [ok({ body })]).reason).toMatch(/no step named/);
  });
  it('stepKeyPresent passes when some step of that name carries the key', () => {
    const body = [{ stepID: 1, step: 'Add Account', name: '"x"' }];
    expect(evaluateCheck({ kind: 'stepKeyPresent', stepName: 'Add Account', key: 'privilege set' }, [ok({ body })]).passed).toBe(false);
    expect(evaluateCheck({ kind: 'stepKeyPresent', stepName: 'Add Account', key: 'name' }, [ok({ body })]).passed).toBe(true);
  });
  it('valueEquals compares with deep equality', () => {
    expect(evaluateCheck({ kind: 'valueEquals', path: 'kind', value: 'table' }, [ok({ kind: 'table' })]).passed).toBe(true);
    expect(evaluateCheck({ kind: 'valueEquals', path: 'kind', value: 'field' }, [ok({ kind: 'table' })]).passed).toBe(false);
  });
});
