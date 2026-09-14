import { describe, it, expect } from 'vitest';
import { runChecks } from '../src/gaps/check.ts';
import type { GapEntry } from '../src/gaps/register.ts';
import type { AdtOp, AdtRunResult } from '../src/types.ts';

const entry = (id: string, check: GapEntry['probe']['check'], status: GapEntry['status'] = 'open'): GapEntry => ({
  id, title: id, area: 'catalog:layout', description: '', status, firstSeen: '0.6.0', lastChecked: null,
  reportedToClaris: null, blocks: [{ app: 'inspector', feature: id }],
  probe: { target: 'reference', ops: [{ op: 'read:layout', name: 'File Open', detail: true }], check },
});

describe('runChecks', () => {
  it('runs every probe in ONE batch, maps results back by position, records evidence', async () => {
    const seen: AdtOp[][] = [];
    const run = async (ops: AdtOp[]): Promise<AdtRunResult> => {
      seen.push(ops);
      return {
        ok: true, exitCode: 0, summary: { total: 2, ok: 2, errors: 0, dryRun: false, rolledBack: false }, notices: [],
        results: [
          { op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex' } } },
          { op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex', styles: [] } } },
        ],
        stdout: '{"op":"read:layout","status":"ok","result":{"theme":{"name":"Apex"}}}\n{"op":"read:layout","status":"ok","result":{"theme":{"name":"Apex","styles":[]}}}\n',
        stderr: '{"type":"summary","total":2,"ok":2,"errors":0,"dryRun":false,"rolledBack":false}\n',
        argv: ['--file=fmnet://localhost/ooe', '--username=admin', '--keychain', '--no-prompt', '--abort-on-error=false', '--out=/tmp/o', '/tmp/i'],
      };
    };
    const out = await runChecks(
      [entry('a', { kind: 'keyPresent', path: 'theme.styles' }), entry('b', { kind: 'keyPresent', path: 'theme.styles' })],
      run,
      { version: '0.6.0', build: '29816214', date: '2026-09-14', commandFor: (argv) => 'fm ' + argv.join(' ') },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(2);
    expect(out.stillOpen.map((e) => e.id)).toEqual(['a']);
    expect(out.newlyPassing.map((e) => e.id)).toEqual(['b']);
    expect(out.errored).toEqual([]);
    const a = out.entries[0].lastChecked!;
    expect(a.outcome).toBe('open');
    expect(a.command).toBe('fm --file=fmnet://localhost/ooe --username=admin --keychain --no-prompt --abort-on-error=false --out=/tmp/o /tmp/i');
    expect(a.ops).toEqual([{ op: 'read:layout', name: 'File Open', detail: true }]);
    expect(a.response.stdout).toEqual([{ op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex' } } }]);
    expect(a.response.stderr).toEqual([{ type: 'summary', total: 2, ok: 2, errors: 0, dryRun: false, rolledBack: false }]);
    expect(a.response.exitCode).toBe(0);
    expect(out.entries[1].lastChecked!.outcome).toBe('passed');
    // status is NOT flipped automatically; a human marks it fixed after reading the evidence
    expect(out.entries[1].status).toBe('open');
  });

  it('marks an entry errored when the result at its position is a different op, without disturbing other entries', async () => {
    const run = async (): Promise<AdtRunResult> => ({
      ok: true, exitCode: 0, summary: { total: 2, ok: 2, errors: 0, dryRun: false, rolledBack: false }, notices: [],
      results: [
        { op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex' } } },
        { op: 'read:table', status: 'ok', result: { kind: 'table' } },
      ],
      stdout: '{"op":"read:layout","status":"ok","result":{"theme":{"name":"Apex"}}}\n{"op":"read:table","status":"ok","result":{"kind":"table"}}\n',
      stderr: '{"type":"summary","total":2,"ok":2,"errors":0,"dryRun":false,"rolledBack":false}\n',
      argv: ['--file=x'],
    });
    const out = await runChecks(
      [entry('a', { kind: 'keyPresent', path: 'theme.styles' }), entry('b', { kind: 'keyPresent', path: 'theme.styles' })],
      run,
      { version: '0.6.0', build: '1', date: '2026-09-14', commandFor: (argv) => 'fm ' + argv.join(' ') },
    );
    // entry 1 (index 0) is unaffected: its own result matches its probe op.
    expect(out.entries[0].lastChecked!.outcome).toBe('open');
    // entry 2 (index 1) got a result line back, but for the wrong op.
    expect(out.errored.map((e) => e.id)).toEqual(['b']);
    expect(out.entries[1].lastChecked!.outcome).toBe('error');
    expect(out.entries[1].lastChecked!.reason).toBe(
      'result op read:table does not match probe op read:layout at position 1',
    );
  });

  it('marks an entry errored when its result line is missing and never throws', async () => {
    const run = async (): Promise<AdtRunResult> => ({
      ok: false, exitCode: 2, summary: null, notices: [], results: [], stdout: '',
      stderr: '{"type":"fatal","error":{"code":"open_failed","message":"nope"}}\n',
      fatal: { code: 'open_failed', message: 'nope' }, argv: ['--file=x'],
    });
    const out = await runChecks([entry('a', { kind: 'opAccepted' })], run,
      { version: '0.6.0', build: '1', date: '2026-09-14', commandFor: (argv) => 'fm ' + argv.join(' ') });
    expect(out.errored.map((e) => e.id)).toEqual(['a']);
    expect(out.entries[0].lastChecked!.outcome).toBe('error');
    expect(out.entries[0].lastChecked!.response.stderr[0]).toMatchObject({ type: 'fatal' });
  });

  it('stores [] for stdout, not the whole batch, when an entry has no result line of its own', async () => {
    const run = async (): Promise<AdtRunResult> => ({
      // Only entry 'a's own line came back; entry 'b' has nothing at position 1,
      // but the batch's stdout still carries a's line — that must not leak into b's evidence.
      ok: false, exitCode: 1, summary: { total: 2, ok: 1, errors: 1, dryRun: false, rolledBack: false }, notices: [],
      results: [{ op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex' } } }],
      stdout: '{"op":"read:layout","status":"ok","result":{"theme":{"name":"Apex"}}}\n',
      stderr: '{"type":"summary","total":2,"ok":1,"errors":1,"dryRun":false,"rolledBack":false}\n',
      argv: ['--file=x'],
    });
    const out = await runChecks(
      [entry('a', { kind: 'opAccepted' }), entry('b', { kind: 'opAccepted' })],
      run,
      { version: '0.6.0', build: '1', date: '2026-09-14', commandFor: (argv) => 'fm ' + argv.join(' ') },
    );
    expect(out.entries[1].lastChecked!.outcome).toBe('error');
    expect(out.entries[1].lastChecked!.response.stdout).toEqual([]);
    // full stderr lines are still kept
    expect(out.entries[1].lastChecked!.response.stderr).toEqual([
      { type: 'summary', total: 2, ok: 1, errors: 1, dryRun: false, rolledBack: false },
    ]);
  });

  it('returns the run-level fatal from runChecks when the run reports one', async () => {
    const run = async (): Promise<AdtRunResult> => ({
      ok: false, exitCode: 2, summary: null, notices: [], results: [], stdout: '',
      stderr: '{"type":"fatal","error":{"code":"open_failed","message":"nope"}}\n',
      fatal: { code: 'open_failed', message: 'nope' }, argv: ['--file=x'],
    });
    const out = await runChecks([entry('a', { kind: 'opAccepted' })], run,
      { version: '0.6.0', build: '1', date: '2026-09-14', commandFor: (argv) => 'fm ' + argv.join(' ') });
    expect(out.fatal).toEqual({ code: 'open_failed', message: 'nope' });
  });

  it('records batch size and 0-based position on every entry\'s evidence', async () => {
    const run = async (): Promise<AdtRunResult> => ({
      ok: true, exitCode: 0, summary: { total: 2, ok: 2, errors: 0, dryRun: false, rolledBack: false }, notices: [],
      results: [
        { op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex' } } },
        { op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex' } } },
      ],
      stdout: '', stderr: '{"type":"summary","total":2,"ok":2,"errors":0,"dryRun":false,"rolledBack":false}\n',
      argv: ['--file=x'],
    });
    const out = await runChecks(
      [entry('a', { kind: 'opAccepted' }), entry('b', { kind: 'opAccepted' })],
      run,
      { version: '0.6.0', build: '1', date: '2026-09-14', commandFor: (argv) => 'fm ' + argv.join(' ') },
    );
    expect(out.entries[0].lastChecked!.batch).toEqual({ size: 2, position: 0 });
    expect(out.entries[1].lastChecked!.batch).toEqual({ size: 2, position: 1 });
  });
});
