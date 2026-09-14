import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseResultLines } from '../src/runner/runner.ts';

const dir = path.resolve(__dirname, 'fixtures/fm-0.6.0');

describe('fm 0.6.0 recorded listing', () => {
  it('parses into 18 ok results and a summary, no fatal', () => {
    const { results, summary, fatal, notices } = parseResultLines(
      fs.readFileSync(path.join(dir, 'lists.out.ndjson'), 'utf8'),
      fs.readFileSync(path.join(dir, 'lists.err.ndjson'), 'utf8'),
    );
    expect(results).toHaveLength(18);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(results.map((r) => r.op)).toContain('read:externalDataSource');
    expect(summary).toEqual({ total: 18, ok: 18, errors: 0, dryRun: false, rolledBack: false });
    expect(fatal).toBeNull();
    expect(notices.every((n) => n.type !== 'fatal')).toBe(true);
  });
});
