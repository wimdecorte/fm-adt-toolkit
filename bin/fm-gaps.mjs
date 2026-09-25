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
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { locateFmCli, runOps } from '../dist/runner/index.js';
import { assertReadOnly } from '../dist/read-only.js';
import {
  loadRegister, saveRegister, runChecks, renderReport, enumerateExport, writeReferences, referenceFileName,
  KINDS, draftEntry, selectInstance, evidenceDir, fmTypeMismatch,
  captureHelpSince, helpSurfaceSince, summariseHelp, diffHelp, renderHelpDiff, writeIntake,
  BEHAVIOUR_SETS, diffBehaviour, renderBehaviourDiff, readOutcome,
  writeBehaviourSnapshot, previousBehaviourSnapshot, behaviourSnapshotPath,
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
  '       fm-gaps behaviour --file=<target> --username=<account> [--register=<path>] [--keep]',
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
if ((cmd !== 'check' && cmd !== 'draft' && cmd !== 'behaviour') || !str('file') || !str('username')) usage();

const cli = await locateFmCli();
if (!cli) { console.error('fm CLI not found'); process.exit(2); }
const build = execFileSync(cli.path, ['--version']).toString().match(/\((\d+)\)/)?.[1] ?? '';
const target = { file: str('file'), username: str('username') };
const run = async (ops) => { assertReadOnly(ops); return runOps(cli, target, ops, { dryRun: false, opsFile: true, outFile: true, abortOnError: false, noPrompt: true, killAfterMs: 10 * 60 * 1000 }); };
const date = new Date().toISOString().slice(0, 10);

if (cmd === 'behaviour') {
  /** THIS COMMAND WRITES, and it is the only one here that does so outside the register.
   *
   *  It creates privilege sets and accounts, probes fm as each of them, and deletes them again.
   *  That is why it cannot live inside `check`: every batch `check` sends goes through
   *  assertReadOnly, and a probe that tests a REFUSAL has to send the op that gets refused.
   *
   *  What it measures is how fm behaves toward the account asking -- which privilege a session
   *  needs, what a read does when a grant is withheld, whether two sessions may read at once.
   *  None of that is in the register or in `fm help`, so nothing else would notice it change.
   *  Findings written up in docs/fm-adt-privileges.md. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-behaviour-'));
  /** Probe accounts are authenticated with --password, which IS visible in the process list --
   *  the one place this repo accepts that, because --store-credentials needs a human at a prompt
   *  and these accounts exist for seconds. Passwords are random per run and never stored. */
  const fmRun = (username, password, ops, extraArgs = []) => {
    const opsPath = path.join(tmp, `ops-${randomBytes(4).toString('hex')}.ndjson`);
    fs.writeFileSync(opsPath, ops.map((o) => JSON.stringify(o)).join('\n') + '\n');
    const argv = [`--file=${target.file}`, `--username=${username}`,
      password ? `--password=${password}` : '--keychain',
      '--no-prompt', '--abort-on-error=false', ...extraArgs, opsPath];
    const r = spawnSync(cli.path, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return ((r.stdout ?? '') + (r.stderr ?? '')).split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((d) => d && d.type !== 'plugins');
  };
  const asOwner = (ops, extra) => fmRun(target.username, null, ops, extra);
  const errToken = (e) => `${e?.code ?? 'unknown'}${e?.dbError ? '/' + e.dbError : ''}`;
  const token = (line) => {
    if (!line) return 'no-result';
    if (line.type === 'fatal') return `FATAL ${errToken(line.error)}`;
    if (line.status === 'dry-run') return 'allowed';
    if (line.status === 'ok') return 'ok';
    return errToken(line.error);
  };
  const countReal = (items) => (items ?? []).reduce((n, i) =>
    n + (i.type === 'folder' || i.type === 'separator' ? 0 : 1) + countReal(i.items), 0);
  /** A read's token is its relationship to what THIS RUN saw as the calling [Full Access] account,
   *  never a count: see readOutcome. `owner` is absent for a catalog no grant filters, and the
   *  plain token is then enough. */
  const readToken = (line, owner) => {
    if (!line || line.type === 'fatal' || line.status !== 'ok') return token(line);
    if (!owner) return 'ok';
    return readOutcome(owner, { total: line.result?.total ?? 0, items: countReal(line.result?.items) });
  };
  const first = (lines, op) => lines.find((l) => l.op === op) ?? lines.find((l) => l.type === 'fatal');

  const results = {};
  const created = { accounts: [], sets: [] };
  /** Probe passwords live here for the life of this run only -- never on the exported set data,
   *  which is shared and must not carry a secret. */
  const passwords = new Map();
  let fmappBefore = null;
  try {
    // ---- discover what this file offers, as the caller's own account
    const disco = asOwner([{ op: 'read:layout' }, { op: 'read:table' },
      { op: 'read:script' }, { op: 'read:valueList' },
      { op: 'read:extendedPrivilege' }, { op: 'read:extendedPrivilege', name: 'fmapp' },
      { op: 'validate:calculation', calculation: 'BE_Version', references: true },
      { op: 'validate:calculation', calculation: 'External ( "BE_Version" ; "" )', references: true }]);
    const fatal = disco.find((l) => l.type === 'fatal');
    if (fatal) { console.error(`fatal: ${errToken(fatal.error)}: ${fatal.error?.message ?? ''}`); process.exit(1); }
    const layoutsLine = disco.find((l) => l.op === 'read:layout');
    const flatten = (items) => (items ?? []).flatMap((i) => i.type === 'folder' || i.type === 'separator' ? flatten(i.items) : [i.name]);
    const firstLayout = flatten(layoutsLine?.result?.items)[0];
    const firstTable = flatten(disco.find((l) => l.op === 'read:table')?.result?.items)[0];
    if (!firstLayout || !firstTable) { console.error('the calling account can see no layout or no table; nothing to probe against'); process.exit(2); }
    /** What [Full Access] sees, per filtered catalog, measured in the same run so the comparison
     *  cannot drift against a stale figure. */
    const ownerCounts = {};
    for (const op of ['read:layout', 'read:script', 'read:valueList']) {
      const line = disco.find((l) => l.op === op);
      if (line?.status === 'ok') ownerCounts[op] = { total: line.result?.total ?? 0, items: countReal(line.result?.items) };
    }
    const xpLine = disco.filter((l) => l.op === 'read:extendedPrivilege');
    results['extendedPrivilege:keywords'] = (xpLine[0]?.result?.items ?? []).map((i) => i.name).sort().join(',');
    fmappBefore = xpLine[1]?.result ?? null;
    const vLines = disco.filter((l) => l.op === 'validate:calculation');
    results['plugin:validate-plugin-function'] = vLines[0]?.result ? `valid=${vLines[0].result.valid}` : token(vLines[0]);
    results['plugin:validate-External'] = vLines[1]?.result?.valid === undefined ? token(vLines[1]) : `valid=${vLines[1].result.valid}`;

    // ---- the lock: two read-only batches at once, from the caller's own account
    // Long enough that two runs genuinely overlap: a single fast op can finish before the
    // other starts, which looks like permitted concurrency whether or not it is.
    const readBatch = Array.from({ length: 6 }, () => ({ op: 'read:layout', detail: true }));
    const spawnRead = () => new Promise((resolve) => {
      const opsPath = path.join(tmp, `lock-${randomBytes(4).toString('hex')}.ndjson`);
      fs.writeFileSync(opsPath, readBatch.map((o) => JSON.stringify(o)).join('\n') + '\n');
      const c = spawn(cli.path, [`--file=${target.file}`, `--username=${target.username}`, '--keychain',
        '--no-prompt', '--abort-on-error=false', opsPath], { encoding: 'utf8' });
      let buf = '';
      c.stdout.on('data', (d) => { buf += d; }); c.stderr.on('data', (d) => { buf += d; });
      c.on('close', () => resolve(buf));
    });
    // fm names the holder in `lockedBy`, which is what makes this probe trustworthy: a 303 whose
    // holder is another `fm CLI` session is fm serialising itself, and a 303 held by a FileMaker Pro
    // user is someone with Manage > Database open. Those are different facts and only the first is
    // about fm. Reading a bare 303 as "fm serialises reads" cost a wrong conclusion once.
    //
    // Up to three attempts, and one clean pair settles it: both succeeding proves concurrency is
    // permitted, while a refusal only describes that moment.
    let lockToken = null;
    for (let attempt = 0; attempt < 3 && lockToken !== 'both-succeeded'; attempt += 1) {
      const pair = await Promise.all([spawnRead(), spawnRead()]);
      const held = pair.map((o) => o.match(/"lockedBy":\s*\[([^\]]*)\]/)).find(Boolean);
      const blocked = pair.some((o) => /"dbError":\s*303|"code":\s*"locked"/.test(o));
      if (!blocked) { lockToken = 'both-succeeded'; break; }
      lockToken = /fm CLI/.test(held?.[1] ?? '') ? 'locked/303 by=fm-cli' : 'locked/303 by=other-client';
    }
    if (lockToken === 'locked/303 by=other-client') {
      console.error('note: concurrent reads were refused, and the holder is NOT another fm session --');
      console.error('      something else holds the schema (a FileMaker Pro window on Manage > Database');
      console.error('      or Manage > Security will). Close it and re-run before trusting this row.');
    }
    results['lock:concurrent-reads'] = lockToken;

    // ---- refuse to touch anything already named like a probe object
    const setsNow = asOwner([{ op: 'read:privilegeSet' }, { op: 'read:account' }]);
    const haveSets = new Set((setsNow.find((l) => l.op === 'read:privilegeSet')?.result?.items ?? []).map((i) => i.name));
    const haveAccts = new Set((setsNow.find((l) => l.op === 'read:account')?.result?.items ?? []).map((i) => i.name));
    const clash = BEHAVIOUR_SETS.filter((b) => haveSets.has(b.setName) || haveAccts.has(b.accountName));
    if (clash.length) {
      console.error(`refusing to run: ${clash.map((c) => c.setName).join(', ')} already exist in this file.`);
      console.error('delete them first -- this command will not reuse or modify objects it did not create.');
      process.exit(2);
    }

    // ---- provision: one set + one account each, random password per run
    for (const b of BEHAVIOUR_SETS) {
      const secret = `adtprobe${randomBytes(8).toString('hex')}`;
      const mk = asOwner([
        { op: 'create:privilegeSet', name: b.setName, description: `TEMPORARY (fm-gaps behaviour): ${b.description}`, ...b.body(firstLayout) },
        { op: 'create:account', name: b.accountName, privilegeSet: b.setName, password: secret, enabled: true, description: 'TEMPORARY (fm-gaps behaviour)' },
      ]);
      const setOk = mk.find((l) => l.op === 'create:privilegeSet')?.status === 'ok';
      const acctOk = mk.find((l) => l.op === 'create:account')?.status === 'ok';
      if (setOk) created.sets.push(b.setName);
      if (acctOk) created.accounts.push(b.accountName);
      if (!setOk || !acctOk) {
        console.error(`could not provision ${b.setName}: ${JSON.stringify(mk.map((l) => l.error).filter(Boolean))}`);
        continue;
      }
      passwords.set(b.key, secret);
    }
    // fmapp gates connection, and its grant list REPLACES rather than appends -- so send the
    // holders it already had plus the probe sets, or the existing ones lose access.
    const keep = fmappBefore?.privilegeSets ?? [];
    asOwner([{ op: 'update:extendedPrivilege', name: 'fmapp', sharing: 'specified', privilegeSets: [...keep, ...created.sets] }]);

    // ---- probe, per set
    const probes = {
      'developer-only': (T, L) => [
        ['read:table', { op: 'read:table' }], ['read:layout', { op: 'read:layout' }],
        ['read:script', { op: 'read:script' }], ['read:valueList', { op: 'read:valueList' }],
        ['read:account', { op: 'read:account' }], ['read:privilegeSet', { op: 'read:privilegeSet' }],
        ['create:table', { op: 'create:table', name: 'ADT_Probe_T' }],
        ['create:layout', { op: 'create:layout', name: 'ADT_Probe_L', tableOccurrence: T }],
        ['create:script', { op: 'create:script', name: 'ADT_Probe_S', body: [] }],
        ['create:valueList', { op: 'create:valueList', name: 'ADT_Probe_V', type: 'custom', values: ['a'] }],
        ['create:theme', { op: 'create:theme', displayName: 'ADT_Probe_Th' }],
        ['create:customMenu', { op: 'create:customMenu', name: 'ADT_Probe_CM' }],
        ['create:extendedPrivilege', { op: 'create:extendedPrivilege', name: 'ADTProbeXP' }],
      ],
      'all-privileges': (T) => [
        ['read:layout', { op: 'read:layout' }], ['read:account', { op: 'read:account' }],
        ['read:privilegeSet', { op: 'read:privilegeSet' }],
        ['create:layout', { op: 'create:layout', name: 'ADT_Probe_L', tableOccurrence: T }],
        ['create:script', { op: 'create:script', name: 'ADT_Probe_S', body: [] }],
        ['create:valueList', { op: 'create:valueList', name: 'ADT_Probe_V', type: 'custom', values: ['a'] }],
        ['create:theme', { op: 'create:theme', displayName: 'ADT_Probe_Th' }],
      ],
      'layouts-only': () => [
        ['create:theme', { op: 'create:theme', displayName: 'ADT_Probe_Th' }],
        ['create:script', { op: 'create:script', name: 'ADT_Probe_S', body: [] }],
      ],
      'one-layout': () => [['read:layout', { op: 'read:layout' }]],
    };
    for (const b of BEHAVIOUR_SETS) {
      const pw = passwords.get(b.key);
      if (!pw) continue;
      if (b.key === 'no-developer-privilege') {
        const lines = fmRun(b.accountName, pw, [{ op: 'read:table' }]);
        results['no-developer-privilege:open'] = token(lines.find((l) => l.type === 'fatal') ?? first(lines, 'read:table'));
        continue;
      }
      const plan = probes[b.key]?.(firstTable, firstLayout) ?? [];
      // Writes are dry-run: the refusal is the measurement, and a committed probe object would
      // have to be cleaned out of the file afterwards.
      const reads = plan.filter(([id]) => id.startsWith('read:'));
      const writes = plan.filter(([id]) => !id.startsWith('read:'));
      if (reads.length) {
        const lines = fmRun(b.accountName, pw, reads.map(([, op]) => op));
        const fat = lines.find((l) => l.type === 'fatal');
        reads.forEach(([id, op]) => {
          const line = fat ?? lines.filter((l) => l.op === op.op)[0];
          results[`${b.key}:${id}`] = readToken(line, ownerCounts[op.op]);
        });
      }
      if (writes.length) {
        const lines = fmRun(b.accountName, pw, writes.map(([, op]) => op), ['--dry-run']);
        const fat = lines.find((l) => l.type === 'fatal');
        writes.forEach(([id, op]) => {
          results[`${b.key}:${id}`] = token(fat ?? lines.filter((l) => l.op === op.op)[0]);
        });
      }
    }
  } finally {
    // ---- teardown, always. fmapp must give the probe sets up BEFORE they can be deleted, or
    // the delete answers dbError 8406.
    if (fmappBefore) {
      asOwner([{ op: 'update:extendedPrivilege', name: 'fmapp', sharing: fmappBefore.sharing ?? 'specified', privilegeSets: fmappBefore.privilegeSets ?? [] }]);
    }
    // THREE batches, and the order is not cosmetic. An account must be GONE before its privilege
    // set can be deleted, and "gone" means committed: deleting both in one batch answers
    // dbError 8406 on the set, because the account is still there when that op is applied.
    const left = [];
    if (created.accounts.length) {
      left.push(...asOwner(created.accounts.map((name) => ({ op: 'delete:account', name }))).filter((l) => l.status === 'error'));
    }
    if (created.sets.length) {
      left.push(...asOwner(created.sets.map((name) => ({ op: 'delete:privilegeSet', name }))).filter((l) => l.status === 'error'));
    }
    if (left.length) {
      console.error('\nCLEANUP INCOMPLETE -- these objects are still in the file and must be removed by hand:');
      for (const l of left) console.error(`  ${l.op} ${errToken(l.error)}`);
      console.error('  revoke fmapp from the set first, then delete the account, then the set.');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const snapshot = { version: cli.version, build, date, results };
  const prev = previousBehaviourSnapshot(evidenceRoot, cli.version, build);
  writeBehaviourSnapshot(evidenceRoot, snapshot);
  const prevLabel = prev ? evidenceDir(prev.version, prev.build) : '(no earlier snapshot)';
  console.log(`\nBehaviour since ${prevLabel}`);
  console.log(renderBehaviourDiff(diffBehaviour(prev, snapshot), prevLabel, evidenceDir(cli.version, build)));
  console.log(`\nsnapshot written: ${path.relative(process.cwd(), behaviourSnapshotPath(evidenceRoot, cli.version, build))}`);
  console.log('behaviour changes never affect the exit code; read them and decide.');
  process.exit(0);
}

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
/** The command each evidence file says produced it -- so it has to name the binary that DID.
 *  This used to hardcode the word `fm`, which stopped being true when 0.8.0 renamed the
 *  launcher: every 0.8.0 evidence file already on disk opens with a command whose first word
 *  is not installed on the machine that wrote it. Quoted when the path has a space, because
 *  the resolved path is usually the one under `Application Support`. */
const shellWord = (word) => (/[\s'"]/.test(word) ? `'${word.replaceAll("'", `'\\''`)}'` : word);
const out = await runChecks(entries, run, { version: cli.version, build, date, root: evidenceRoot, commandFor: (argv) => [shellWord(cli.path), ...argv].join(' ') });
if (out.fatal) { console.error(`fatal: ${out.fatal.code}: ${out.fatal.message}`); for (const s of out.fatal.suggestions ?? []) console.error(s); console.error(out.fatal.code === 'batch_misaligned' ? 'register not written: the batch did not line up with the ops sent' : 'register not written: the run never opened the file'); process.exit(1); }
saveRegister(registerPath, out.entries);
// Written with the register, not with the help snapshot above: this file's one job is to
// agree with the register's own lastChecked stamps, so the fatal path that leaves the
// register alone must leave this alone too.
writeIntake(evidenceRoot, cli.version, build, date, cli.path);
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
