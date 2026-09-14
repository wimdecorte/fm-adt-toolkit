import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderReport } from '../src/gaps/report.ts';
import { writeEvidence } from '../src/gaps/evidence.ts';
import type { SubjectEntry } from '../src/gaps/register.ts';

function verifiedEntry(root: string): SubjectEntry {
  const op = { op: 'read:layout', name: 'Home', detail: true };
  const evidence = writeEvidence(root, '0.6.0', '29816214', op, {
    command: 'fm --file=x --username=a', batch: { size: 1, position: 0 },
    stdout: [{ op: 'read:layout', status: 'ok', result: { name: 'Home' } }],
    stderr: [{ type: 'summary', total: 1, ok: 1, errors: 0, dryRun: false, rolledBack: false }],
    exitCode: 0, date: '2026-09-14',
  });
  return {
    id: 'layout-object:edit-box', op: 'read:layout', kind: 'object:Edit Box',
    probe: { ops: [op], select: '**objects[id=21]' },
    attributes: [
      { name: 'top', path: 'Bounds@top', knownFrom: 'SaXML LayoutCatalog Bounds@top', fmKey: 'bounds.top', reported: true },
      { name: 'cond', path: 'ConditionalFormatting', knownFrom: 'SaXML LayoutCatalog ConditionalFormatting', fmKey: null, reported: false },
      { name: 'legacy', path: 'Legacy@flag', knownFrom: 'SaXML LayoutCatalog Legacy@flag', fmKey: null, reported: false, wontfix: 'export artifact, never a live attribute' },
    ],
    firstSeen: '0.6.0', reportedToClaris: null,
    lastChecked: {
      version: '0.6.0', build: '29816214', date: '2026-09-14',
      command: 'fm --file=x --username=a', batch: { size: 1, position: 0 }, evidence,
      attributes: { top: 'reported', cond: 'absent', legacy: 'absent' }, unexplainedKeys: [],
    },
    blocks: [],
  };
}

const unverifiedEntry: SubjectEntry = {
  id: 'layout-object:button', op: 'read:layout', kind: 'object:Button',
  probe: { ops: [{ op: 'read:layout', name: 'Home', detail: true }], select: '**objects[id=99]' },
  attributes: [
    { name: 'style', path: 'Style@name', knownFrom: 'SaXML LayoutCatalog Style@name', fmKey: null, reported: false },
  ],
  firstSeen: '0.6.0', reportedToClaris: null, lastChecked: null, blocks: [],
};

const erroredEntry: SubjectEntry = {
  id: 'layout-object:portal', op: 'read:layout', kind: 'object:Portal',
  probe: { ops: [{ op: 'read:layout', name: 'Home', detail: true }], select: '**objects[id=77]' },
  attributes: [
    { name: 'source', path: 'Source@table', knownFrom: 'SaXML LayoutCatalog Source@table', fmKey: null, reported: false },
  ],
  firstSeen: '0.6.0', reportedToClaris: null,
  lastChecked: {
    version: '0.6.0', build: '29816214', date: '2026-09-14',
    command: 'fm --file=x --username=a', batch: { size: 1, position: 0 }, evidence: 'gaps/evidence/0.6.0-29816214/missing.ndjson',
    attributes: { source: 'error' }, unexplainedKeys: [], reason: 'selector **objects[id=77] matched nothing',
  },
  blocks: [],
};

function entryWithVerifiedOnAttribute(root: string): SubjectEntry {
  const op = { op: 'read:layout', name: 'Home', detail: true };
  const otherOp = { op: 'read:layout', name: 'List', detail: true };
  const evidence = writeEvidence(root, '0.6.0', '29816214', op, {
    command: 'fm --file=x --username=a', batch: { size: 2, position: 0 },
    stdout: [{ op: 'read:layout', status: 'ok', result: { name: 'Home' } }],
    stderr: [{ type: 'summary', total: 2, ok: 2, errors: 0, dryRun: false, rolledBack: false }],
    exitCode: 0, date: '2026-09-14',
  });
  const otherEvidence = writeEvidence(root, '0.6.0', '29816214', otherOp, {
    command: 'fm --file=x --username=a', batch: { size: 2, position: 1 },
    stdout: [{ op: 'read:layout', status: 'ok', result: { name: 'List' } }],
    stderr: [{ type: 'summary', total: 2, ok: 2, errors: 0, dryRun: false, rolledBack: false }],
    exitCode: 0, date: '2026-09-14',
  });
  return {
    id: 'layout-object:verified', op: 'read:layout', kind: 'object:Verified',
    probe: { ops: [op], select: '**objects[id=21]' },
    attributes: [
      { name: 'foo', path: 'Foo', knownFrom: 'SaXML LayoutCatalog Foo', fmKey: 'foo', reported: true, verifiedOn: { ops: [otherOp], select: '**objects[id=99]' } },
    ],
    firstSeen: '0.6.0', reportedToClaris: null,
    lastChecked: {
      version: '0.6.0', build: '29816214', date: '2026-09-14',
      command: 'fm --file=x --username=a', batch: { size: 2, position: 0 }, evidence,
      attributes: { foo: 'reported' }, attributeEvidence: { foo: otherEvidence }, unexplainedKeys: [],
    },
    blocks: [],
  };
}

describe('renderReport', () => {
  it('renders a per-kind matrix with Not-reported and Reported sections and the evidence verbatim', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const entry = verifiedEntry(root);
    const md = renderReport([entry], root);
    expect(md).toContain('## read:layout');
    expect(md).toContain('### object:Edit Box');
    expect(md).toMatch(/\|\s*cond\s*\|.*ConditionalFormatting.*\|/);
    expect(md).toContain('SaXML LayoutCatalog ConditionalFormatting');
    expect(md).not.toContain('legacy');
    expect(md).toContain('`bounds.top`');
    expect(md).toContain(JSON.stringify(entry.probe.ops[0]));
    expect(md).toContain('"name": "Home"');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('counts "not reported" only from verified entries, and calls out kinds not yet verified', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const entry = verifiedEntry(root);   // 1 missing attribute ('cond'), verified
    const md = renderReport([entry, unverifiedEntry, erroredEntry], root);
    // 3 kinds total, but only the verified entry's 1 missing attribute counts as a gap.
    expect(md).toContain('3 kinds, 1 attributes not reported.');
    // the unverified entry and the errored one are both "not yet verified" (2 of 3 kinds).
    expect(md).toContain('2 kinds not yet verified.');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('heads an unverified kind\'s section with "Not yet verified against fm" before its table', () => {
    const md = renderReport([unverifiedEntry], '/unused');
    expect(md).toMatch(/### object:Button\n\nRegister id:.*\n\nNot yet verified against fm\.\n\n\*\*Not reported\*\*/);
  });

  it('heads an errored kind\'s section with "Not yet verified against fm" too', () => {
    const md = renderReport([erroredEntry], '/unused');
    expect(md).toMatch(/### object:Portal\n\nRegister id:.*\n\nNot yet verified against fm\.\n\n\*\*Not reported\*\*/);
  });

  it('prints "(verified on <select> of <op>)" after a verifiedOn attribute', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const entry = entryWithVerifiedOnAttribute(root);
    const md = renderReport([entry], root);
    const op = JSON.stringify(entry.attributes[0].verifiedOn!.ops[0]);
    expect(md).toContain(`(verified on ${entry.attributes[0].verifiedOn!.select} of ${op})`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not head a verified kind\'s section with "Not yet verified against fm"', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const md = renderReport([verifiedEntry(root)], root);
    expect(md).not.toContain('Not yet verified against fm');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
