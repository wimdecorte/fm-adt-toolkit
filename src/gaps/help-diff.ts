/** Pure, browser-safe reduction of `fm help --json --all` to what a build-to-build diff
 *  cares about: which catalogs and ops exist, and which keys each op accepts (including
 *  keys nested arbitrarily deep under a keyObject/variant child). No `node:` imports here --
 *  this is evaluated the same way a server or a browser tool would. */

export interface HelpKey {
  key: string;
  type?: string;
  condition?: string;
  summary?: string;
  enum?: unknown;
}

/** One entry of `fm help --json --all`'s flat `nodes` array. Only the fields the diff reads
 *  are named; everything else (title, summary, notes, semanticChecks, children, ...) rides
 *  along untyped. */
export interface HelpNode {
  path: string[];
  kind: string;
  keys?: HelpKey[];
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
}

export interface HelpDiff {
  catalogsAdded: string[];
  catalogsRemoved: string[];
  opsAdded: string[];
  opsRemoved: string[];
  keysAdded: Record<string, string[]>;
  keysRemoved: Record<string, string[]>;
}

/** One node's identity the way fm's own help names things everywhere else: its path
 *  segments joined with `:` (`['layout','create']` -> `layout:create`). */
function join(pathSegs: string[]): string {
  return pathSegs.join(':');
}

/** `fm help --json --all`, reduced to catalogs, ops, and the keys each op accepts.
 *
 *  A catalog is a `path.length === 1` node of kind `item` -- a `glossary` node at the same
 *  depth (e.g. `forms`, `theme-css`) documents a shape, not something you can probe, so it
 *  is not a catalog. An op is a `path.length === 2` node of kind `op`.
 *
 *  An op's keys come from every node whose path starts with the op's own path: the op node
 *  itself contributes its top-level `keys[].key` bare, and a deeper node (a keyObject or
 *  variant child, at any depth) contributes its keys prefixed by the sub-path beyond the
 *  op -- `layout:create`'s `parts` child's `type` key becomes `parts.type`, not `type`,
 *  so it cannot be confused with the op's own top-level `type` key. */
export function summariseHelp(json: HelpJson): HelpSummary {
  const catalogs: string[] = [];
  const opPaths: string[][] = [];
  for (const node of json.nodes) {
    if (node.path.length === 1 && node.kind === 'item') catalogs.push(join(node.path));
    if (node.path.length === 2 && node.kind === 'op') opPaths.push(node.path);
  }
  const keysByOp: Record<string, string[]> = {};
  for (const opPath of opPaths) {
    const opKey = join(opPath);
    const seen = new Set<string>();
    for (const node of json.nodes) {
      if (node.path.length < opPath.length) continue;
      if (opPath.some((seg, i) => node.path[i] !== seg)) continue;
      if (!node.keys) continue;
      const sub = node.path.slice(opPath.length).join('.');
      for (const k of node.keys) seen.add(sub ? `${sub}.${k.key}` : k.key);
    }
    if (seen.size) keysByOp[opKey] = [...seen].sort();
  }
  return { catalogs: catalogs.sort(), ops: opPaths.map(join).sort(), keysByOp };
}

function diffList(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  return { added: next.filter((x) => !prev.includes(x)), removed: prev.filter((x) => !next.includes(x)) };
}

/** What changed between two builds' help summaries: catalogs and ops gained or lost, and
 *  per op, keys gained or lost. An op that disappeared entirely still shows up under
 *  `opsRemoved`; its keys are not separately listed under `keysRemoved` too. */
export function diffHelp(prev: HelpSummary, next: HelpSummary): HelpDiff {
  const catalogs = diffList(prev.catalogs, next.catalogs);
  const ops = diffList(prev.ops, next.ops);
  const keysAdded: Record<string, string[]> = {};
  const keysRemoved: Record<string, string[]> = {};
  const allOps = new Set([...Object.keys(prev.keysByOp), ...Object.keys(next.keysByOp)]);
  for (const op of allOps) {
    const { added, removed } = diffList(prev.keysByOp[op] ?? [], next.keysByOp[op] ?? []);
    if (added.length) keysAdded[op] = added;
    if (removed.length) keysRemoved[op] = removed;
  }
  return { catalogsAdded: catalogs.added, catalogsRemoved: catalogs.removed, opsAdded: ops.added, opsRemoved: ops.removed, keysAdded, keysRemoved };
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
  for (const op of Object.keys(diff.keysAdded).sort()) for (const k of diff.keysAdded[op]) lines.push(`+ key ${op} ${k}`);
  for (const op of Object.keys(diff.keysRemoved).sort()) for (const k of diff.keysRemoved[op]) lines.push(`- key ${op} ${k}`);
  if (!lines.length) return 'no changes';
  return [`${prevLabel} -> ${nextLabel}`, ...lines].join('\n');
}
