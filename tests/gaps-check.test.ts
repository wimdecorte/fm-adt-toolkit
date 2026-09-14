import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { runChecks } from '../src/gaps/check.ts';
import { writeEvidence } from '../src/gaps/evidence.ts';
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
    expect(ea.evidence).toMatch(/^gaps\/evidence\/0\.6\.0-1\/[0-9a-f]{8}\.ndjson$/);
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
  it('evaluates a verifiedOn attribute on the OTHER probe\'s instance, joining the distinct batch and writing its own evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const seen: AdtOp[][] = [];
    const otherOp: AdtOp = { op: 'read:layout', name: 'List', detail: true };
    const ownResult = { op: 'read:layout', status: 'ok', result: { name: 'Home', contents: { objects: [ { id: 21, bounds: { top: 1 } } ] } } };
    const otherResult = { op: 'read:layout', status: 'ok', result: { name: 'List', contents: { objects: [ { id: 99, foo: 'yes' } ] } } };
    const r = async (ops: AdtOp[]) => { seen.push(ops); return run([ownResult, otherResult])(ops); };
    const a = entry('a', [
      { name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true },
      // 'foo' is absent on this entry's own probe instance (objects[id=21]), but verifiedOn
      // redirects its evaluation to a different probe's instance (objects[id=99]) where fm
      // does report it.
      { name: 'foo', path: 'Foo', knownFrom: 'SaXML', fmKey: 'foo', reported: false, verifiedOn: { ops: [otherOp], select: '**objects[id=99]' } },
    ]);
    const out = await runChecks([a], r, meta(root));
    expect(seen[0]).toHaveLength(2);                                    // both probes joined the one batch
    const ea = out.entries[0].lastChecked!;
    expect(ea.attributes).toEqual({ top: 'reported', foo: 'reported' });
    expect(ea.attributeEvidence?.foo).toBeDefined();
    expect(ea.attributeEvidence!.foo).not.toBe(ea.evidence);             // differs from the entry's own evidence
    expect(fs.existsSync(path.join(root, ea.evidence))).toBe(true);
    expect(fs.existsSync(path.join(root, ea.attributeEvidence!.foo))).toBe(true);
    expect(out.newlyReported.map((x) => x.attribute.name)).toEqual(['foo']);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('marks only the attribute errored, not the whole entry, when a verifiedOn selector matches nothing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const otherOp: AdtOp = { op: 'read:layout', name: 'List', detail: true };
    const ownResult = { op: 'read:layout', status: 'ok', result: { name: 'Home', contents: { objects: [ { id: 21, bounds: { top: 1 } } ] } } };
    const otherResult = { op: 'read:layout', status: 'ok', result: { name: 'List', contents: { objects: [] } } };
    const a = entry('a', [
      { name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true },
      { name: 'foo', path: 'Foo', knownFrom: 'SaXML', fmKey: 'foo', reported: false, verifiedOn: { ops: [otherOp], select: '**objects[id=99]' } },
    ]);
    const out = await runChecks([a], run([ownResult, otherResult]), meta(root));
    expect(out.errored).toEqual([]);                                    // the entry itself is fine
    expect(out.entries[0].lastChecked!.reason).toBeUndefined();
    expect(out.entries[0].lastChecked!.attributes).toEqual({ top: 'reported', foo: 'error' });
    expect(out.entries[0].lastChecked!.attributeReasons?.foo).toBe('container present, selector matched nothing: **objects[id=99]');
    expect(out.newlyReported).toEqual([]);
    expect(out.stillMissing).toEqual([]);
    expect(out.attributeErrors.map((x) => [x.entry.id, x.attribute.name, x.reason]))
      .toEqual([['a', 'foo', 'container present, selector matched nothing: **objects[id=99]']]);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('requires the named member, not just the key, when an attribute carries expect.contains', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const flagResult = { op: 'read:layout', status: 'ok', result: { name: 'Home', flags: { raw: '0x3', set: ['onlyShowCurrentFrames', 'verticalPartLabels'] } } };
    const a = entry('a', [
      { name: 'set flag', path: 'Options bit 0', knownFrom: 'SaXML', fmKey: 'flags.set', reported: true, expect: { contains: 'onlyShowCurrentFrames' } },
      { name: 'clear flag', path: 'Options bit 6', knownFrom: 'SaXML', fmKey: 'flags.set', reported: false, expect: { contains: 'fixedMargins' } },
    ], { probe: { ops: probe.ops } });
    const out = await runChecks([a], run([flagResult]), meta(root));
    expect(out.entries[0].lastChecked!.attributes).toEqual({ 'set flag': 'reported', 'clear flag': 'absent' });
    expect(out.regressed).toEqual([]);
    expect(out.stillMissing.map((x) => x.attribute.name)).toEqual(['clear flag']);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('errors an entry whose selected instance is not the kind the reference recorded', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const a = entry('a', [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }], { fmType: { type: 'popoverPanel', control: null } });
    const out = await runChecks([a], run([layoutResult]), meta(root));
    expect(out.errored.map((e) => e.id)).toEqual(['a']);
    expect(out.entries[0].lastChecked!.reason).toBe('selector matched a different kind: type "field", expected "popoverPanel"');
    expect(out.entries[0].lastChecked!.attributes).toEqual({ top: 'error' });
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('lists nested unexplained keys, minus what another entry\'s selector owns on the same probe', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const layout = { op: 'read:layout', status: 'ok', result: { name: 'Home', flags: { raw: '0x1', set: ['a'] }, theme: { name: 'Apex', styles: [{ tag: 'x' }] },
      contents: { objects: [{ id: 21, type: 'field', bounds: { top: 1 } }], parts: [{ type: 'body', label: 'Body' }] } } };
    const whole = entry('whole', [
      { name: 'name', path: '@name', knownFrom: 'SaXML', fmKey: 'name', reported: true },
      { name: 'flags raw', path: 'Options', knownFrom: 'SaXML', fmKey: 'flags.raw', reported: true },
    ], { probe: { ops: probe.ops }, ignoreKeys: ['theme'] });
    const object = entry('object', [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }], { probe: { ops: probe.ops, select: '**objects[id=21]' } });
    const part = entry('part', [{ name: 'label', path: '@name', knownFrom: 'SaXML', fmKey: 'label', reported: true }], { probe: { ops: probe.ops, select: 'contents.parts[type=Body]' } });
    const out = await runChecks([whole, object, part], run([layout]), meta(root));
    const c = out.entries[0].lastChecked!;
    expect(c.unexplainedKeys).toEqual(['contents']);                                  // top-level only, as before
    // 'theme' and everything under it is ignored; contents.objects.* belongs to the
    // object entry's selector and contents.parts.* to the part entry's; flags.set is the
    // one nested key nothing claims.
    expect(c.unexplainedNestedKeys).toEqual(['flags.set', 'contents']);
    expect(out.nestedUnexplained.map((x) => x.entry.id)).toEqual(['whole', 'object', 'part']);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('diffs each probe\'s keys against the previous build\'s evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const op = probe.ops[0];
    writeEvidence(root, '0.5.0', '900', op, {
      command: 'fm', batch: { size: 1, position: 0 }, exitCode: 0, stderr: [],
      stdout: [{ op: 'read:layout', status: 'ok', result: { name: 'Home', contents: { objects: [{ id: 21, type: 'field', oldThing: 1 }] } } }],
    });
    const a = entry('a', [{ name: 'type', path: '@type', knownFrom: 'SaXML', fmKey: 'type', reported: true }]);
    const out = await runChecks([a], run([layoutResult]), meta(root));
    expect(out.keyDiff).toHaveLength(1);
    expect(out.keyDiff[0].previous).toBe('0.5.0-900');
    expect(out.keyDiff[0].added).toEqual(['bounds', 'bounds.top', 'locked', 'newThing']);
    expect(out.keyDiff[0].removed).toEqual(['oldThing']);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('names which of the three ways a probe failed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const attrs = [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }];
    const refusedEntry = entry('refused', attrs, { probe: { ops: [{ op: 'read:file' }] as AdtOp[] } });
    const absentContainer = entry('absent', attrs, { probe: { ops: probe.ops, select: 'contents.parts[type=Body]' } });
    const emptyMatch = entry('empty', attrs, { probe: { ops: probe.ops, select: '**objects[id=99]' } });
    const refused = { op: 'read:file', status: 'error', error: { code: 'unknown_catalog', message: 'no' } };
    const out = await runChecks([refusedEntry, absentContainer, emptyMatch], run([refused, layoutResult]), meta(root));
    expect(out.entries[0].lastChecked!.reason).toBe('probe refused: unknown_catalog');
    expect(out.entries[1].lastChecked!.reason).toBe('container key absent: contents.parts');
    expect(out.entries[2].lastChecked!.reason).toBe('container present, selector matched nothing: **objects[id=99]');
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('lists an errored entry whose reason its expectedError accepts apart from the unexpected ones', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const attrs = [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }];
    const accepted = entry('accepted', attrs, { probe: { ops: probe.ops, select: '**objects[id=99]' }, expectedError: 'container present, selector matched nothing' });
    const byCode = entry('by-code', attrs, { probe: { ops: [{ op: 'read:file' }] as AdtOp[] }, expectedError: 'unknown_catalog' });
    const unexpected = entry('unexpected', attrs, { probe: { ops: probe.ops, select: '**objects[id=98]' } });
    const refused = { op: 'read:file', status: 'error', error: { code: 'unknown_catalog', message: 'no' } };
    const out = await runChecks([accepted, byCode, unexpected], run([layoutResult, refused]), meta(root));
    expect(out.erroredExpected.map((e) => e.id)).toEqual(['accepted', 'by-code']);
    expect(out.errored.map((e) => e.id)).toEqual(['unexpected']);
    expect(out.expectedResolved).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('lists an entry whose expected failure has been resolved', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const a = entry('a', [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }], { expectedError: 'container key absent' });
    const out = await runChecks([a], run([layoutResult]), meta(root));
    expect(out.expectedResolved.map((e) => e.id)).toEqual(['a']);
    expect(out.errored).toEqual([]);
    expect(out.erroredExpected).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('refuses to score a batch whose result lines do not line up with the ops sent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const otherOp: AdtOp = { op: 'read:layout', name: 'List', detail: true };
    const a = entry('a', [
      { name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true },
      { name: 'foo', path: 'Foo', knownFrom: 'SaXML', fmKey: 'foo', reported: false, verifiedOn: { ops: [otherOp], select: '**objects[id=99]' } },
    ]);
    // Two ops go out, one result line comes back: every position after the gap would be
    // read off the wrong probe, so nothing is scored and nothing is written.
    const out = await runChecks([a], run([layoutResult]), meta(root));
    expect(out.fatal?.code).toBe('batch_misaligned');
    expect(out.fatal?.message).toBe('2 ops sent, 1 result lines, summary total 2');
    expect(out.entries[0].lastChecked).toBeNull();
    expect(fs.readdirSync(root)).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('refuses a batch whose summary total disagrees with the ops sent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const a = entry('a', [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }]);
    const skewed = async (ops: AdtOp[]): Promise<AdtRunResult> => ({
      ...(await run([layoutResult])(ops)), summary: { total: 7, ok: 7, errors: 0, dryRun: false, rolledBack: false },
    });
    const out = await runChecks([a], skewed, meta(root));
    expect(out.fatal?.code).toBe('batch_misaligned');
    expect(out.fatal?.message).toBe('1 ops sent, 1 result lines, summary total 7');
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('marks an entry errored when its probe has no result or the selector finds nothing, and surfaces a fatal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-chk-'));
    const a = entry('a', [{ name: 'top', path: 'Bounds@top', knownFrom: 'SaXML', fmKey: 'bounds.top', reported: true }], { probe: { ops: probe.ops, select: '**objects[id=99]' } });
    const out = await runChecks([a], run([layoutResult]), meta(root));
    expect(out.errored.map((e) => e.id)).toEqual(['a']);
    expect(out.entries[0].lastChecked!.reason).toBe('container present, selector matched nothing: **objects[id=99]');
    expect(out.entries[0].lastChecked!.attributes).toEqual({ top: 'error' });
    const fatalRun = async (): Promise<AdtRunResult> => ({ ok: false, exitCode: 2, results: [], summary: null, notices: [], stdout: '', stderr: '{"type":"fatal","error":{"code":"open_failed","message":"no"}}\n', fatal: { code: 'open_failed', message: 'no' }, argv: ['--file=x'] });
    const out2 = await runChecks([a], fatalRun, meta(root));
    expect(out2.fatal?.code).toBe('open_failed');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
