import type { AdtOp, AdtRunResult } from '../types.ts';
import { evaluateCheck } from './checks.ts';
import type { GapEntry, GapEvidence } from './register.ts';

function parseLines(text: string): unknown[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { unparseable: l }; }
  });
}

/** Run every entry's probe in ONE fm invocation, one op per entry in register
 *  order, so results map back by position. Evidence is recorded on every entry
 *  whatever the outcome. `status` is never changed here: a human reads the
 *  evidence and marks an entry fixed. */
export async function runChecks(
  entries: GapEntry[],
  run: (ops: AdtOp[]) => Promise<AdtRunResult>,
  meta: { version: string; build: string; date: string; commandFor: (argv: string[]) => string },
): Promise<{ entries: GapEntry[]; stillOpen: GapEntry[]; newlyPassing: GapEntry[]; errored: GapEntry[] }> {
  const ops = entries.map((e) => e.probe.ops[0]);
  const result = await run(ops);
  const stdoutLines = parseLines(result.stdout);
  const stderrLines = parseLines(result.stderr);
  const command = meta.commandFor(result.argv);

  const stillOpen: GapEntry[] = [];
  const newlyPassing: GapEntry[] = [];
  const errored: GapEntry[] = [];

  const updated = entries.map((entry, i) => {
    const line = result.results[i];
    const own = line ? [line] : [];
    let outcome: GapEvidence['outcome'];
    if (!line) {
      outcome = 'error';
    } else {
      outcome = evaluateCheck(entry.probe.check, own).passed ? 'passed' : 'open';
    }
    const evidence: GapEvidence = {
      version: meta.version, build: meta.build, date: meta.date, outcome, command,
      ops: entry.probe.ops,
      response: { stdout: line ? [line] : stdoutLines, stderr: stderrLines, exitCode: result.exitCode },
    };
    const next = { ...entry, lastChecked: evidence };
    if (outcome === 'error') errored.push(next);
    else if (outcome === 'passed' && entry.status === 'open') newlyPassing.push(next);
    else if (outcome === 'open') stillOpen.push(next);
    return next;
  });

  return { entries: updated, stillOpen, newlyPassing, errored };
}
