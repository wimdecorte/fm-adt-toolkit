import type { AdtOpResult } from '../types.ts';

export type GapCheck =
  | { kind: 'keyPresent'; path: string }
  | { kind: 'opAccepted' }
  | { kind: 'stepNotOpaque'; stepName: string }
  | { kind: 'stepKeyPresent'; stepName: string; key: string }
  | { kind: 'valueEquals'; path: string; value: unknown };

function walk(obj: unknown, path: string): { found: boolean; value: unknown } {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return { found: true, value: cur };
}

function bodySteps(result: Record<string, unknown> | undefined, stepName: string): Record<string, unknown>[] {
  const body = Array.isArray(result?.body) ? (result!.body as Record<string, unknown>[]) : [];
  return body.filter((s) => s.step === stepName);
}

/** Every check reads results[0]; a probe is one op, and a multi-op probe is a
 *  design smell rather than something to support. */
export function evaluateCheck(check: GapCheck, results: AdtOpResult[]): { passed: boolean; reason: string } {
  const first = results[0];
  if (!first) return { passed: false, reason: 'no result line came back for the probe' };
  if (check.kind === 'opAccepted') {
    return first.status === 'ok'
      ? { passed: true, reason: 'op accepted' }
      : { passed: false, reason: `op refused: ${first.error?.code ?? first.status}` };
  }
  if (first.status !== 'ok') return { passed: false, reason: `op refused: ${first.error?.code ?? first.status}` };
  const result = first.result ?? {};
  switch (check.kind) {
    case 'keyPresent': {
      const { found } = walk(result, check.path);
      return { passed: found, reason: found ? `${check.path} present` : `${check.path} absent` };
    }
    case 'valueEquals': {
      const { found, value } = walk(result, check.path);
      const passed = found && JSON.stringify(value) === JSON.stringify(check.value);
      return { passed, reason: passed ? `${check.path} equals expected` : `${check.path} is ${JSON.stringify(value)}` };
    }
    case 'stepNotOpaque': {
      const steps = bodySteps(result, check.stepName);
      if (steps.length === 0) return { passed: false, reason: `no step named ${check.stepName} in the probe script` };
      const opaque = steps.filter((s) => s.opaque === true).length;
      return { passed: opaque === 0, reason: opaque === 0 ? 'no opaque steps' : `${opaque} of ${steps.length} steps opaque` };
    }
    case 'stepKeyPresent': {
      const steps = bodySteps(result, check.stepName);
      if (steps.length === 0) return { passed: false, reason: `no step named ${check.stepName} in the probe script` };
      const hit = steps.some((s) => check.key in s);
      return { passed: hit, reason: hit ? `${check.key} present` : `${check.key} absent on all ${steps.length} steps` };
    }
  }
}
