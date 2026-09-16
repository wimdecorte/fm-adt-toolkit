#!/usr/bin/env node
/** fm-gaps enumerate --saxml=<dir> --prefix=<FileName> --label=<export label> [--out=<dir>]
 *  fm-gaps draft --kind=<kind-id>[,<kind-id>...] --file=<target> --username=<account> [--reference=<dir>] [--register=<path>]
 *  fm-gaps check --file=<target> --username=<account> [--register=<path>] [--verbose]
 *  fm-gaps report [--register=<path>] [--out=<path>]
 *  fm-gaps help-diff --from=<version-build> [--to=<version-build>] [--register=<path>]
 *
 *  enumerate reads a Save as XML export (never writes to it) and writes one reference
 *  file per kind: attribute paths and counts, no values. draft reads one instance of each
 *  named kind through fm and writes a first-draft entry into the register for a human to
 *  review (an existing entry with that id is left alone); it then reloads the file it just
 *  wrote and, if the register does not parse (e.g. two attributes drafted with the same
 *  name), prints the error and exits 1 -- the file is still on disk for a human to fix.
 *  check runs every distinct probe once and records evidence and per-attribute outcomes;
 *  it never edits reported/fmKey. Before probing, check also captures this build's own
 *  `fm help --json --all` under 'gaps/help/<version>-<build>.json' and prints how it
 *  differs from the previous build's -- catalogs, ops and keys, fm's own authoritative
 *  surface, rather than only what a probe happens to notice. Help changes never affect the
 *  exit code. report renders the matrix for Claris, plus the same help diff when a snapshot
 *  for the register's last-checked build exists. help-diff prints that diff for any two
 *  stored snapshots on demand. Every fm batch passes assertReadOnly. Evidence (and the
 *  report's evidence lookups) is written under '<evidenceRoot>/gaps/evidence/...', where
 *  evidenceRoot is this package's ROOT for the default register at
 *  '<ROOT>/gaps/register.json', and otherwise the register's own parent directory -- so a
 *  --register=/tmp/reg.json run writes to /tmp/gaps/evidence/... and /tmp/gaps/help/...,
 *  never into this package's own gaps/ tree. */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { locateFmCli, runOps } from '../dist/runner/index.js';
import { assertReadOnly } from '../dist/read-only.js';
import {
  loadRegister, saveRegister, runChecks, renderReport, enumerateExport, writeReferences, referenceFileName,
  KINDS, draftEntry, selectInstance, evidenceDir, fmTypeMismatch,
  captureHelpSince, helpSurfaceSince, summariseHelp, diffHelp, renderHelpDiff, writeIntake,
} from '../dist/gaps/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cmd = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const str = (k) => (typeof args[k] === 'string' && args[k] !== '' ? args[k] : null);
const registerPath = str('register') ? path.resolve(str('register')) : path.join(ROOT, 'gaps', 'register.json');
// Evidence and report lookups live at `<evidenceRoot>/gaps/evidence/...`. The default
// register sits at `<ROOT>/gaps/register.json`, so its evidence root is `ROOT`; a
// `--register=/tmp/reg.json` run has no 'gaps' directory to peel off, so its evidence
// root is /tmp itself -- never this package's own ROOT.
const evidenceRoot = path.basename(path.dirname(registerPath)) === 'gaps'
  ? path.dirname(path.dirname(registerPath))
  : path.dirname(registerPath);
const USAGE = [
  'usage: fm-gaps enumerate --saxml=<dir> --prefix=<FileName> --label=<export label> [--out=<dir>]',
  '       fm-gaps draft --kind=<kind-id>[,<kind-id>...] --file=<target> --username=<account> [--reference=<dir>] [--register=<path>]',
  '       fm-gaps check --file=<target> --username=<account> [--register=<path>] [--verbose]',
  '       fm-gaps report [--register=<path>] [--out=<path>]',
  '       fm-gaps help-diff --from=<version-build> [--to=<version-build>] [--register=<path>]',
].join('\n');
const usage = () => { console.error(USAGE); process.exit(2); };

if (cmd === 'enumerate') {
  if (!str('saxml') || !str('prefix') || !str('label')) usage();
  const refs = enumerateExport(path.resolve(str('saxml')), str('prefix'), str('label'));
  const out = str('out') ? path.resolve(str('out')) : path.join(ROOT, 'gaps', 'reference', str('label'));
  const files = writeReferences(out, refs);
  for (const r of refs) console.log(r.kindId.padEnd(36), String(r.instances.length).padStart(4), 'instances', String(r.attributes.length).padStart(4), 'paths');
  console.log(`${files.length} reference files written under ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}
if (cmd === 'report') {
  const regEntries = loadRegister(registerPath);
  // The register carries the last `check`'s own version/build; report never runs fm
  // itself, so it can only look for a snapshot already captured for that build.
  const checked = regEntries.find((e) => e.lastChecked)?.lastChecked;
  const helpSince = checked ? helpSurfaceSince(evidenceRoot, checked.version, checked.build) : null;
  const md = renderReport(regEntries, evidenceRoot, helpSince ?? undefined);
  if (str('out')) fs.writeFileSync(path.resolve(str('out')), md); else process.stdout.write(md);
  process.exit(0);
}
if (cmd === 'help-diff') {
  if (!str('from')) usage();
  const helpDir = path.join(evidenceRoot, 'gaps', 'help');
  const files = fs.existsSync(helpDir) ? fs.readdirSync(helpDir).filter((f) => f.endsWith('.json')).sort() : [];
  const toLabel = str('to') ?? (files.length ? path.basename(files[files.length - 1], '.json') : null);
  if (!toLabel) { console.error(`no stored help snapshots under ${path.relative(process.cwd(), helpDir)}`); process.exit(2); }
  const fromPath = path.join(helpDir, `${str('from')}.json`);
  const toPath = path.join(helpDir, `${toLabel}.json`);
  if (!fs.existsSync(fromPath)) { console.error(`no snapshot ${path.relative(process.cwd(), fromPath)}`); process.exit(2); }
  if (!fs.existsSync(toPath)) { console.error(`no snapshot ${path.relative(process.cwd(), toPath)}`); process.exit(2); }
  const prev = summariseHelp(JSON.parse(fs.readFileSync(fromPath, 'utf8')));
  const next = summariseHelp(JSON.parse(fs.readFileSync(toPath, 'utf8')));
  console.log(renderHelpDiff(diffHelp(prev, next), str('from'), toLabel));
  process.exit(0);
}
if ((cmd !== 'check' && cmd !== 'draft') || !str('file') || !str('username')) usage();

const cli = await locateFmCli();
if (!cli) { console.error('fm CLI not found'); process.exit(2); }
const build = execFileSync(cli.path, ['--version']).toString().match(/\((\d+)\)/)?.[1] ?? '';
const target = { file: str('file'), username: str('username') };
const run = async (ops) => { assertReadOnly(ops); return runOps(cli, target, ops, { dryRun: false, opsFile: true, outFile: true, abortOnError: false, noPrompt: true, killAfterMs: 10 * 60 * 1000 }); };
const date = new Date().toISOString().slice(0, 10);

if (cmd === 'draft') {
  if (!str('kind')) usage();
  const refDir = str('reference') ? path.resolve(str('reference')) : (() => { const d = path.join(ROOT, 'gaps', 'reference'); const labels = fs.readdirSync(d).sort(); return path.join(d, labels[labels.length - 1]); })();
  const entries = fs.existsSync(registerPath) ? loadRegister(registerPath) : [];
  const wanted = str('kind').split(',').map((k) => k.trim()).filter((k) => !entries.some((e) => e.id === k));
  const refs = wanted.map((k) => JSON.parse(fs.readFileSync(path.join(refDir, referenceFileName(k)), 'utf8')));
  const rules = Object.fromEntries(KINDS.map((r) => [r.id, r]));
  const probes = refs.map((r) => { const rule = rules[r.kindId.split(':')[0]]; if (!rule) throw new Error(`no kind rule for ${r.kindId}`); return { ref: r, probe: rule.probe(r.instances[0]) }; });
  const result = await run(probes.map((p) => p.probe.ops[0]));
  if (result.fatal) { console.error(`fatal: ${result.fatal.code}: ${result.fatal.message}`); process.exit(1); }
  probes.forEach(({ ref, probe }, i) => {
    const line = result.results[i];
    const instance = line && line.status === 'ok' ? selectInstance(line.result, probe.select) : undefined;
    if (instance === undefined) { console.error(`${ref.kindId}: probe ${JSON.stringify(probe.ops[0])} ${line ? line.status + (line.error ? ' ' + line.error.code : '') : 'no result'}; selector ${probe.select ?? '(root)'} matched nothing — drafted with every attribute unmatched`); }
    else if (ref.fmType) {
      const mismatch = fmTypeMismatch(instance, ref.fmType);
      if (mismatch) console.error(`${ref.kindId}: ${mismatch} — the drafted attributes were matched against the wrong object`);
    }
    entries.push(draftEntry(ref, ref.instances[0], probe, instance ?? {}, cli.version));
    console.log(`${ref.kindId}: ${ref.attributes.length} attributes, ${instance === undefined ? 0 : Object.values(entries[entries.length - 1].attributes).filter((a) => a.reported).length} auto-matched`);
  });
  saveRegister(registerPath, entries);
  try {
    loadRegister(registerPath);
  } catch (err) {
    console.error(`register written but does not load: ${err.message}`);
    console.error(`fix ${path.relative(process.cwd(), registerPath)} by hand (e.g. two attributes drafted with the same name) and re-run`);
    process.exit(1);
  }
  console.log(`register written: ${path.relative(process.cwd(), registerPath)} (${entries.length} entries)`);
  process.exit(0);
}

// Captured before any probe runs: help does not open the file, so this build's own
// surface is on disk even if the probe batch below turns out fatal.
const helpSince = await captureHelpSince(cli.path, evidenceRoot, cli.version, build);

const entries = loadRegister(registerPath);
const out = await runChecks(entries, run, { version: cli.version, build, date, root: evidenceRoot, commandFor: (argv) => ['fm', ...argv].join(' ') });
if (out.fatal) { console.error(`fatal: ${out.fatal.code}: ${out.fatal.message}`); for (const s of out.fatal.suggestions ?? []) console.error(s); console.error(out.fatal.code === 'batch_misaligned' ? 'register not written: the batch did not line up with the ops sent' : 'register not written: the run never opened the file'); process.exit(1); }
saveRegister(registerPath, out.entries);
// Written with the register, not with the help snapshot above: this file's one job is to
// agree with the register's own lastChecked stamps, so the fatal path that leaves the
// register alone must leave this alone too.
writeIntake(evidenceRoot, cli.version, build, date);
const verbose = args.verbose === true || args.verbose === 'true';
const show = (label, rows, fmt) => { console.log(`\n${label} (${rows.length})`); for (const r of rows) console.log('  ' + fmt(r)); };
show('Still missing', out.stillMissing, (r) => `${r.entry.id}  ${r.attribute.name}`);
show('Newly reported (set fmKey/reported by hand after reading the evidence)', out.newlyReported, (r) => `${r.entry.id}  ${r.attribute.name} -> ${r.attribute.fmKey}${r.entry.blocks.filter((b) => b.attribute === r.attribute.name).map((b) => `  unblocks ${b.app}: ${b.feature}`).join('')}`);
show('Regressed (was reported, now absent)', out.regressed, (r) => `${r.entry.id}  ${r.attribute.name} (${r.attribute.fmKey})`);
show('Unexplained keys on the instance (candidates for closing a gap)', out.unexplained, (r) => `${r.entry.id}  ${r.keys.join(', ')}`);
// Nested keys are counted rather than listed by default: they run to thousands across the
// register, and a gap closed by one of them is found by reading the counts that moved.
show('Unexplained nested keys (a gap closed by a nested key shows up only here; --verbose lists them)', out.nestedUnexplained,
  (r) => `${r.entry.id}  ${r.keys.length}${verbose ? '  ' + r.keys.join(', ') : ''}`);
show('Attribute verification errors (the row\'s own verifiedOn probe or selector failed)', out.attributeErrors,
  (r) => `${r.entry.id}  ${r.attribute.name}  ${r.reason}`);
show('Errored', out.errored, (e) => `${e.id}  ${e.lastChecked?.reason ?? ''}`);
show('Errored (expected)', out.erroredExpected, (e) => `${e.id}  ${e.lastChecked?.reason ?? ''}  [expectedError: ${e.expectedError}]`);
show('Expected failure resolved (the gap closed — review and drop expectedError)', out.expectedResolved, (e) => `${e.id}  [expectedError: ${e.expectedError}]`);
if (out.keyDiff.length) {
  console.log(`\nKeys since ${out.keyDiff[0].previous} (${out.keyDiff.length} probes changed)`);
  for (const d of out.keyDiff) {
    if (d.added.length) console.log(`  ${d.entry.id}  keys new since ${d.previous}: ${d.added.join(', ')}`);
    if (d.removed.length) console.log(`  ${d.entry.id}  keys gone since ${d.previous}: ${d.removed.join(', ')}`);
  }
} else console.log('\nKeys since the previous build (0 probes changed)');
if (helpSince) {
  console.log(`\nHelp since ${helpSince.prevLabel}`);
  console.log(helpSince.text);
} else {
  console.log('\nHelp: first snapshot, nothing to diff');
}
console.log(`\nregister written: ${path.relative(process.cwd(), registerPath)}; evidence under ${path.relative(process.cwd(), path.join(evidenceRoot, 'gaps', 'evidence', evidenceDir(cli.version, build)))}/`);
process.exit(out.errored.length > 0 || out.regressed.length > 0 || out.expectedResolved.length > 0 || out.attributeErrors.length > 0 ? 1 : 0);
