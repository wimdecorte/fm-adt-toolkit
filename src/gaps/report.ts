import { probeId, readEvidence } from './evidence.ts';
import { selectInstance, selectorContainer } from './select.ts';
import type { Attribute, SubjectEntry } from './register.ts';

/** The annotation an attribute with `verifiedOn` carries: it was NOT evaluated on this
 *  entry's own probe instance, but on the instance selected from a different probe. */
function verifiedOnNote(a: Attribute): string {
  if (!a.verifiedOn) return '';
  return ` (verified on ${a.verifiedOn.select ?? '(root)'} of ${JSON.stringify(a.verifiedOn.ops[0])})`;
}

/** An entry counts as verified only once fm has actually answered its probe and the
 *  selector found the instance: no `lastChecked` (never checked) or a `lastChecked.reason`
 *  (the probe or selector failed) both mean the "not reported" list below is a guess a
 *  human drafted, not something fm was seen to omit. */
function isVerified(e: SubjectEntry): boolean {
  return e.lastChecked != null && !e.lastChecked.reason;
}

const missingOf = (e: SubjectEntry): Attribute[] => e.attributes.filter((a) => !a.reported && !a.wontfix);
const startsWith = (a: Attribute, s: string): boolean => (a.wontfix ?? '').toLowerCase().startsWith(s);
const notExercisedOf = (e: SubjectEntry): Attribute[] => e.attributes.filter((a) => startsWith(a, 'not exercised'));
const packedOf = (e: SubjectEntry): Attribute[] => e.attributes.filter((a) => startsWith(a, 'meaning unknown') && a.path.includes('(undecoded bits)'));
const excludedOf = (e: SubjectEntry): Attribute[] =>
  e.attributes.filter((a) => a.wontfix && !startsWith(a, 'not exercised') && !(startsWith(a, 'meaning unknown') && a.path.includes('(undecoded bits)')));

/** GitHub's own anchor for a Markdown heading, so the index links resolve. */
function anchor(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
}

/** The gaps the report exists to ask about, each with the one-line story a reader who
 *  opens this file needs before any table makes sense. `where` is evaluated over the
 *  register, so every count in the summary is the register's own and not a number typed
 *  into prose. */
const BIGGEST_GAPS: Array<{ title: string; op: string; where: (e: SubjectEntry, a: Attribute) => boolean; story: string }> = [
  { title: 'Layout parts', op: 'read:layout', where: (e) => e.id.startsWith('part:'),
    story: '`read:layout` reports no `contents.parts` key at all, so nothing about a part is readable: not the part list, not a part’s type, name, height, page-break options or a sub-summary’s break field. Ten part kinds are described here and none could be checked against fm, because the container they would live in is absent.' },
  { title: 'File Options', op: 'none', where: (e) => e.id === 'file-options',
    story: 'There is no op that reads a file’s own options: `read:file` is refused with `unknown_catalog`. The opening script, the account to log in with, the minimum FileMaker version, the window and menubar hide settings and the rest of the Metadata block are unreachable.' },
  { title: 'Themes', op: 'none', where: (e) => e.id === 'theme',
    story: 'fm names the theme a layout wears and reports nothing inside it. Every style the theme defines — the per-state fills, strokes, fonts and paddings that decide what a layout actually looks like — has no op to read it.' },
  { title: 'Sort specifications', op: 'read:layout', where: (_e, a) => /sort/i.test(a.name),
    story: 'Wherever FileMaker stores a sort order — a portal’s, a value list’s, a relationship’s — fm reports that sorting is on but not the fields sorted by or their directions.' },
  { title: 'Modification info', op: 'read:layout', where: (_e, a) => /modif/i.test(a.name),
    story: 'Almost every catalog element in the export carries who changed it, when, and how many times. fm reports none of the triple, on any kind and under any op — the single most widely repeated gap in this register.' },
  { title: 'Conditional formatting', op: 'read:layout', where: (_e, a) => /conditional format/i.test(a.name),
    story: 'A layout object’s conditional formatting rules — the condition, the comparison value and the formatting each rule applies — are not reported, so a layout cannot be reproduced from what fm says about it.' },
  { title: 'Calculation tokens', op: 'none', where: (e) => e.id === 'calculation-tokens' || e.id === 'plugin-call-sites',
    story: 'fm hands back a formula as text and never as its parts. `validate:calculation` says valid or invalid and names no field, occurrence, variable, custom function, script or plug-in function the formula refers to, so "where is this field used" cannot be answered.' },
];

/** The containers other entries' selectors own on the same probe: `contents.objects` for a
 *  layout, `body` for a script, `items` for a menu. Their contents are described by their
 *  own kinds in this same report, so inlining them under the entry that probes the whole
 *  response would repeat every layout object and every script step twice — megabytes of it. */
function ownedContainers(entries: SubjectEntry[], entry: SubjectEntry): { prefixes: string[]; deep: string[] } {
  const prefixes = new Set<string>();
  const deep = new Set<string>();
  const own = probeId(entry.probe.ops[0]);
  const ownSelect = entry.probe.select ?? '';
  for (const other of entries) {
    if (!other.probe.select || other.probe.select === ownSelect || probeId(other.probe.ops[0]) !== own) continue;
    const container = selectorContainer(other.probe.select);
    if (container.startsWith('**')) deep.add(container.slice(2).split('.')[0]);
    else prefixes.add(container);
  }
  return { prefixes: [...prefixes], deep: [...deep] };
}

const ELIDED = '… described by its own kind in this report; the values are in the evidence file';

/** `value` with every owned container replaced by a note. */
function elideOwned(value: unknown, owned: { prefixes: string[]; deep: string[] }, prefix = ''): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => elideOwned(v, owned, prefix));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (owned.deep.includes(k) || owned.prefixes.includes(p)) out[k] = ELIDED;
    else out[k] = elideOwned(v, owned, p);
  }
  return out;
}

export function renderReport(entries: SubjectEntry[], root: string): string {
  const byOp = new Map<string, SubjectEntry[]>();
  for (const e of entries) byOp.set(e.op, [...(byOp.get(e.op) ?? []), e]);
  const ops = [...byOp.entries()].sort();
  const out: string[] = ['# fm CLI coverage: what each read op does not report', ''];
  const checked = entries.find((e) => e.lastChecked)?.lastChecked;
  if (checked) out.push(`Checked against fm ${checked.version} (${checked.build}) on ${checked.date}. Reference: the Save as XML export of the Ooe solution.`, '');
  // Every probe of one check runs in ONE fm invocation, so the command is the same line on
  // all 300 entries; it is stated once here rather than 300 times below.
  const commands = [...new Set(entries.filter((e) => e.lastChecked).map((e) => e.lastChecked!.command))];
  const oneCommand = commands.length === 1 ? commands[0] : null;
  if (oneCommand) out.push('Every probe below ran in one invocation:', '', '```', oneCommand, '```', '');
  const verifiedEntries = entries.filter(isVerified);
  const missingTotal = verifiedEntries.reduce((n, e) => n + missingOf(e).length, 0);
  out.push(`${entries.length} kinds, ${missingTotal} attributes not reported.`, '');
  const unverifiedCount = entries.length - verifiedEntries.length;
  if (unverifiedCount > 0) out.push(`${unverifiedCount} kinds not yet verified.`, '');

  // --- executive summary -----------------------------------------------------------
  const opName = (op: string) => (op === 'none' ? 'No read op exists' : op);
  out.push('## Summary', '', '| Read op | Kinds | Attributes not reported | The story |', '|---|---|---|---|');
  for (const [op, list] of ops) {
    const missing = list.filter(isVerified).reduce((n, e) => n + missingOf(e).length, 0);
    const unverified = list.length - list.filter(isVerified).length;
    const gaps = BIGGEST_GAPS.filter((g) => g.op === op && list.some((e) => missingOf(e).some((a) => g.where(e, a)))).map((g) => g.title);
    const story = gaps.length ? gaps.join(', ') : '—';
    out.push(`| ${opName(op)} | ${list.length}${unverified ? ` (${unverified} unverified)` : ''} | ${missing} | ${story} |`);
  }
  out.push('');
  out.push('### The biggest gaps', '');
  for (const g of BIGGEST_GAPS) {
    // Counted attribute by attribute over the register: a gap that spans many kinds (every
    // element's modification info) is not the whole of any one kind's missing list.
    const hits = entries.map((e) => missingOf(e).filter((a) => g.where(e, a)).length);
    const n = hits.reduce((k, x) => k + x, 0);
    const kinds = hits.filter((x) => x > 0).length;
    out.push(`- **${g.title}** — ${g.story} (${n} attributes across ${kinds} kind${kinds === 1 ? '' : 's'}.)`);
  }
  out.push('');

  // --- packed words ----------------------------------------------------------------
  const packedEntries = entries.filter((e) => isVerified(e) && packedOf(e).some((a) => e.lastChecked!.attributes[a.name] === 'reported'));
  out.push('## Packed words fm reports raw', '');
  out.push(
    `${packedEntries.length} kinds carry a packed options word that fm emits verbatim and decodes not at all: the raw number is present in the response, and none of the bits inside it is named.`,
    'The ask is the decode, not the number. FileMaker knows what each bit of each word means — the same table the Script Workspace uses to print a step’s options — and the register can only record which bits it has attributed by measurement.',
    '',
    '| Kind | Register id | Raw word key |', '|---|---|---|',
  );
  for (const e of packedEntries) {
    const a = packedOf(e)[0];
    out.push(`| ${e.kind} | \`${e.id}\` | \`${a.fmKey ?? '(none)'}\` |`);
  }
  out.push('');

  // --- index ------------------------------------------------------------------------
  out.push('## Sections', '');
  for (const [op, list] of ops) {
    const heading = opName(op);
    out.push(`- [${heading}](#${anchor(heading)}) — ${list.length} kinds`);
  }
  out.push('');

  for (const [op, list] of ops) {
    out.push(`## ${opName(op)}`, '');
    for (const e of list.sort((a, b) => a.kind.localeCompare(b.kind))) {
      const missing = missingOf(e);
      const reported = e.attributes.filter((a) => a.reported);
      out.push(`### ${e.kind}`, '', `Register id: \`${e.id}\`. Probe: \`${JSON.stringify(e.probe.ops[0])}\`${e.probe.select ? ` selecting \`${e.probe.select}\`` : ''}.`, '');
      if (!isVerified(e)) out.push('Not yet verified against fm.', '');
      if (missing.length) {
        out.push('**Not reported**', '', '| Attribute | Known from | SaXML path |', '|---|---|---|');
        for (const a of missing) out.push(`| ${a.name}${verifiedOnNote(a)} | ${a.knownFrom} | \`${a.path}\` |`);
        out.push('');
      } else out.push('Every known attribute is reported.', '');
      if (reported.length) out.push(`Reported (${reported.length}): ${reported.map((a) => `\`${a.fmKey}\`${verifiedOnNote(a)}`).join(', ')}.`, '');
      // The two compact lines: what this instance could not exercise, and what was
      // reviewed and ruled out. Neither is a gap, and both would otherwise read as one.
      const notExercised = notExercisedOf(e);
      if (notExercised.length) out.push(`Reported but not exercised on this instance (${notExercised.length}): ${notExercised.map((a) => a.name).join(', ')}.`, '');
      const excluded = excludedOf(e);
      if (excluded.length) out.push(`Excluded as provenance/bookkeeping (${excluded.length}).`, '');
      const reasons = e.lastChecked?.attributeReasons;
      if (reasons) for (const [name, why] of Object.entries(reasons)) out.push(`Attribute \`${name}\` could not be verified: ${why}`, '');
      if (e.lastChecked) {
        const c = e.lastChecked;
        out.push(`Last checked fm ${c.version} (${c.build}) on ${c.date}; probe ${c.batch.position + 1} of ${c.batch.size} in one invocation.`, '');
        if (!oneCommand) out.push('Command:', '', '```', c.command, '```', '');
        // The SELECTED INSTANCE, not the whole response: a read:script answer carries every
        // step of the script and a read:layout answer every object of the layout, and
        // inlining those turned this report into megabytes of the same text. The full
        // response is one file away, named on the line below.
        out.push(...instanceBlock(root, c.evidence, e.probe.select, 'Response, the instance this entry describes', ownedContainers(entries, e)));
        out.push(`Full response: \`${c.evidence}\` (stdout and stderr verbatim, one file per probe).`, '');
        // A verifiedOn row is evidenced by the ONE value it claims, not by re-inlining a
        // whole second instance: seven layout options verified on three other layouts would
        // otherwise print three full layouts seven times.
        for (const a of e.attributes.filter((x) => x.verifiedOn)) {
          const evPath = c.attributeEvidence?.[a.name] ?? c.evidence;
          out.push(...verificationLine(root, evPath, a));
        }
        if (c.reason) out.push(`Check note: ${c.reason}`, '');
      } else out.push('Not yet checked.', '');
    }
  }
  return out.join('\n');
}

/** The one instance a selector picks out of an evidence file, rendered as JSON, or a line
 *  saying why there is none to show. */
function instanceBlock(root: string, rel: string, select: string | undefined, lead: string, owned: { prefixes: string[]; deep: string[] }): string[] {
  let ev;
  try { ev = readEvidence(root, rel); } catch { return [`Evidence file ${rel} is missing.`, '']; }
  const line = ev.stdout[0] as { status?: string; result?: unknown; error?: { code?: string } } | undefined;
  const exit = String(ev.meta.exitCode);
  if (!line) return [`${lead} (exit ${exit}): the probe returned no result line.`, ''];
  if (line.status !== 'ok') return [`${lead} (exit ${exit}): the probe was refused with \`${line.error?.code ?? line.status}\`.`, ''];
  const instance = selectInstance(line.result, select);
  if (instance === undefined) return [`${lead} (exit ${exit}): \`${select ?? '(root)'}\` selected nothing from the response.`, ''];
  return [`${lead} (exit ${exit}), selected by \`${select ?? '(root)'}\`:`, '', '```json', JSON.stringify(elideOwned(instance, owned), null, 1), '```', ''];
}

/** What fm actually answered for one `verifiedOn` attribute: the value at its fmKey on the
 *  instance that probe selects, and the file the whole answer is in. */
function verificationLine(root: string, rel: string, a: Attribute): string[] {
  const where = `\`${a.verifiedOn!.select ?? '(root)'}\` of \`${JSON.stringify(a.verifiedOn!.ops[0])}\``;
  let ev;
  try { ev = readEvidence(root, rel); } catch { return [`Verification of \`${a.name}\` on ${where}: evidence file ${rel} is missing.`, '']; }
  const line = ev.stdout[0] as { status?: string; result?: unknown; error?: { code?: string } } | undefined;
  if (!line || line.status !== 'ok') return [`Verification of \`${a.name}\` on ${where}: the probe was refused with \`${line?.error?.code ?? line?.status ?? 'no result'}\` (\`${rel}\`).`, ''];
  const instance = selectInstance(line.result, a.verifiedOn!.select);
  if (instance === undefined) return [`Verification of \`${a.name}\` on ${where}: the selector matched nothing (\`${rel}\`).`, ''];
  const value = a.fmKey ? selectInstance(instance, a.fmKey) : undefined;
  const shown = value === undefined ? '(the key is absent)' : `\`${JSON.stringify(value)}\``;
  return [`Verification of \`${a.name}\` on ${where}: \`${a.fmKey ?? '(no key)'}\` is ${shown} (\`${rel}\`).`, ''];
}
