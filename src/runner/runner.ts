import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FmCli } from './locate.ts';
import type { AdtOp, AdtOpResult, AdtFatal, AdtRunResult, AdtSummary, AdtNotice, FmTarget } from '../types.ts';

export interface RunOptions {
  dryRun: boolean;
  /** Extra environment for the child. Used by tests to drive the stub CLI. */
  env?: NodeJS.ProcessEnv;
  /** fm's default is true: one error rolls the batch back. A read batch wants
   *  false, so one refused key does not fail every other read. */
  abortOnError?: boolean;
  /** Write the ops to a temp file and pass its path instead of piping stdin. fm's
   *  documented shape for anything bigger than a couple of ops. */
  opsFile?: boolean;
  /** Pass --out=<temp> and read the result lines back from it into `stdout`. */
  outFile?: boolean;
  /** Pass --no-prompt (never open a credential window) instead of --prompt. */
  noPrompt?: boolean;
  /** Pass --timeout=<seconds>. */
  timeoutSeconds?: number;
}

/** Split the CLI's stdout and stderr into op results, summary, fatal and notices.
 *
 *  The real CLI writes op results to stdout and the summary to stderr. Scanning
 *  both streams for both kinds makes this tolerant of a future CLI change.
 *  Unparseable lines are skipped rather than thrown on: a run that produced
 *  partial output is still worth reporting.
 *
 *  A {"type":"fatal"} line is pulled out on its own rather than filed under
 *  notices: it is the ONLY thing a run that never opened the file reports, so
 *  burying it leaves the user with nothing but an exit code.
 */
export function parseResultLines(
  stdout: string,
  stderr = '',
): {
  results: AdtOpResult[];
  summary: AdtSummary | null;
  notices: AdtNotice[];
  fatal: AdtFatal | null;
} {
  const results: AdtOpResult[] = [];
  const notices: AdtNotice[] = [];
  let summary: AdtSummary | null = null;
  let fatal: AdtFatal | null = null;

  for (const line of [...stdout.split('\n'), ...stderr.split('\n')]) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (parsed.type === 'summary') {
      const { total, ok, errors, dryRun, rolledBack } = parsed as unknown as AdtSummary;
      summary = { total, ok, errors, dryRun, rolledBack };
    } else if (parsed.type === 'fatal') {
      const error = parsed.error as AdtFatal | undefined;
      // Only the first fatal is kept: the CLI ends the run on one.
      if (error && !fatal) {
        fatal = {
          code: error.code,
          message: error.message,
          ...(error.suggestions ? { suggestions: error.suggestions } : {}),
          ...(error.dbError !== undefined ? { dbError: error.dbError } : {}),
        };
      }
    } else if (typeof parsed.op === 'string') {
      results.push(parsed as unknown as AdtOpResult);
    } else if (typeof parsed.type === 'string') {
      notices.push(parsed as unknown as AdtNotice);
    }
  }

  return { results, summary, notices, fatal };
}

/** One JSON object per line, trailing newline included, which is what fm reads. */
export function opsToNdjson(ops: AdtOp[]): string {
  return ops.map((op) => JSON.stringify(op)).join('\n') + '\n';
}

/** Build the CLI's argv. Never includes --password: it is visible in the
 *  process list, so ADT reads the secret from the keychain instead.
 *
 *  --prompt is the default. fm's own default is --no-prompt, and its help says
 *  --prompt "asks for the account name too if --username was not given", so an
 *  empty account against a protected file is the case that needs the window
 *  most. A caller with nobody in front of it passes noPrompt. --username and
 *  --keychain stay gated on a non-empty account: --keychain has nothing to look
 *  a password up under without one. */
export function buildArgv(
  target: FmTarget,
  opts: RunOptions,
  paths: { ops?: string; out?: string },
): string[] {
  const argv = [`--file=${target.file}`];
  if (target.username) argv.push(`--username=${target.username}`, '--keychain');
  argv.push(opts.noPrompt ? '--no-prompt' : '--prompt');
  if (opts.dryRun) argv.push('--dry-run');
  if (opts.abortOnError === false) argv.push('--abort-on-error=false');
  if (opts.timeoutSeconds !== undefined) argv.push(`--timeout=${opts.timeoutSeconds}`);
  if (paths.out) argv.push(`--out=${paths.out}`);
  if (paths.ops) argv.push(paths.ops);
  return argv;
}

/** Apply ops to a target file, returning every result line the CLI emitted. */
export async function runOps(
  cli: FmCli,
  target: FmTarget,
  ops: AdtOp[],
  opts: RunOptions,
): Promise<AdtRunResult> {
  let dir: string | null = null;

  try {
    dir = opts.opsFile || opts.outFile ? await mkdtemp(join(tmpdir(), 'fm-adt-')) : null;
    const paths = {
      ops: opts.opsFile && dir ? join(dir, 'batch.ops.ndjson') : undefined,
      out: opts.outFile && dir ? join(dir, 'batch.out.ndjson') : undefined,
    };
    if (paths.ops) await writeFile(paths.ops, opsToNdjson(ops));
    const argv = buildArgv(target, opts, paths);

    const { code, stdout, stderr } = await spawnAndCollect(cli.path, argv, opts, paths.ops ? null : opsToNdjson(ops));
    const outText = paths.out ? await readFile(paths.out, 'utf8').catch(() => '') : '';
    const combinedStdout = outText ? outText + (stdout ? '\n' + stdout : '') : stdout;
    const { results, summary, notices, fatal } = parseResultLines(combinedStdout, stderr);
    return {
      ok: code === 0 && summary !== null && !summary.rolledBack,
      exitCode: code,
      results,
      summary,
      notices,
      ...(fatal ? { fatal } : {}),
      stderr,
      stdout: combinedStdout,
      argv,
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

function spawnAndCollect(
  bin: string,
  argv: string[],
  opts: RunOptions,
  stdinText: string | null,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { env: { ...process.env, ...opts.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    // A refused target closes stdin before an ops payload larger than the ~64 KB
    // pipe buffer is drained, and an unhandled 'error' on a stdio stream is an
    // uncaught exception. The 'close' handler already reports the exit code and
    // the CLI's own fatal, which is the real diagnosis. Do NOT rethrow here.
    child.stdin.on('error', () => {});
    if (stdinText !== null) child.stdin.write(stdinText);
    child.stdin.end();
  });
}
