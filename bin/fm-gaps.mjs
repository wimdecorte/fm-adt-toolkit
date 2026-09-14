#!/usr/bin/env node
/** fm-gaps check --file=<target> --username=<account> [--register=<path>]
 *  fm-gaps report [--register=<path>] [--out=<path>]
 *
 *  `check` runs every probe in the register against the reference file in one
 *  read-only fm invocation, writes the evidence back into the register, and
 *  prints still-open / newly-passing / errored. It never changes `status`.
 *  `report` renders the open entries as Markdown for Claris. */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { locateFmCli, runOps } from '../dist/runner/index.js';
import { loadRegister, saveRegister, runChecks, renderReport } from '../dist/gaps/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(3).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const registerPath = args.register ? path.resolve(args.register) : path.join(ROOT, 'gaps', 'register.json');
const cmd = process.argv[2];

if (cmd === 'report') {
  const md = renderReport(loadRegister(registerPath));
  if (args.out) fs.writeFileSync(path.resolve(args.out), md); else process.stdout.write(md);
  process.exit(0);
}
if (cmd !== 'check' || !args.file || !args.username || args.username === true) {
  console.error('usage: fm-gaps check --file=<target> --username=<account> [--register=<path>]\n       fm-gaps report [--register=<path>] [--out=<path>]');
  process.exit(2);
}

const cli = await locateFmCli();
if (!cli) { console.error('fm CLI not found'); process.exit(2); }
// `--version` prints `0.6.0 (29816214)`; locate keeps the version, the build number is read here.
const build = execFileSync(cli.path, ['--version']).toString().match(/\((\d+)\)/)?.[1] ?? '';
const entries = loadRegister(registerPath);
const target = { file: args.file, username: args.username };
const run = async (ops) => runOps(cli, target, ops, {
  dryRun: false, opsFile: true, outFile: true, abortOnError: false, noPrompt: true,
  killAfterMs: 10 * 60 * 1000,
});
const out = await runChecks(entries, run, {
  version: cli.version, build, date: new Date().toISOString().slice(0, 10),
  commandFor: (argv) => ['fm', ...argv].join(' '),
});
if (out.fatal) {
  console.error(`fatal: ${out.fatal.code}: ${out.fatal.message}`);
  for (const s of out.fatal.suggestions ?? []) console.error(s);
  console.error('register not written: the run never opened the file');
  process.exit(1);
}
saveRegister(registerPath, out.entries);
const show = (label, list) => {
  console.log(`\n${label} (${list.length})`);
  for (const e of list) {
    console.log(`  ${e.id}  ${e.title}`);
    if (label.startsWith('Newly')) for (const b of e.blocks) console.log(`      unblocks ${b.app}: ${b.feature}${b.where ? ` (${b.where})` : ''}`);
  }
};
show('Still open', out.stillOpen);
show('Newly passing', out.newlyPassing);
show('Errored', out.errored);
console.log(`\nregister written: ${path.relative(process.cwd(), registerPath)}`);
process.exit(out.errored.length > 0 ? 1 : 0);
