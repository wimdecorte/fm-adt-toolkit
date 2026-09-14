import { describe, it, expect } from 'vitest';
import type { AdtRunResult, FmTarget, ScriptDetailStep } from '../src/types.ts';

describe('types', () => {
  it('shapes compile and carry the runner evidence fields', () => {
    const target: FmTarget = { file: 'fmnet://localhost/ooe', username: 'admin' };
    const step: ScriptDetailStep = { stepID: 89, step: '#', text: 'hi' };
    const run: AdtRunResult = {
      ok: true, exitCode: 0, results: [], summary: null, notices: [],
      stderr: '', stdout: '', argv: ['--file=' + target.file],
    };
    expect(run.argv[0]).toBe('--file=fmnet://localhost/ooe');
    expect(step.step).toBe('#');
  });
});
