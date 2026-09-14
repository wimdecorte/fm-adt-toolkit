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
});
