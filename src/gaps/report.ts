import type { GapEntry } from './register.ts';

/** Markdown for Claris: every OPEN entry, grouped by area, each with the exact
 *  command, the ops sent, and the verbatim response from the last check. */
export function renderReport(entries: GapEntry[]): string {
  const open = entries.filter((e) => e.status === 'open');
  const byArea = new Map<string, GapEntry[]>();
  for (const e of open) byArea.set(e.area, [...(byArea.get(e.area) ?? []), e]);
  const out: string[] = ['# fm CLI gaps', ''];
  const first = open.find((e) => e.lastChecked)?.lastChecked;
  if (first) out.push(`Checked against fm ${first.version} (${first.build}) on ${first.date}.`, '');
  out.push(`${open.length} open entries.`, '');
  for (const [area, list] of [...byArea.entries()].sort()) {
    out.push(`## ${area}`, '');
    for (const e of list) {
      out.push(`### ${e.title}`, '', e.description, '', `First seen: ${e.firstSeen}. Register id: \`${e.id}\`.`, '');
      if (e.lastChecked) {
        const c = e.lastChecked;
        out.push(`Last checked: fm ${c.version} (${c.build}) on ${c.date}, outcome **${c.outcome}**.`, '');
        out.push(
          `Probe ${c.batch.position + 1} of ${c.batch.size} in one fm invocation; the summary and exit code below are the batch's.`,
          '',
        );
        out.push('Command:', '', '```', c.command, '```', '');
        out.push('Ops file:', '', '```json', ...c.ops.map((op) => JSON.stringify(op)), '```', '');
        out.push('Response (stdout, then stderr, exit ' + c.response.exitCode + '):', '', '```json',
          ...c.response.stdout.map((l) => JSON.stringify(l, null, 1)),
          ...c.response.stderr.map((l) => JSON.stringify(l, null, 1)),
          '```', '');
      } else {
        out.push('Not yet checked.', '');
      }
    }
  }
  return out.join('\n');
}
