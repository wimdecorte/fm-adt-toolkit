import type { AdtFatal, AdtOp, AdtRunResult } from '../types.ts';
import { selectInstance } from './select.ts';
import { flattenKeys } from './match.ts';
import { probeId, writeEvidence } from './evidence.ts';
import type { Attribute, Probe, SubjectEntry, SubjectEvidence } from './register.ts';

export interface CheckOutcome {
  entries: SubjectEntry[];
  stillMissing: Array<{ entry: SubjectEntry; attribute: Attribute }>;
  newlyReported: Array<{ entry: SubjectEntry; attribute: Attribute }>;
  regressed: Array<{ entry: SubjectEntry; attribute: Attribute }>;
  unexplained: Array<{ entry: SubjectEntry; keys: string[] }>;
  errored: SubjectEntry[];
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

/** The dotted prefixes of a key, array markers stripped: 'bounds.top' -> ['bounds', 'bounds.top']. A
 *  claimed fmKey claims its own parents too, so a nested attribute under it never shows up as an
 *  unexplained top-level key. */
function prefixesOf(key: string): string[] {
  const parts = key.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.').replace(/\[\]$/, ''));
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
  if (result.fatal) {
    return { entries, stillMissing: [], newlyReported: [], regressed: [], unexplained: [], errored: [], fatal: result.fatal };
  }
  const stderrLines = parseLines(result.stderr);
  const command = meta.commandFor(result.argv);

  const evidenceFor = new Map<string, string>();
  ids.forEach((id, i) => {
    const line = result.results[i];
    evidenceFor.set(id, writeEvidence(meta.root, meta.version, ops[i], {
      command, batch: { size: ops.length, position: i }, build: meta.build, date: meta.date,
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
    else { instance = selectInstance(line.result, probe.select); if (instance === undefined) reason = `selector ${probe.select ?? '(root)'} matched nothing`; }
    return { pos, reason, instance };
  };

  // Resolve each entry's instance (or the reason it has none) up front, so entries
  // sharing an instance can share what explains it.
  const instances = new Map<SubjectEntry, { pos: number; reason?: string; instance: unknown }>();
  for (const entry of entries) instances.set(entry, resolveProbe(entry.probe));

  const unexplainedByGroup = new Map<string, string[]>();
  for (const entry of entries) {
    const { reason, instance } = instances.get(entry)!;
    if (reason) continue;
    const key = groupKeyOf(entry);
    if (unexplainedByGroup.has(key)) continue;
    const group = entries.filter((e) => !instances.get(e)!.reason && groupKeyOf(e) === key);
    const claimed = new Set<string>();
    const ignore = new Set<string>();
    for (const g of group) {
      for (const a of g.attributes) if (a.fmKey) for (const p of prefixesOf(a.fmKey)) claimed.add(p);
      for (const k of g.ignoreKeys ?? []) ignore.add(k);
    }
    unexplainedByGroup.set(key, flattenKeys(instance).filter((k) => !k.includes('.') && !claimed.has(k) && !ignore.has(k)));
  }

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
          else attributes[a.name] = a.fmKey && hasKey(v.instance, a.fmKey) ? 'reported' : 'absent';
          const ev = evidenceFor.get(probeId(a.verifiedOn.ops[0]))!;
          if (ev !== evidence) attributeEvidence[a.name] = ev;
        } else {
          attributes[a.name] = a.fmKey && hasKey(instance, a.fmKey) ? 'reported' : 'absent';
        }
      }
    }
    const unexplainedKeys = reason ? [] : (unexplainedByGroup.get(groupKeyOf(entry)) ?? []);
    return {
      ...entry,
      lastChecked: {
        ...base, attributes, unexplainedKeys,
        ...(reason ? { reason } : {}),
        ...(Object.keys(attributeEvidence).length ? { attributeEvidence } : {}),
        ...(Object.keys(attributeReasons).length ? { attributeReasons } : {}),
      },
    };
  });

  const errored = updatedEntries.filter((e) => e.lastChecked?.reason);

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

  const unexplained: CheckOutcome['unexplained'] = [];
  const seenGroup = new Set<string>();
  for (const entry of updatedEntries) {
    if (entry.lastChecked?.reason) continue;
    const key = groupKeyOf(entry);
    if (seenGroup.has(key)) continue;
    seenGroup.add(key);
    const keys = entry.lastChecked!.unexplainedKeys;
    if (keys.length) unexplained.push({ entry, keys });
  }

  return { entries: updatedEntries, stillMissing, newlyReported, regressed, unexplained, errored };
}
