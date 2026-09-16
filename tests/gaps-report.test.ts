import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderReport } from '../src/gaps/report.ts';
import { writeEvidence } from '../src/gaps/evidence.ts';
import type { SubjectEntry } from '../src/gaps/register.ts';

function verifiedEntry(root: string): SubjectEntry {
  const op = { op: 'read:layout', name: 'Home', detail: true };
  const evidence = writeEvidence(root, '0.6.0', '29816214', op, {
    command: 'fm --file=x --username=a', batch: { size: 1, position: 0 },
    stdout: [{ op: 'read:layout', status: 'ok', result: { name: 'Home', contents: { objects: [{ id: 21, type: 'field', control: 'editBox', bounds: { top: 1 } }, { id: 99, type: 'label', text: 'NOT THIS ONE' }] } } }],
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
      { name: 'tooltip', path: 'ToolTip', knownFrom: 'SaXML LayoutCatalog ToolTip', fmKey: 'tooltip', reported: false, wontfix: 'not exercised on the probe instance: this object has no tooltip' },
      { name: 'options word', path: 'Options (undecoded bits)', knownFrom: 'SaXML LayoutCatalog Options', fmKey: 'flags', reported: false, wontfix: 'meaning unknown: fm reports only the raw word' },
    ],
    firstSeen: '0.6.0', reportedToClaris: null,
    lastChecked: {
      version: '0.6.0', build: '29816214', date: '2026-09-14',
      command: 'fm --file=x --username=a', batch: { size: 1, position: 0 }, evidence,
      attributes: { top: 'reported', cond: 'absent', legacy: 'absent', tooltip: 'absent', 'options word': 'reported' }, unexplainedKeys: [],
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
    stdout: [{ op: 'read:layout', status: 'ok', result: { name: 'List', contents: { objects: [{ id: 99, foo: 'yes' }] } } }],
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
    // The SELECTED instance is inlined, not the whole response.
    expect(md).toContain('"control": "editBox"');
    expect(md).not.toContain('NOT THIS ONE');
    expect(md).toContain(`Full response: \`${entry.lastChecked!.evidence}\``);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('separates "not exercised on this instance" from what was excluded as bookkeeping', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const md = renderReport([verifiedEntry(root)], root);
    expect(md).toContain('Reported but not exercised on this instance (1): tooltip.');
    expect(md).toContain('Excluded as provenance/bookkeeping (1).');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('states the one invocation\'s command once instead of on every entry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const a = verifiedEntry(root);
    const b = { ...verifiedEntry(root), id: 'layout-object:other', kind: 'object:Other' };
    const md = renderReport([a, b], root);
    expect(md).toContain('Every probe below ran in one invocation:');
    expect(md.split('fm --file=x --username=a').length - 1).toBe(1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('elides a container another entry\'s selector owns from the inlined instance', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const whole = verifiedEntry(root);
    whole.id = 'layout'; whole.kind = 'layout'; whole.probe = { ops: [whole.probe.ops[0]] };
    const md = renderReport([whole, verifiedEntry(root)], root);
    // The layout entry probes the whole response; `contents.objects` belongs to the
    // edit-box entry's `**objects[id=21]` selector, so it is named, not repeated.
    const layoutSection = md.slice(md.indexOf('### layout'), md.indexOf('### object:Edit Box'));
    expect(layoutSection).toContain('"contents": {');
    expect(layoutSection).toContain('described by its own kind in this report');
    expect(layoutSection).not.toContain('"control": "editBox"');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('evidences a verifiedOn attribute with the one value it claims', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const entry = entryWithVerifiedOnAttribute(root);
    const md = renderReport([entry], root);
    expect(md).toMatch(/Verification of `foo` on `\*\*objects\[id=99\]` of .*: `foo` is `"yes"`/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('asks for the decode of every packed word fm reports raw', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const md = renderReport([verifiedEntry(root)], root);
    expect(md).toContain('## Packed words fm reports raw');
    expect(md).toContain('1 kinds carry a packed options word');
    expect(md).toMatch(/\| object:Edit Box \| `layout-object:edit-box` \| `flags` \|/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('opens with a per-op summary table and an index of sections', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const md = renderReport([verifiedEntry(root), unverifiedEntry], root);
    const summary = md.indexOf('## Summary');
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(md.indexOf('## read:layout'));
    expect(md).toContain('| read:layout | 2 (1 unverified) | 1 |');
    expect(md).toContain('### The biggest gaps');
    expect(md).toContain('## Sections');
    expect(md).toContain('- [read:layout](#readlayout) — 2 kinds');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('prints the reason an attribute could not be verified', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const entry = entryWithVerifiedOnAttribute(root);
    entry.lastChecked!.attributeReasons = { foo: 'container key absent: contents' };
    const md = renderReport([entry], root);
    expect(md).toContain('Attribute `foo` could not be verified: container key absent: contents');
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

  it('renders a "CLI surface since" section from an already-rendered help diff, when given one', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const md = renderReport([verifiedEntry(root)], root, { prevLabel: '0.6.0-29816214', text: '0.6.0-29816214 -> 0.7.0-29823677\n+ catalog theme' });
    expect(md).toContain('## CLI surface since 0.6.0-29816214');
    expect(md).toContain('+ catalog theme');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('omits the "CLI surface since" section when no help diff is given', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const md = renderReport([verifiedEntry(root)], root);
    expect(md).not.toContain('CLI surface since');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
