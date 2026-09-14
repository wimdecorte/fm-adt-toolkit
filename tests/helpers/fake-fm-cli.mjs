#!/usr/bin/env node
// Stub `fm` for runner tests. Behaviour is chosen by FAKE_FM_MODE.
// Reads ops from stdin so the test can assert what the runner sent.

import { appendFileSync, readFileSync } from 'node:fs';

// `--version` is answered immediately, whatever FAKE_FM_MODE is: the real CLI never
// touches stdin or an ops file for it, and locateFmCli()/bin scripts probe it before
// any op is ever sent -- reading stdin here would hang forever waiting for EOF.
if (process.argv.includes('--version')) {
  process.stdout.write('0.6.0 (29816214)\n');
  process.exit(0);
}

const mode = process.env.FAKE_FM_MODE ?? 'ok';
const opsPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
// `fatal` deliberately does NOT drain stdin: the real CLI fails to OPEN the file
// before it reads any ops, which is what leaves an ops payload larger than the
// pipe buffer to raise EPIPE in the caller.
const stdin = mode === 'fatal' ? '' : opsPath ? readFileSync(opsPath, 'utf8') : readFileSync(0, 'utf8');
const outPath = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const emitResult = (line) => (outPath ? appendFileSync(outPath, line) : process.stdout.write(line));
const dryRun = process.argv.includes('--dry-run');
const file = process.argv.find((a) => a.startsWith('--file='))?.slice(7);

if (process.env.FAKE_FM_ECHO_ARGV) {
  process.stderr.write(JSON.stringify(process.argv.slice(2)) + '\n');
}
if (process.env.FAKE_FM_ECHO_STDIN) {
  process.stderr.write(stdin);
}
if (file?.startsWith('fmnet://') && process.env.FAKE_FM_MODE !== 'no-credential-notice') {
  process.stderr.write(JSON.stringify({ type: 'credential', action: 'prompted', file }) + '\n');
}

if (mode === 'hang') {
  setTimeout(() => {}, 60_000);
} else if (mode === 'error') {
  emitResult(
    JSON.stringify({
      op: 'create:script',
      status: 'error',
      error: {
        code: 'calc_syntax_error',
        message: 'the engine refused this calculation (DBError 1204) (at /0/value)',
        details: [
          {
            code: 'calc_syntax_error',
            path: '/0/value',
            message: 'the engine refused this calculation (DBError 1204)',
            token: 'Substitute( "a" ; ',
          },
        ],
        dbError: 1204,
      },
    }) + '\n',
  );
  process.stderr.write(
    JSON.stringify({ type: 'summary', total: 1, ok: 0, errors: 1, dryRun, rolledBack: true }) + '\n',
  );
  process.exit(1);
} else if (mode === 'fatal') {
  // A run-level failure: nothing on stdout, one fatal line on stderr, exit 2.
  // Copied verbatim from `fm 0.6.0 --file=/tmp/definitely-not-here-xyz.fmp12`
  // with an op on stdin, only the path substituted.
  process.stderr.write(
    JSON.stringify({
      type: 'fatal',
      error: {
        code: 'open_failed',
        message:
          `failed to open file '${file}' (DBError 802); no file exists at that path ` +
          '(the SAME code the engine returns when a host is not sharing a file -- here ' +
          'the target is local and simply absent, so no host is involved)',
        suggestions: ['correct the path, or pass --create to make a new database there'],
        dbError: 802,
      },
    }) + '\n',
  );
  process.exit(2);
} else if (mode === 'garbage') {
  process.stdout.write('not json at all\n');
  process.exit(0);
} else if (mode === 'fixture') {
  const fixture = JSON.parse(readFileSync(process.env.FAKE_FM_FIXTURE, 'utf8'));
  const lines = stdin.trimEnd().split('\n').filter(Boolean);
  for (const line of lines) {
    const op = JSON.parse(line).op;
    emitResult(JSON.stringify({ op, status: 'ok', result: fixture }) + '\n');
  }
  process.stderr.write(
    JSON.stringify({ type: 'summary', total: lines.length, ok: lines.length, errors: 0, dryRun, rolledBack: false }) + '\n',
  );
  process.exit(0);
} else if (mode === 'read') {
  emitResult(JSON.stringify({ op: 'read:table', status: 'ok',
    result: { kind: 'table', total: 1, returned: 1, items: [{ name: 'T', id: 129 }] } }) + '\n');
  process.stderr.write(JSON.stringify({ type: 'summary', total: 1, ok: 1, errors: 0, dryRun, rolledBack: false }) + '\n');
  process.exit(0);
} else {
  const lines = stdin.trimEnd().split('\n').filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const op = JSON.parse(line).op;
    emitResult(
      JSON.stringify({
        op,
        status: dryRun ? 'dry-run' : 'ok',
        result: { name: 'API — Get Contacts', id: index + 1 },
      }) + '\n',
    );
  }
  process.stderr.write(
    JSON.stringify({
      type: 'summary',
      total: lines.length,
      ok: lines.length,
      errors: 0,
      dryRun,
      rolledBack: false,
    }) + '\n',
  );
  process.exit(0);
}
