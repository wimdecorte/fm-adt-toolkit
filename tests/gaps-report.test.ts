import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderReport } from '../src/gaps/report.ts';
import { writeEvidence } from '../src/gaps/evidence.ts';
import type { SubjectEntry } from '../src/gaps/register.ts';

describe('renderReport', () => {
  it('renders a per-kind matrix with Not-reported and Reported sections and the evidence verbatim', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-rpt-'));
    const op = { op: 'read:layout', name: 'Home', detail: true };
    const evidence = writeEvidence(root, '0.6.0', op, {
      command: 'fm --file=x --username=a', batch: { size: 1, position: 0 },
      stdout: [{ op: 'read:layout', status: 'ok', result: { name: 'Home' } }],
      stderr: [{ type: 'summary', total: 1, ok: 1, errors: 0, dryRun: false, rolledBack: false }],
      exitCode: 0, build: '29816214', date: '2026-09-14',
    });
    const entry: SubjectEntry = {
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
    const md = renderReport([entry], root);
    expect(md).toContain('## read:layout');
    expect(md).toContain('### object:Edit Box');
    expect(md).toMatch(/\|\s*cond\s*\|.*ConditionalFormatting.*\|/);
    expect(md).toContain('SaXML LayoutCatalog ConditionalFormatting');
    expect(md).not.toContain('legacy');
    expect(md).toContain('`bounds.top`');
    expect(md).toContain(JSON.stringify(op));
    expect(md).toContain('"name": "Home"');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
