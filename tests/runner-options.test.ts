import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildArgv, runOps } from '../src/runner/runner.ts';
import type { FmTarget } from '../src/types.ts';

const cli = { path: join(process.cwd(), 'tests/helpers/fake-fm-cli.mjs'), version: '0.6.0', contract: 2 };
const target: FmTarget = { file: 'fmnet://localhost/ooe', username: 'admin' };

describe('buildArgv', () => {
  it('defaults match fm-ai: keychain, prompt, no abort flag', () => {
    expect(buildArgv(target, { dryRun: false }, {})).toEqual([
      '--file=fmnet://localhost/ooe', '--username=admin', '--keychain', '--prompt',
    ]);
  });
  it('adds --abort-on-error=false, --no-prompt, --timeout, --out and the ops path', () => {
    expect(buildArgv(target, { dryRun: false, abortOnError: false, noPrompt: true, timeoutSeconds: 600 },
      { ops: '/tmp/x.ops.ndjson', out: '/tmp/x.out.ndjson' })).toEqual([
      '--file=fmnet://localhost/ooe', '--username=admin', '--keychain', '--no-prompt',
      '--abort-on-error=false', '--timeout=600', '--out=/tmp/x.out.ndjson', '/tmp/x.ops.ndjson',
    ]);
  });
  it('omits username and keychain for an unprotected file', () => {
    expect(buildArgv({ file: '/tmp/a.fmp12', username: '' }, { dryRun: true }, {})).toEqual([
      '--file=/tmp/a.fmp12', '--prompt', '--dry-run',
    ]);
  });
});

describe('runOps with opsFile and outFile', () => {
  it('passes the ops as a file and reads results back from --out', async () => {
    const run = await runOps(cli, target, [{ op: 'read:table' }], {
      dryRun: false, opsFile: true, outFile: true, abortOnError: false, noPrompt: true,
      env: { FAKE_FM_MODE: 'read', FAKE_FM_ECHO_ARGV: '1' },
    });
    expect(run.ok).toBe(true);
    expect(run.results).toHaveLength(1);
    expect(run.results[0].op).toBe('read:table');
    expect(run.results[0].result).toEqual({ kind: 'table', total: 1, returned: 1, items: [{ name: 'T', id: 129 }] });
    expect(run.argv).toContain('--abort-on-error=false');
    expect(run.argv.at(-1)).toMatch(/\.ops\.ndjson$/);
    expect(run.stdout).toContain('"read:table"');
    // The echoed argv on stderr proves the fake saw an --out path, so the results
    // above came from the file the runner read back, not from stdout.
    expect(run.stderr).toMatch(/--out=/);
  });
  it('still reports a fatal when the file cannot be opened in file mode', async () => {
    const run = await runOps(cli, target, [{ op: 'read:table' }], {
      dryRun: false, opsFile: true, outFile: true, env: { FAKE_FM_MODE: 'fatal' },
    });
    expect(run.ok).toBe(false);
    expect(run.fatal?.code).toBe('open_failed');
  });
});
