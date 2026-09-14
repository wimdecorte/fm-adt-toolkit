import type { AdtFatal, AdtOp, AdtRunResult } from '../types.ts';
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
): Promise<{
  entries: GapEntry[];
  stillOpen: GapEntry[];
  newlyPassing: GapEntry[];
  errored: GapEntry[];
  fatal?: AdtFatal;
}> {
  const ops = entries.map((e) => e.probe.ops[0]);
  const result = await run(ops);
  const stderrLines = parseLines(result.stderr);
  const command = meta.commandFor(result.argv);

  const stillOpen: GapEntry[] = [];
  const newlyPassing: GapEntry[] = [];
  const errored: GapEntry[] = [];

  const updated = entries.map((entry, i) => {
    const line = result.results[i];
    const probeOp = entry.probe.ops[0].op;
    let outcome: GapEvidence['outcome'];
    let reason: string | undefined;
    if (!line) {
      outcome = 'error';
    } else if (line.op !== probeOp) {
      outcome = 'error';
      reason = `result op ${line.op} does not match probe op ${probeOp} at position ${i}`;
    } else {
      outcome = evaluateCheck(entry.probe.check, [line]).passed ? 'passed' : 'open';
    }
    const evidence: GapEvidence = {
      version: meta.version, build: meta.build, date: meta.date, outcome,
      ...(reason ? { reason } : {}),
      command,
      ops: entry.probe.ops,
      response: { stdout: line ? [line] : [], stderr: stderrLines, exitCode: result.exitCode },
      batch: { size: entries.length, position: i },
    };
    const next = { ...entry, lastChecked: evidence };
    if (outcome === 'error') errored.push(next);
    else if (outcome === 'passed' && entry.status === 'open') newlyPassing.push(next);
    else if (outcome === 'open') stillOpen.push(next);
    return next;
  });

  return { entries: updated, stillOpen, newlyPassing, errored, ...(result.fatal ? { fatal: result.fatal } : {}) };
}
