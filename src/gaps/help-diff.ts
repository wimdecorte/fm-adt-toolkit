/** Pure, browser-safe reduction of `fm help --json --all` to what a build-to-build diff
 *  cares about: which catalogs, ops and script steps exist, and which keys each op and each
 *  step accepts (including keys nested arbitrarily deep under a keyObject/variant child).
 *  No `node:` imports here -- this is evaluated the same way a server or a browser tool
 *  would. */

export interface HelpKey {
  key: string;
  type?: string;
  condition?: string;
  summary?: string;
  enum?: unknown;
  /** The page that documents this key's own keys, when it is not the node beneath it --
   *  how fm 0.12.0 documents a shape several ops or steps share, once. */
  childPath?: string[];
}

/** One entry of `fm help --json --all`'s flat `nodes` array. Only the fields the diff reads
 *  are named; everything else (title, summary, notes, semanticChecks, children, ...) rides
 *  along untyped. */
export interface HelpNode {
  path: string[];
  kind: string;
  keys?: HelpKey[];
  /** A step's payload keys (`findRequests`, `printOptions`, ...). Not counted as keys of
   *  their own, as they never were; read only for the page they point at. */
  payloadKeys?: HelpKey[];
  [extra: string]: unknown;
}

export interface HelpJson {
  nodes: HelpNode[];
  [extra: string]: unknown;
}

export interface HelpSummary {
  catalogs: string[];
  ops: string[];
  keysByOp: Record<string, string[]>;
  /** Script steps, as `script:steps:<Step Name>`. Kept apart from `ops` because a step is
   *  not something you can send: it is a member of one op's `steps` array. */
  steps: string[];
  keysByStep: Record<string, string[]>;
}

export interface HelpDiff {
  catalogsAdded: string[];
  catalogsRemoved: string[];
  opsAdded: string[];
  opsRemoved: string[];
  keysAdded: Record<string, string[]>;
  keysRemoved: Record<string, string[]>;
  stepsAdded: string[];
  stepsRemoved: string[];
  stepKeysAdded: Record<string, string[]>;
  stepKeysRemoved: Record<string, string[]>;
}

/** One node's identity the way fm's own help names things everywhere else: its path
 *  segments joined with `:` (`['layout','create']` -> `layout:create`). */
function join(pathSegs: string[]): string {
  return pathSegs.join(':');
}

function isUnder(p: string[], root: string[]): boolean {
  return p.length >= root.length && root.every((seg, i) => p[i] === seg);
}

/** Every key documented at or below `unitPath`, named relative to that unit: the unit's own
 *  node contributes its `keys[].key` bare, and a deeper node (a keyObject or variant child,
 *  at any depth) contributes its keys prefixed by the sub-path beyond the unit --
 *  `layout:create`'s `parts` child's `type` key becomes `parts.type`, not `type`, so it
 *  cannot be confused with the unit's own top-level `type` key.
 *
 *  A key whose `childPath` names a keyObject elsewhere is followed there, and that page's
 *  keys are named under the key: fm 0.12.0 moved `field:create`'s `options` to
 *  `field › options` and `layout:create`'s `objects` to `layout › layoutObject`, and read by
 *  path alone both ops seemed to lose every key they still take. A pointer into the step
 *  roster (`body`, `action`) is not followed, as it never was: it would list every step's
 *  keys under each of them. A page already being followed is not followed again, since
 *  `layoutObject`'s `objects` points at `layoutObject`.
 *
 *  `[]` in a key name is dropped. Through 0.11.0 an array member's keys were spelt into the
 *  name (`sortOrder`'s `fields[].field`); 0.12.0 gives the member a node (`fields`, key
 *  `field`), and both read here as `sortOrder.fields.field`. */
function keysUnder(nodes: HelpNode[], unitPath: string[]): string[] {
  const byPath = new Map(nodes.map((n) => [join(n.path), n]));
  const seen = new Set<string>();
  const walk = (root: string[], prefix: string, following: Set<string>): void => {
    const follow = (k: HelpKey, name: string): void => {
      if (!k.childPath || isUnder(k.childPath, root)) return;
      const id = join(k.childPath);
      if (following.has(id) || byPath.get(id)?.kind !== 'keyObject') return;
      walk(k.childPath, name, new Set([...following, id]));
    };
    for (const node of nodes) {
      if (!isUnder(node.path, root)) continue;
      const sub = [prefix, ...node.path.slice(root.length)].filter(Boolean).join('.');
      for (const k of node.keys ?? []) {
        const name = (sub ? `${sub}.${k.key}` : k.key).replace(/\[\]/g, '');
        seen.add(name);
        follow(k, name);
      }
      for (const k of node.payloadKeys ?? []) follow(k, sub ? `${sub}.${k.key}` : k.key);
    }
  };
  walk(unitPath, '', new Set());
  return [...seen].sort();
}

/** `fm help --json --all`, reduced to catalogs, ops and script steps, and the keys each op
 *  and each step accepts.
 *
 *  A catalog is a `path.length === 1` node of kind `item` -- a `glossary` node at the same
 *  depth (e.g. `forms`, `theme-css`) documents a shape, not something you can probe, so it
 *  is not a catalog. An op is a `path.length === 2` node of kind `op`.
 *
 *  A step is a node of kind `step`, wherever it sits: they hang off `script › steps`, which
 *  is kind `stepRoster` and so is neither a catalog nor an op. Keying steps off their own
 *  kind rather than off that path is what keeps them in view -- summarising ops alone missed
 *  every one of the 218 steps and all ~2000 of their keys, which is how fm 0.8.0 could
 *  document 163 new step keys while `help-diff` reported "no changes". */
export function summariseHelp(json: HelpJson): HelpSummary {
  const catalogs: string[] = [];
  const opPaths: string[][] = [];
  const stepPaths: string[][] = [];
  for (const node of json.nodes) {
    if (node.path.length === 1 && node.kind === 'item') catalogs.push(join(node.path));
    if (node.path.length === 2 && node.kind === 'op') opPaths.push(node.path);
    if (node.kind === 'step') stepPaths.push(node.path);
  }
  const collect = (paths: string[][]): Record<string, string[]> => {
    const byUnit: Record<string, string[]> = {};
    for (const unitPath of paths) {
      const keys = keysUnder(json.nodes, unitPath);
      if (keys.length) byUnit[join(unitPath)] = keys;
    }
    return byUnit;
  };
  return {
    catalogs: catalogs.sort(),
    ops: opPaths.map(join).sort(),
    keysByOp: collect(opPaths),
    steps: stepPaths.map(join).sort(),
    keysByStep: collect(stepPaths),
  };
}

function diffList(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  return { added: next.filter((x) => !prev.includes(x)), removed: prev.filter((x) => !next.includes(x)) };
}

/** Per unit (an op or a step), which of its keys were gained and lost. A unit that vanished
 *  entirely has all of its keys listed as removed, and vice versa for a new one -- the unit
 *  lines in the rendered diff say which of the two happened. */
function diffKeys(
  prev: Record<string, string[]>,
  next: Record<string, string[]>,
): { added: Record<string, string[]>; removed: Record<string, string[]> } {
  const added: Record<string, string[]> = {};
  const removed: Record<string, string[]> = {};
  for (const unit of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const d = diffList(prev[unit] ?? [], next[unit] ?? []);
    if (d.added.length) added[unit] = d.added;
    if (d.removed.length) removed[unit] = d.removed;
  }
  return { added, removed };
}

/** What changed between two builds' help summaries: catalogs, ops and script steps gained or
 *  lost, and per op and per step, keys gained or lost. */
export function diffHelp(prev: HelpSummary, next: HelpSummary): HelpDiff {
  const catalogs = diffList(prev.catalogs, next.catalogs);
  const ops = diffList(prev.ops, next.ops);
  const steps = diffList(prev.steps, next.steps);
  const keys = diffKeys(prev.keysByOp, next.keysByOp);
  const stepKeys = diffKeys(prev.keysByStep, next.keysByStep);
  return {
    catalogsAdded: catalogs.added, catalogsRemoved: catalogs.removed,
    opsAdded: ops.added, opsRemoved: ops.removed,
    keysAdded: keys.added, keysRemoved: keys.removed,
    stepsAdded: steps.added, stepsRemoved: steps.removed,
    stepKeysAdded: stepKeys.added, stepKeysRemoved: stepKeys.removed,
  };
}

/** Markdown-ish, one line per change. `prevLabel`/`nextLabel` head the block so the
 *  standalone `fm-gaps help-diff` output -- which has no other heading around it -- still
 *  says which two builds were compared; a caller that already prints its own heading (like
 *  `check`'s "Help since <prev label>") can treat this as the body under it. */
export function renderHelpDiff(diff: HelpDiff, prevLabel: string, nextLabel: string): string {
  const lines: string[] = [];
  for (const c of diff.catalogsAdded) lines.push(`+ catalog ${c}`);
  for (const c of diff.catalogsRemoved) lines.push(`- catalog ${c}`);
  for (const o of diff.opsAdded) lines.push(`+ op ${o}`);
  for (const o of diff.opsRemoved) lines.push(`- op ${o}`);
  for (const s of diff.stepsAdded) lines.push(`+ step ${s}`);
  for (const s of diff.stepsRemoved) lines.push(`- step ${s}`);
  for (const op of Object.keys(diff.keysAdded).sort()) for (const k of diff.keysAdded[op]) lines.push(`+ key ${op} ${k}`);
  for (const op of Object.keys(diff.keysRemoved).sort()) for (const k of diff.keysRemoved[op]) lines.push(`- key ${op} ${k}`);
  for (const s of Object.keys(diff.stepKeysAdded).sort()) for (const k of diff.stepKeysAdded[s]) lines.push(`+ key ${s} ${k}`);
  for (const s of Object.keys(diff.stepKeysRemoved).sort()) for (const k of diff.stepKeysRemoved[s]) lines.push(`- key ${s} ${k}`);
  if (!lines.length) return 'no changes';
  return [`${prevLabel} -> ${nextLabel}`, ...lines].join('\n');
}
