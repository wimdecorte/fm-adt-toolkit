import { readEvidence } from './evidence.ts';
import type { Attribute, SubjectEntry } from './register.ts';

/** The annotation an attribute with `verifiedOn` carries: it was NOT evaluated on this
 *  entry's own probe instance, but on the instance selected from a different probe. */
function verifiedOnNote(a: Attribute): string {
  if (!a.verifiedOn) return '';
  return ` (verified on ${a.verifiedOn.select ?? '(root)'} of ${JSON.stringify(a.verifiedOn.ops[0])})`;
}

/** Markdown for Claris, per read op and kind: what the object has that the op does not
 *  report, each with where it is known from, then the op's actual response for that
 *  instance, verbatim from the evidence file. */
/** An entry counts as verified only once fm has actually answered its probe and the
 *  selector found the instance: no `lastChecked` (never checked) or a `lastChecked.reason`
 *  (the probe or selector failed) both mean the "not reported" list below is a guess a
 *  human drafted, not something fm was seen to omit. */
function isVerified(e: SubjectEntry): boolean {
  return e.lastChecked != null && !e.lastChecked.reason;
}

export function renderReport(entries: SubjectEntry[], root: string): string {
  const byOp = new Map<string, SubjectEntry[]>();
  for (const e of entries) byOp.set(e.op, [...(byOp.get(e.op) ?? []), e]);
  const out: string[] = ['# fm CLI coverage: what each read op does not report', ''];
  const checked = entries.find((e) => e.lastChecked)?.lastChecked;
  if (checked) out.push(`Checked against fm ${checked.version} (${checked.build}) on ${checked.date}. Reference: the Save as XML export of the Ooe solution.`, '');
  const verifiedEntries = entries.filter(isVerified);
  const missingTotal = verifiedEntries.reduce((n, e) => n + e.attributes.filter((a) => !a.reported && !a.wontfix).length, 0);
  out.push(`${entries.length} kinds, ${missingTotal} attributes not reported.`, '');
  const unverifiedCount = entries.length - verifiedEntries.length;
  if (unverifiedCount > 0) out.push(`${unverifiedCount} kinds not yet verified.`, '');
  for (const [op, list] of [...byOp.entries()].sort()) {
    out.push(`## ${op === 'none' ? 'No read op exists' : op}`, '');
    for (const e of list.sort((a, b) => a.kind.localeCompare(b.kind))) {
      const missing = e.attributes.filter((a) => !a.reported && !a.wontfix);
      const reported = e.attributes.filter((a) => a.reported);
      out.push(`### ${e.kind}`, '', `Register id: \`${e.id}\`. Probe: \`${JSON.stringify(e.probe.ops[0])}\`${e.probe.select ? ` selecting \`${e.probe.select}\`` : ''}.`, '');
      if (!isVerified(e)) out.push('Not yet verified against fm.', '');
      if (missing.length) {
        out.push('**Not reported**', '', '| Attribute | Known from | SaXML path |', '|---|---|---|');
        for (const a of missing) out.push(`| ${a.name}${verifiedOnNote(a)} | ${a.knownFrom} | \`${a.path}\` |`);
        out.push('');
      } else out.push('Every known attribute is reported.', '');
      if (reported.length) out.push(`Reported (${reported.length}): ${reported.map((a) => `\`${a.fmKey}\`${verifiedOnNote(a)}`).join(', ')}.`, '');
      const verifiedOnAttrs = e.attributes.filter((a) => a.verifiedOn);
      for (const a of verifiedOnAttrs) {
        const evPath = e.lastChecked?.attributeEvidence?.[a.name] ?? e.lastChecked?.evidence;
        if (!evPath) continue;
        try {
          const ev = readEvidence(root, evPath);
          out.push(
            `Verification instance for \`${a.name}\`, from \`${JSON.stringify(a.verifiedOn!.ops[0])}\`${a.verifiedOn!.select ? ` selecting \`${a.verifiedOn!.select}\`` : ''}:`,
            '', '```json', ...ev.stdout.map((l) => JSON.stringify(l, null, 1)), '```', '',
          );
        } catch { /* evidence file missing: nothing to show */ }
      }
      if (e.lastChecked) {
        const c = e.lastChecked;
        out.push(`Last checked fm ${c.version} (${c.build}) on ${c.date}; probe ${c.batch.position + 1} of ${c.batch.size} in one invocation.`, '');
        out.push('Command:', '', '```', c.command, '```', '');
        try {
          const ev = readEvidence(root, c.evidence);
          out.push(`Response (stdout, then stderr; exit ${String(ev.meta.exitCode)}):`, '', '```json',
            ...ev.stdout.map((l) => JSON.stringify(l, null, 1)), ...ev.stderr.map((l) => JSON.stringify(l, null, 1)), '```', '');
        } catch { out.push(`Evidence file ${c.evidence} is missing.`, ''); }
        if (c.reason) out.push(`Check note: ${c.reason}`, '');
      } else out.push('Not yet checked.', '');
    }
  }
  return out.join('\n');
}
