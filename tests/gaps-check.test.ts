import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { runChecks } from '../src/gaps/check.ts';
import type { SubjectEntry } from '../src/gaps/register.ts';
import type { AdtOp, AdtRunResult } from '../src/types.ts';

const probe = { ops: [{ op: 'read:layout', name: 'Home', detail: true }] as AdtOp[], select: '**objects[id=21]' };
const entry = (id: string, attrs: SubjectEntry['attributes'], extra: Partial<SubjectEntry> = {}): SubjectEntry => ({
  id, op: 'read:layout', kind: 'object:Edit Box', probe, attributes: attrs, firstSeen: '0.6.0', reportedToClaris: null, lastChecked: null, blocks: [], ...extra,
});
const layoutResult = { op: 'read:layout', status: 'ok', result: { name: 'Home', contents: { objects: [ { id: 21, type: 'field', bounds: { top: 1 }, locked: false, newThing: 1 } ] } } };
const run = (results: unknown[]) => async (ops: AdtOp[]): Promise<AdtRunResult> => ({
  ok: true, exitCode: 0, results: results as AdtRunResult['results'], summary: { total: ops.length, ok: ops.length, errors: 0, dryRun: false, rolledBack: false }, notices: [],
  stdout: results.map((r) => JSON.stringify(r)).join('\n') + '\n', stderr: '{"type":"summary","total":1,"ok":1,"errors":0,"dryRun":false,"rolledBack":false}\n', argv: ['--file=x', '--out=/tmp/o', '/tmp/i'],
});
const meta = (root: string) => ({ version: '0.6.0', build: '1', date: '2026-09-14', root, commandFor: (a: string[]) => 'fm ' + a.join(' ') });

describe('runChecks', () => {
  it('runs each distinct probe once, evaluates every attribute, records evidence per probe, and finds unexplained keys', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const seen: AdtOp[][] = [];
    const r = async (ops: AdtOp[]) => { seen.push(ops); return run([layoutResult])(ops); };
    const a = entry('a', [
      { name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true },
      { name: 'locked', path: 'Options/Locked', knownFrom: 'SaXML', fmKey: 'locked', reported: false },   // marked missing but fm reports it -> newly reported
      { name: 'cond', path: 'ConditionalFormatting', knownFrom: 'SaXML', fmKey: null, reported: false },
      { name: 'gone', path: 'X', knownFrom: 'SaXML', fmKey: 'vanished', reported: true },                   // marked reported but absent -> regressed
    ], { ignoreKeys: ['id', 'type'] });
    const b = entry('b', [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }]);   // same probe as a
    const out = await runChecks([a, b], r, meta(root));
    expect(seen).toHaveLength(1); expect(seen[0]).toHaveLength(1);                     // one distinct probe, run once
    const ea = out.entries[0].lastChecked!;
    expect(ea.attributes).toEqual({ top: 'reported', locked: 'reported', cond: 'absent', gone: 'absent' });
    expect(ea.unexplainedKeys).toEqual(['newThing']);                                   // bounds.top, locked claimed; id, type ignored; 'bounds' parent implied
    expect(ea.evidence).toMatch(/^gaps\/evidence\/0\.6\.0\/[0-9a-f]{8}\.ndjson$/);
    expect(fs.existsSync(path.join(root, ea.evidence))).toBe(true);
    expect(out.entries[1].lastChecked!.evidence).toBe(ea.evidence);
    expect(out.newlyReported.map((x) => x.attribute.name)).toEqual(['locked']);
    expect(out.regressed.map((x) => x.attribute.name)).toEqual(['gone']);
    expect(out.stillMissing.map((x) => x.attribute.name)).toEqual(['cond']);
    expect(out.unexplained).toEqual([{ entry: out.entries[0], keys: ['newThing'] }]);
    expect(out.entries[0].attributes[1].reported).toBe(false);                          // never edited by the checker
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('reports an array-keyed fmKey present on any element, not just the first', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const triggerResult = { op: 'read:layout', status: 'ok', result: { name: 'Home', contents: { objects: [ { id: 21, scriptTriggers: [ { event: 'a' }, { event: 'b', parameter: 'x' } ] } ] } } };
    const a = entry('a', [{ name: 'trigger parameter', path: 'ScriptTrigger@parameter', knownFrom: 'SaXML', fmKey: 'scriptTriggers[].parameter', reported: false }]);
    const out = await runChecks([a], run([triggerResult]), meta(root));
    expect(out.entries[0].lastChecked!.attributes).toEqual({ 'trigger parameter': 'reported' });
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('marks an entry errored when its probe has no result or the selector finds nothing, and surfaces a fatal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const a = entry('a', [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }], { probe: { ops: probe.ops, select: '**objects[id=99]' } });
    const out = await runChecks([a], run([layoutResult]), meta(root));
    expect(out.errored.map((e) => e.id)).toEqual(['a']);
    expect(out.entries[0].lastChecked!.reason).toMatch(/selector .* matched nothing/);
    expect(out.entries[0].lastChecked!.attributes).toEqual({ top: 'error' });
    const fatalRun = async (): Promise<AdtRunResult> => ({ ok: false, exitCode: 2, results: [], summary: null, notices: [], stdout: '', stderr: '{"type":"fatal","error":{"code":"open_failed","message":"no"}}\n', fatal: { code: 'open_failed', message: 'no' }, argv: ['--file=x'] });
    const out2 = await runChecks([a], fatalRun, meta(root));
    expect(out2.fatal?.code).toBe('open_failed');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
