import fs from 'node:fs';
import path from 'node:path';
import type { AdtFatal, AdtOp, AdtRunResult } from '../types.ts';
import { selectInstance, selectorContainer, selectorFailure } from './select.ts';
import { flattenKeys } from './match.ts';
import { probeId, writeEvidence, readEvidence, previousEvidenceDir, evidenceDir } from './evidence.ts';
import { fmTypeMismatch } from './draft.ts';
import { captureHelp, helpSnapshotPath, writeHelpSnapshot, previousHelpSnapshot } from './help-snapshot.ts';
import { summariseHelp, diffHelp, renderHelpDiff } from './help-diff.ts';
import type { HelpJson } from './help-diff.ts';
import type { Attribute, Probe, SubjectEntry, SubjectEvidence } from './register.ts';

export interface CheckOutcome {
  entries: SubjectEntry[];
  stillMissing: Array<{ entry: SubjectEntry; attribute: Attribute }>;
  newlyReported: Array<{ entry: SubjectEntry; attribute: Attribute }>;
  regressed: Array<{ entry: SubjectEntry; attribute: Attribute }>;
  unexplained: Array<{ entry: SubjectEntry; keys: string[] }>;
  /** Errored entries whose reason no `expectedError` accepts: the ones that raise the exit code. */
  errored: SubjectEntry[];
  /** Errored entries whose `expectedError` accepts the reason: recorded, not raised. */
  erroredExpected: SubjectEntry[];
  /** Entries carrying an `expectedError` whose probe now succeeds: the gap closed, which
   *  is news and raises the exit code so nobody misses it. */
  expectedResolved: SubjectEntry[];
  /** The same list at every depth: what a nested key closing a gap would show up in. */
  nestedUnexplained: Array<{ entry: SubjectEntry; keys: string[] }>;
  /** Per probe, the keys fm's answer gained and lost since the previous build's evidence. */
  keyDiff: Array<{ entry: SubjectEntry; previous: string; added: string[]; removed: string[] }>;
  /** An attribute whose own `verifiedOn` probe or selector failed: the attribute was not
   *  verified at all this run, which is a broken register row rather than a fact about fm,
   *  so it is surfaced and raises the exit code. */
  attributeErrors: Array<{ entry: SubjectEntry; attribute: Attribute; reason: string }>;
  fatal?: AdtFatal;
}

function parseLines(text: string): unknown[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { unparseable: l }; } });
}

/** `key` is a dotted path, a `[]` segment marking an array to search. On a `[]` segment,
 *  the remainder of the key (evaluated on each array element in turn) counts as present
 *  if ANY element carries it — a key seen only on a later element (e.g. `parameter` on
 *  the second of two `scriptTriggers`) is still reported, not just the first element's. */
function hasKey(instance: unknown, key: string): boolean {
  const parts = key.split('.');
  const step = (cur: unknown, i: number): boolean => {
    if (i === parts.length) return true;
    const part = parts[i];
    if (part.endsWith('[]')) {
      const v = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part.slice(0, -2)] : undefined;
      if (!Array.isArray(v)) return false;
      return v.some((x) => x && typeof x === 'object' && step(x, i + 1));
    }
    if (cur === null || typeof cur !== 'object' || !(part in (cur as Record<string, unknown>))) return false;
    return step((cur as Record<string, unknown>)[part], i + 1);
  };
  return step(instance, 0);
}

/** Every value `key` reaches on the instance: one value for a plain dotted path, and one
 *  per matching element for a path with a `[]` segment. */
function valuesAt(instance: unknown, key: string): unknown[] {
  const parts = key.split('.');
  const out: unknown[] = [];
  const step = (cur: unknown, i: number): void => {
    if (i === parts.length) { out.push(cur); return; }
    const part = parts[i];
    if (part.endsWith('[]')) {
      const v = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part.slice(0, -2)] : undefined;
      if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object') step(x, i + 1);
      return;
    }
    if (cur === null || typeof cur !== 'object' || !(part in (cur as Record<string, unknown>))) return;
    step((cur as Record<string, unknown>)[part], i + 1);
  };
  step(instance, 0);
  return out;
}

/** Whether fm reports this attribute on this instance: the fmKey is present, and -- when
 *  the row carries an `expect` -- the value says what the row claims. Several rows share
 *  one key (28 layout option rows all read `flags.set`), so presence alone would report
 *  every one of them the moment any single flag is set. */
function isReported(instance: unknown, a: Attribute): boolean {
  if (!a.fmKey || !hasKey(instance, a.fmKey)) return false;
  if (!a.expect) return true;
  return valuesAt(instance, a.fmKey).some((v) => Array.isArray(v) && v.some((x) => x === a.expect!.contains));
}

/** The dotted prefixes of a key, array markers stripped: 'bounds.top' -> ['bounds', 'bounds.top']. A
 *  claimed fmKey claims its own parents too, so a nested attribute under it never shows up as an
 *  unexplained top-level key. */
function prefixesOf(key: string): string[] {
  const parts = key.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.').replace(/\[\]$/, ''));
}

/** A flattened key with its array markers dropped: `scriptTriggers[].parameter` and
 *  `scriptTriggers.parameter` are the same key, and the two sides of every set below
 *  (instance keys, claimed fmKeys, ignoreKeys) are written both ways in practice. */
function normaliseArrayMarkers(key: string): string {
  return key.replace(/\[\]/g, '');
}

/** Every key under `container` -- and the container itself -- belongs to whichever entry's
 *  selector addresses it, not to the entry that happens to probe the whole response. A
 *  plain container is a dotted prefix; a `**` container is a segment name at any depth,
 *  since that is exactly what the selector searches for. */
function ownedBySelector(key: string, prefixes: Set<string>, deepSegments: Set<string>): boolean {
  for (const p of prefixes) if (key === p || key.startsWith(p + '.')) return true;
  if (deepSegments.size) for (const seg of key.split('.')) if (deepSegments.has(seg)) return true;
  return false;
}

/** Entries that probe the exact same instance (same op AND the same select) share what
 *  explains it: `unexplainedKeys` is a property of the instance, not of any one entry
 *  that happens to describe part of it. */
function groupKeyOf(entry: SubjectEntry): string {
  return `${probeId(entry.probe.ops[0])}|${entry.probe.select ?? ''}`;
}

/** Every DISTINCT probe op runs once, in one fm invocation. Each entry's instance is
 *  selected from its probe's result; every attribute is evaluated by its fmKey. The
 *  checker never edits `reported` or `fmKey`; it reports what it saw. */
export async function runChecks(
  entries: SubjectEntry[],
  run: (ops: AdtOp[]) => Promise<AdtRunResult>,
  meta: { version: string; build: string; date: string; root: string; commandFor: (argv: string[]) => string },
): Promise<CheckOutcome> {
  const distinct = new Map<string, AdtOp>();
  for (const e of entries) {
    distinct.set(probeId(e.probe.ops[0]), e.probe.ops[0]);
    // An attribute's own `verifiedOn` op joins the same distinct-probe batch (deduped by
    // probeId, same as every entry probe), so it runs in the one fm invocation too.
    for (const a of e.attributes) if (a.verifiedOn) distinct.set(probeId(a.verifiedOn.ops[0]), a.verifiedOn.ops[0]);
  }
  const ids = [...distinct.keys()];
  const ops = ids.map((id) => distinct.get(id)!);
  const result = await run(ops);
  const noOutcome = (fatal: AdtFatal): CheckOutcome =>
    ({ entries, stillMissing: [], newlyReported: [], regressed: [], unexplained: [], errored: [], erroredExpected: [], expectedResolved: [], attributeErrors: [], nestedUnexplained: [], keyDiff: [], fatal });
  if (result.fatal) return noOutcome(result.fatal);
  // Every probe is read back by POSITION, so a batch whose lines do not line up with the
  // ops sent would score each entry against some other entry's instance. Nothing is
  // written -- no evidence, no outcomes, no register -- and the caller is told the counts.
  if (result.results.length !== ops.length || (result.summary && result.summary.total !== ops.length)) {
    return noOutcome({
      code: 'batch_misaligned',
      message: `${ops.length} ops sent, ${result.results.length} result lines, summary total ${result.summary ? result.summary.total : '(none)'}`,
    });
  }
  const stderrLines = parseLines(result.stderr);
  const command = meta.commandFor(result.argv);

  const evidenceFor = new Map<string, string>();
  ids.forEach((id, i) => {
    const line = result.results[i];
    evidenceFor.set(id, writeEvidence(meta.root, meta.version, meta.build, ops[i], {
      command, batch: { size: ops.length, position: i }, date: meta.date,
      stdout: line ? [line] : [], stderr: stderrLines, exitCode: result.exitCode,
    }));
  });

  // One probe -> its resolved instance, or the reason it has none. Shared by an entry's
  // own probe and by any attribute's `verifiedOn` probe, so both resolve the same way.
  const resolveProbe = (probe: Probe): { pos: number; reason?: string; instance: unknown } => {
    const pos = ids.indexOf(probeId(probe.ops[0]));
    const line = result.results[pos];
    let reason: string | undefined;
    let instance: unknown;
    if (!line) reason = `no result line for probe at position ${pos}`;
    else if (line.op !== probe.ops[0].op) reason = `result op ${line.op} does not match probe op ${probe.ops[0].op} at position ${pos}`;
    else if (line.status !== 'ok') reason = `probe refused: ${line.error?.code ?? line.status}`;
    else {
      instance = selectInstance(line.result, probe.select);
      if (instance === undefined) {
        if (!probe.select) reason = 'probe returned no result body';
        else {
          const f = selectorFailure(line.result, probe.select);
          reason = f.kind === 'container-absent'
            ? `container key absent: ${f.container}`
            : `container present, selector matched nothing: ${probe.select}`;
        }
      }
    }
    return { pos, reason, instance };
  };

  // Resolve each entry's instance (or the reason it has none) up front, so entries
  // sharing an instance can share what explains it.
  const instances = new Map<SubjectEntry, { pos: number; reason?: string; instance: unknown }>();
  for (const entry of entries) {
    const r = resolveProbe(entry.probe);
    // A selector that found SOMETHING of the wrong kind is worse than one that found
    // nothing: every attribute would read as absent and look like a fm omission.
    if (!r.reason && entry.fmType) {
      const mismatch = fmTypeMismatch(r.instance, entry.fmType);
      if (mismatch) { r.reason = mismatch; r.instance = undefined; }
    }
    instances.set(entry, r);
  }

  const unexplainedByGroup = new Map<string, string[]>();
  const nestedByGroup = new Map<string, string[]>();
  for (const entry of entries) {
    const { reason, instance } = instances.get(entry)!;
    if (reason) continue;
    const key = groupKeyOf(entry);
    if (unexplainedByGroup.has(key)) continue;
    const group = entries.filter((e) => !instances.get(e)!.reason && groupKeyOf(e) === key);
    const claimed = new Set<string>();
    const ignore = new Set<string>();
    for (const g of group) {
      for (const a of g.attributes) if (a.fmKey) for (const p of prefixesOf(a.fmKey)) claimed.add(normaliseArrayMarkers(p));
      for (const k of g.ignoreKeys ?? []) ignore.add(normaliseArrayMarkers(k));
    }
    // What another entry's selector claims on this same probe: derived from the register's
    // own selectors, so adding an entry for a nested shape stops that shape being reported
    // as unexplained on the entry that probes the whole response.
    const prefixes = new Set<string>();
    const deepSegments = new Set<string>();
    const ownProbeId = probeId(entry.probe.ops[0]);
    for (const other of entries) {
      if (groupKeyOf(other) === key || probeId(other.probe.ops[0]) !== ownProbeId || !other.probe.select) continue;
      const container = selectorContainer(other.probe.select);
      if (container.startsWith('**')) deepSegments.add(container.slice(2).split('.')[0]);
      else prefixes.add(container);
    }
    const all = [...new Set(flattenKeys(instance).map(normaliseArrayMarkers))];
    unexplainedByGroup.set(key, all.filter((k) => !k.includes('.') && !claimed.has(k) && !ignore.has(k)));
    nestedByGroup.set(key, all.filter((k) => {
      if (claimed.has(k)) return false;
      if (ownedBySelector(k, prefixes, deepSegments)) return false;
      for (const i of ignore) if (k === i || k.startsWith(i + '.')) return false;
      return true;
    }));
  }

  // The previous build's answer to the same probe, so the check can say what fm started
  // and stopped reporting between two builds rather than only what it reports today.
  const prevDir = previousEvidenceDir(meta.root, meta.version, meta.build);
  const previousKeys = (entry: SubjectEntry): string[] | null => {
    if (!prevDir) return null;
    try {
      const ev = readEvidence(meta.root, `gaps/evidence/${prevDir}/${probeId(entry.probe.ops[0])}.ndjson`);
      const line = ev.stdout[0] as { status?: string; result?: unknown } | undefined;
      if (!line || line.status !== 'ok') return null;
      const inst = selectInstance(line.result, entry.probe.select);
      if (inst === undefined) return null;
      return [...new Set(flattenKeys(inst).map(normaliseArrayMarkers))];
    } catch { return null; }
  };

  const updatedEntries = entries.map((entry) => {
    const { pos, reason, instance } = instances.get(entry)!;
    const evidence = evidenceFor.get(probeId(entry.probe.ops[0]))!;
    const base = { version: meta.version, build: meta.build, date: meta.date, command, batch: { size: ops.length, position: pos }, evidence };
    const attributes: SubjectEvidence['attributes'] = {};
    const attributeEvidence: Record<string, string> = {};
    const attributeReasons: Record<string, string> = {};
    if (reason) {
      for (const a of entry.attributes) attributes[a.name] = 'error';
    } else {
      for (const a of entry.attributes) {
        if (a.verifiedOn) {
          // Evaluated on the OTHER probe's instance, not this entry's own — a failure here
          // is this attribute's own outcome, not a reason to error the whole entry.
          const v = resolveProbe(a.verifiedOn);
          if (v.reason) { attributes[a.name] = 'error'; attributeReasons[a.name] = v.reason; }
          else attributes[a.name] = isReported(v.instance, a) ? 'reported' : 'absent';
          const ev = evidenceFor.get(probeId(a.verifiedOn.ops[0]))!;
          if (ev !== evidence) attributeEvidence[a.name] = ev;
        } else {
          attributes[a.name] = isReported(instance, a) ? 'reported' : 'absent';
        }
      }
    }
    const unexplainedKeys = reason ? [] : (unexplainedByGroup.get(groupKeyOf(entry)) ?? []);
    const unexplainedNestedKeys = reason ? [] : (nestedByGroup.get(groupKeyOf(entry)) ?? []);
    return {
      ...entry,
      lastChecked: {
        ...base, attributes, unexplainedKeys, unexplainedNestedKeys,
        ...(reason ? { reason } : {}),
        ...(Object.keys(attributeEvidence).length ? { attributeEvidence } : {}),
        ...(Object.keys(attributeReasons).length ? { attributeReasons } : {}),
      },
    };
  });

  // `expectedError` is the owner's standing acceptance of one failure: an errored entry
  // whose reason it matches is listed apart and raises nothing, while the same entry
  // SUCCEEDING is the signal the gap closed and does raise the exit code.
  const accepts = (entry: SubjectEntry, reason: string): boolean => {
    const want = entry.expectedError;
    if (!want) return false;
    return reason.startsWith(want) || reason === `probe refused: ${want}`;
  };
  const errored = updatedEntries.filter((e) => e.lastChecked?.reason && !accepts(e, e.lastChecked.reason));
  const erroredExpected = updatedEntries.filter((e) => e.lastChecked?.reason && accepts(e, e.lastChecked.reason));
  const expectedResolved = updatedEntries.filter((e) => e.expectedError && !e.lastChecked?.reason);

  const stillMissing: CheckOutcome['stillMissing'] = [];
  const newlyReported: CheckOutcome['newlyReported'] = [];
  const regressed: CheckOutcome['regressed'] = [];
  for (const entry of updatedEntries) {
    if (entry.lastChecked?.reason) continue;
    for (const a of entry.attributes) {
      const status = entry.lastChecked!.attributes[a.name];
      if (status === 'error') continue;   // a verifiedOn probe/selector failure for THIS attribute only: not scored either way
      const seen = status === 'reported';
      if (seen && !a.reported && !a.wontfix) newlyReported.push({ entry, attribute: a });
      if (!seen && a.reported) regressed.push({ entry, attribute: a });
      if (!seen && !a.reported && !a.wontfix) stillMissing.push({ entry, attribute: a });
    }
  }

  const attributeErrors: CheckOutcome['attributeErrors'] = [];
  for (const entry of updatedEntries) {
    const reasons = entry.lastChecked?.attributeReasons;
    if (!reasons) continue;
    for (const a of entry.attributes) if (reasons[a.name]) attributeErrors.push({ entry, attribute: a, reason: reasons[a.name] });
  }

  const unexplained: CheckOutcome['unexplained'] = [];
  const nestedUnexplained: CheckOutcome['nestedUnexplained'] = [];
  const keyDiff: CheckOutcome['keyDiff'] = [];
  const seenGroup = new Set<string>();
  // `updatedEntries` is `entries` mapped one for one, so index carries the resolved instance over.
  const instanceOf = (i: number): unknown => instances.get(entries[i])!.instance;
  for (const [i, entry] of updatedEntries.entries()) {
    if (entry.lastChecked?.reason) continue;
    const key = groupKeyOf(entry);
    if (seenGroup.has(key)) continue;
    seenGroup.add(key);
    const keys = entry.lastChecked!.unexplainedKeys;
    if (keys.length) unexplained.push({ entry, keys });
    const nested = entry.lastChecked!.unexplainedNestedKeys ?? [];
    if (nested.length) nestedUnexplained.push({ entry, keys: nested });
    const before = previousKeys(entry);
    if (before) {
      const now = [...new Set(flattenKeys(instanceOf(i)).map(normaliseArrayMarkers))];
      const added = now.filter((k) => !before.includes(k));
      const removed = before.filter((k) => !now.includes(k));
      if (added.length || removed.length) keyDiff.push({ entry, previous: prevDir!, added, removed });
    }
  }

  return { entries: updatedEntries, stillMissing, newlyReported, regressed, unexplained, nestedUnexplained, keyDiff, errored, erroredExpected, expectedResolved, attributeErrors };
}

/** The rendered diff of fm's help surface: what a reader of `check`'s or `report`'s output
 *  is shown under "Help since <prev label>" / "## CLI surface since <prev>". */
export interface HelpSince {
  prevLabel: string;
  text: string;
}

/** `text` (this build's help JSON, already captured) diffed against whatever the previous
 *  build's stored snapshot says, or null when there is no previous build to diff against. */
function helpDiffSince(root: string, version: string, build: string, text: string): HelpSince | null {
  const prevPath = previousHelpSnapshot(root, version, build);
  if (!prevPath) return null;
  const prevLabel = path.basename(prevPath, '.json');
  const nextLabel = evidenceDir(version, build);
  const prev = summariseHelp(JSON.parse(fs.readFileSync(prevPath, 'utf8')) as HelpJson);
  const next = summariseHelp(JSON.parse(text) as HelpJson);
  return { prevLabel, text: renderHelpDiff(diffHelp(prev, next), prevLabel, nextLabel) };
}

/** `check`'s half of the help snapshot: run before any probe (help does not touch the
 *  file), so a fatal probe batch still leaves this build's help on disk. Writes only when
 *  the text is new; the diff never affects `check`'s exit code -- it is reported and
 *  nothing else reads it. */
export async function captureHelpSince(cliPath: string, root: string, version: string, build: string): Promise<HelpSince | null> {
  const text = await captureHelp(cliPath);
  writeHelpSnapshot(root, version, build, text);
  return helpDiffSince(root, version, build, text);
}

/** `report`'s half: `report` never runs fm, so it reads back whatever `check` already
 *  captured for this build (identified by the register's own `lastChecked.version`/
 *  `.build`) rather than capturing anything new. Null when this build's snapshot was never
 *  captured -- an older register, or a register whose evidence root has no `gaps/help` at
 *  all -- in which case there is nothing to render a section for. */
export function helpSurfaceSince(root: string, version: string, build: string): HelpSince | null {
  const current = helpSnapshotPath(root, version, build);
  if (!fs.existsSync(current)) return null;
  return helpDiffSince(root, version, build, fs.readFileSync(current, 'utf8'));
}
