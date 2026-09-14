import { describe, it, expect } from 'vitest';
import { renderReport } from '../src/gaps/report.ts';
import type { GapEntry } from '../src/gaps/register.ts';

const e: GapEntry = {
  id: 'catalog-theme-styles', title: 'Theme styles are not readable', area: 'catalog:layout',
  description: 'read:layout reports a theme name only.', status: 'open', firstSeen: '0.6.0',
  lastChecked: {
    version: '0.6.0', build: '29816214', date: '2026-09-14', outcome: 'open',
    command: 'fm --file=fmnet://localhost/ooe --username=admin --keychain --no-prompt --abort-on-error=false --out=/tmp/o /tmp/i',
    ops: [{ op: 'read:layout', name: 'File Open', detail: true }],
    response: { stdout: [{ op: 'read:layout', status: 'ok', result: { theme: { name: 'Apex' } } }],
                stderr: [{ type: 'summary', total: 1, ok: 1, errors: 0, dryRun: false, rolledBack: false }], exitCode: 0 },
    batch: { size: 11, position: 3 },
  },
  reportedToClaris: null, blocks: [{ app: 'inspector', feature: 'theme-moodboard' }],
  probe: { target: 'reference', ops: [{ op: 'read:layout', name: 'File Open', detail: true }], check: { kind: 'keyPresent', path: 'theme.styles' } },
};

describe('renderReport', () => {
  it('groups open entries by area with command, ops and verbatim response', () => {
    const md = renderReport([e, { ...e, id: 'x', status: 'fixed' }]);
    expect(md).toMatch(/^# fm CLI gaps/m);
    expect(md).toMatch(/## catalog:layout/);
    expect(md).toMatch(/### Theme styles are not readable/);
    expect(md).toContain('fm --file=fmnet://localhost/ooe --username=admin --keychain --no-prompt');
    expect(md).toContain('{"op":"read:layout","name":"File Open","detail":true}');
    expect(md).toContain('"theme": {');
    expect(md).not.toContain('### x');
    expect(md).toMatch(/Checked against fm 0\.6\.0 \(29816214\) on 2026-09-14/);
    expect(md).toContain('Probe 4 of 11 in one fm invocation; the summary and exit code below are the batch\'s.');
  });
});
