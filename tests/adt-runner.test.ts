import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseResultLines, runOps } from '../src/runner/runner.ts';
import type { FmTarget } from '../src/types.ts';

const FAKE_CLI = {
  path: join(process.cwd(), 'tests/helpers/fake-fm-cli.mjs'),
  version: '0.6.0',
  contract: 2,
};

const TARGET: FmTarget = {
  file: '/tmp/Probe.fmp12',
  username: 'admin',
};

const OPS = [{ op: 'create:script', name: 'API — Get Contacts', body: [] }];

describe('parseResultLines', () => {
  it('separates op results from the trailing summary line', () => {
    const stdout = '{"op":"create:script","status":"ok","result":{"name":"S","id":1}}\n';
    const stderr = '{"type":"summary","total":1,"ok":1,"errors":0,"dryRun":false,"rolledBack":false}\n';
    const { results, summary, notices } = parseResultLines(stdout, stderr);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(summary).toEqual({ total: 1, ok: 1, errors: 0, dryRun: false, rolledBack: false });
    expect(notices).toEqual([]);
  });

  it('treats a summary on stderr as a real summary — it is not on stdout', () => {
    const stdout = '{"op":"create:script","status":"ok","result":{"name":"S","id":1}}\n';
    const stderr = '{"type":"summary","total":1,"ok":1,"errors":0,"dryRun":false,"rolledBack":false}\n';
    const { summary } = parseResultLines(stdout, stderr);
    expect(summary).not.toBeNull();
    expect(summary?.total).toBe(1);
  });

  it('keeps an error result with its details path and token', () => {
    const stdout =
      '{"op":"create:script","status":"error","error":{"code":"calc_syntax_error",' +
      '"message":"refused","details":[{"code":"calc_syntax_error","path":"/0/value",' +
      '"message":"refused","token":"Substitute( "}],"dbError":1204}}\n';
    const { results } = parseResultLines(stdout);
    expect(results[0].error?.code).toBe('calc_syntax_error');
    expect(results[0].error?.details?.[0].path).toBe('/0/value');
    expect(results[0].error?.dbError).toBe(1204);
  });

  it('captures credential notices without counting them as op results', () => {
    const stderr =
      '{"type":"credential","action":"prompted","file":"fmnet://host/Name"}\n' +
      '{"type":"summary","total":1,"ok":1,"errors":0,"dryRun":false,"rolledBack":false}\n';
    const { results, notices } = parseResultLines('', stderr);
    expect(results).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0].type).toBe('credential');
    expect(notices[0].action).toBe('prompted');
  });

  it('ignores blank lines and unparseable lines rather than throwing', () => {
    const { results, summary, notices, fatal } = parseResultLines('not json\n\n');
    expect(results).toEqual([]);
    expect(summary).toBeNull();
    expect(notices).toEqual([]);
    expect(fatal).toBeNull();
  });

  // Verbatim `fm 0.6.0` stderr for a --file that does not exist, with an op on
  // stdin: exit 2, stdout empty, this one line.
  const FATAL_LINE =
    '{"type":"fatal","error":{"code":"open_failed","message":"failed to open file ' +
    "'/tmp/nope.fmp12' (DBError 802); no file exists at that path\",\"suggestions\":" +
    '["correct the path, or pass --create to make a new database there"],"dbError":802}}\n';

  it('pulls a fatal out on its own rather than filing it under notices', () => {
    const { results, summary, notices, fatal } = parseResultLines('', FATAL_LINE);
    expect(results).toEqual([]);
    expect(summary).toBeNull();
    // Under notices it was captured but never rendered, so the user saw nothing.
    expect(notices).toEqual([]);
    expect(fatal).toEqual({
      code: 'open_failed',
      message:
        "failed to open file '/tmp/nope.fmp12' (DBError 802); no file exists at that path",
      suggestions: ['correct the path, or pass --create to make a new database there'],
      dbError: 802,
    });
  });

  it('keeps other typed lines as notices alongside a fatal', () => {
    const stderr = '{"type":"credential","action":"prompted"}\n' + FATAL_LINE;
    const { notices, fatal } = parseResultLines('', stderr);
    expect(notices.map((n) => n.type)).toEqual(['credential']);
    expect(fatal?.code).toBe('open_failed');
  });
});

describe('runOps', () => {
  it('reports ok for a clean run and returns one result per op', async () => {
    const run = await runOps(FAKE_CLI, TARGET, OPS, { dryRun: false });
    expect(run.ok).toBe(true);
    expect(run.exitCode).toBe(0);
    expect(run.results).toHaveLength(1);
    expect(run.results[0].status).toBe('ok');
    expect(run.summary?.rolledBack).toBe(false);
  });

  it('marks results dry-run and does not report ok status when checking', async () => {
    const run = await runOps(FAKE_CLI, TARGET, OPS, { dryRun: true });
    expect(run.results[0].status).toBe('dry-run');
    expect(run.summary?.dryRun).toBe(true);
  });

  it('reports not-ok with the rollback flag when the batch is rejected', async () => {
    const run = await runOps({ ...FAKE_CLI }, TARGET, OPS, {
      dryRun: false,
      env: { FAKE_FM_MODE: 'error' },
    });
    expect(run.ok).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(run.summary?.rolledBack).toBe(true);
    expect(run.results[0].error?.details?.[0].path).toBe('/0/value');
  });

  it('passes the file and username as argv, never a shell string', async () => {
    const run = await runOps(FAKE_CLI, TARGET, OPS, {
      dryRun: false,
      env: { FAKE_FM_ECHO_ARGV: '1', FAKE_FM_MODE: 'no-credential-notice' },
    });
    const argv = JSON.parse(run.stderr.split('\n')[0]);
    expect(argv).toContain('--file=/tmp/Probe.fmp12');
    expect(argv).toContain('--username=admin');
    expect(argv).toContain('--keychain');
    expect(argv).toContain('--prompt');
  });

  it('never passes a password on the command line', async () => {
    const run = await runOps(FAKE_CLI, TARGET, OPS, {
      dryRun: false,
      env: { FAKE_FM_ECHO_ARGV: '1', FAKE_FM_MODE: 'no-credential-notice' },
    });
    expect(run.stderr).not.toContain('--password');
  });

  // The CLI's default is --no-prompt, and its help says --prompt "asks for the
  // account name too if --username was not given" — so an empty Account field is
  // exactly the case that needs the flag. Gating --prompt on a username meant a
  // protected file reported a bare authentication failure with no window shown,
  // contradicting the sheet's own hint and the README.
  it('still asks the CLI to prompt when the target has no username', async () => {
    const run = await runOps(
      FAKE_CLI,
      { ...TARGET, username: '' },
      OPS,
      { dryRun: false, env: { FAKE_FM_ECHO_ARGV: '1' } },
    );
    const argv = JSON.parse(run.stderr.split('\n')[0]);
    expect(argv).toContain('--prompt');
    // --keychain has no account to look a password up under, so it stays gated.
    expect(argv.some((a: string) => a.startsWith('--username'))).toBe(false);
    expect(argv).not.toContain('--keychain');
  });

  it('sends the ops as NDJSON on stdin', async () => {
    const run = await runOps(FAKE_CLI, TARGET, OPS, {
      dryRun: false,
      env: { FAKE_FM_ECHO_STDIN: '1', FAKE_FM_MODE: 'no-credential-notice' },
    });
    expect(run.stderr.split('\n')[0]).toBe(JSON.stringify(OPS[0]));
  });

  it('captures credential notices from hosted file authentication', async () => {
    const run = await runOps(
      FAKE_CLI,
      { ...TARGET, file: 'fmnet://host/Name' },
      OPS,
      { dryRun: false },
    );
    expect(run.notices).toHaveLength(1);
    expect(run.notices[0].type).toBe('credential');
  });

  it('does not throw on output it cannot parse', async () => {
    const run = await runOps(FAKE_CLI, TARGET, OPS, {
      dryRun: false,
      env: { FAKE_FM_MODE: 'garbage' },
    });
    expect(run.ok).toBe(false);
    expect(run.results).toEqual([]);
    expect(run.summary).toBeNull();
    expect(run.fatal).toBeUndefined();
  });

  it('surfaces a run-level fatal, the only thing a refused target reports', async () => {
    const run = await runOps(FAKE_CLI, TARGET, OPS, {
      dryRun: false,
      env: { FAKE_FM_MODE: 'fatal' },
    });
    expect(run.ok).toBe(false);
    expect(run.exitCode).toBe(2);
    expect(run.results).toEqual([]);
    expect(run.summary).toBeNull();
    expect(run.notices).toEqual([]);
    expect(run.fatal?.code).toBe('open_failed');
    expect(run.fatal?.message).toContain(TARGET.file);
    expect(run.fatal?.suggestions?.[0]).toContain('--create');
    expect(run.fatal?.dbError).toBe(802);
  });

  it('settles rather than crashing when the child closes stdin mid-write', async () => {
    // An ops payload past the ~64 KB pipe buffer against a CLI that exits before
    // reading it raises EPIPE on child.stdin. With no listener that is an uncaught
    // exception: the main process dies and this promise never settles.
    const big = [
      { op: 'create:script', name: 'Big', body: [{ stepID: 141, step: 'Set Variable', name: '$x', value: 'x'.repeat(200_000) }] },
    ];
    const run = await runOps(FAKE_CLI, TARGET, big, {
      dryRun: false,
      env: { FAKE_FM_MODE: 'fatal' },
    });
    expect(run.exitCode).toBe(2);
    expect(run.fatal?.code).toBe('open_failed');
  });
});
