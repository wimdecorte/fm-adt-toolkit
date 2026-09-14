import fs from 'node:fs';
import path from 'node:path';
import { parseXml } from './xml-walk.ts';
import type { XmlNode } from './xml-walk.ts';
import { KINDS, groupSlug, layoutObjectFmType } from './kinds.ts';
import type { KindRule } from './kinds.ts';

export interface ReferenceInstance { id: string; name?: string; context: Record<string, string> }
export interface ReferenceAttribute { path: string; present: number }
export interface Reference {
  kindId: string; op: string; kind: string; file: string; exportLabel: string; source: string;
  instances: ReferenceInstance[]; attributes: ReferenceAttribute[];
  /** The fm `(type, control)` pair for a layout-object kind, so `draft` can confirm the selected
   *  instance's type. Present only for `layout-object` references, and only when every instance in
   *  the group resolves to the same fm type (true for every SaXML `@type` value observed in Ooe). */
  fmType?: { type: string; control: string | null };
}

const CHUNK = /^_[0-9A-Fa-f]{8}-/;   // DDR_INFO chunk elements are named after uuids; never attributes of anything

/** Find every element reached by `chain` from `root`. '*' matches any number of intermediate elements. */
export function findByChain(root: XmlNode, chain: string[]): { node: XmlNode; ancestors: XmlNode[] }[] {
  const out: { node: XmlNode; ancestors: XmlNode[] }[] = [];
  const walk = (node: XmlNode, i: number, ancestors: XmlNode[]) => {
    if (i === chain.length) { out.push({ node, ancestors }); return; }
    const want = chain[i];
    for (const c of node.children) {
      if (want === '*') {
        // '*' may match zero or more elements: try to match the next segment here, and also descend
        if (i + 1 < chain.length && c.tag === chain[i + 1]) walk(c, i + 2, [...ancestors, node]);
        walk(c, i, [...ancestors, node]);
      } else if (c.tag === want) {
        walk(c, i + 1, [...ancestors, node]);
      }
    }
  };
  walk(root, 0, []);
  return out;
}

/** Attribute paths of one instance: '@attr' on the element itself, 'Child@attr', 'Child/Grand@attr',
 *  and 'Child' for an element that carries text. Subtrees named in `skip` and chunk elements are not
 *  descended. Names only: no values are returned. */
export function attributePaths(node: XmlNode, skip: string[]): string[] {
  const out = new Set<string>();
  for (const a of Object.keys(node.attrs)) out.add('@' + a);
  const walk = (el: XmlNode, prefix: string) => {
    for (const c of el.children) {
      if (skip.includes(c.tag) || CHUNK.test(c.tag)) continue;
      const p = prefix ? prefix + '/' + c.tag : c.tag;
      if (c.text.trim() !== '' || c.children.length === 0) out.add(p);
      for (const a of Object.keys(c.attrs)) out.add(p + '@' + a);
      walk(c, p);
    }
  };
  walk(node, '');
  return [...out].sort();
}

function contextOf(rule: KindRule, ancestors: XmlNode[], node: XmlNode): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const a of ancestors) {
    if (a.tag === 'Layout') ctx.layout = a.attrs.name ?? '';
    if (a.tag === 'Part') ctx.part = a.attrs.type ?? '';
    // `FieldCatalog` here is the per-table wrapper inside FieldsForTables (one per base table), not
    // the top-level catalog file of the same name; the table it belongs to is its own
    // `BaseTableReference` child, not an attribute of a `BaseTable` ancestor (there is no such
    // ancestor: the real export never nests Field under an element literally named `BaseTable`).
    if (a.tag === 'FieldCatalog') {
      const ref = a.children.find((c) => c.tag === 'BaseTableReference');
      ctx.table = ref?.attrs.name ?? '';
    }
    // `Script` names one script two different ways depending on which catalog it comes from:
    // ScriptCatalog's own `Script` carries `name` directly; StepsForScripts' `Script` carries none
    // and points at its script through a `ScriptReference` child instead. Only the name is kept in
    // context (probes look scripts up by name, like `read:layout` does for layouts).
    if (a.tag === 'Script') {
      ctx.script = a.attrs.name ?? a.children.find((c) => c.tag === 'ScriptReference')?.attrs.name ?? '';
    }
    if (a.tag === 'CustomMenu') ctx.menuId = a.attrs.id ?? '';
  }
  if (rule.kind === 'step') ctx.stepName = node.attrs.name ?? '';
  if (rule.kind === 'customMenuItem') ctx.index = node.attrs.index ?? String(ancestors[ancestors.length - 1].children.indexOf(node));
  return ctx;
}

function readGroupPart(node: XmlNode, part: string): string {
  const at = part.indexOf('@');
  if (at > 0) {
    const child = node.children.find((c) => c.tag === part.slice(0, at));
    return child?.attrs[part.slice(at + 1)] ?? '';
  }
  return node.attrs[part] ?? '';
}

/** A plain attribute name ('type'), the 'Child@attr' form ('Source@value'), or several of either
 *  joined with '+' ('datatype+fieldtype') whose values are joined with '/' for the group's display
 *  name ('Text/Normal') — Field needs both datatype and fieldtype because a calculation field and
 *  a summary field of the same datatype carry different option sets. */
function groupValue(node: XmlNode, groupBy: string): string {
  if (groupBy.includes('+')) return groupBy.split('+').map((part) => readGroupPart(node, part)).join('/');
  return readGroupPart(node, groupBy);
}

export function enumerateKind(root: XmlNode, rule: KindRule, exportLabel: string): Reference[] {
  const hits = findByChain(root, rule.path);
  const groups = new Map<string, { node: XmlNode; ancestors: XmlNode[] }[]>();
  for (const h of hits) {
    const raw = rule.groupBy ? groupValue(h.node, rule.groupBy) : '';
    const g = rule.groupKey ? rule.groupKey(h.node, raw) : raw;
    groups.set(g, [...(groups.get(g) ?? []), h]);
  }
  const refs: Reference[] = [];
  for (const [g, list] of groups) {
    const kindId = rule.groupBy ? `${rule.id}:${groupSlug(g) || 'none'}` : rule.id;
    const kind = rule.groupBy ? `${rule.kind}:${g}` : rule.kind;
    const counts = new Map<string, number>();
    const instances: ReferenceInstance[] = [];
    for (const { node, ancestors } of list) {
      for (const p of attributePaths(node, rule.skip)) counts.set(p, (counts.get(p) ?? 0) + 1);
      instances.push({
        id: rule.idAttr ? node.attrs[rule.idAttr] ?? '' : String(instances.length),
        ...(node.attrs.name !== undefined ? { name: node.attrs.name } : {}),
        context: contextOf(rule, ancestors, node),
      });
    }
    const ref: Reference = {
      kindId, op: rule.op, kind, file: rule.file, exportLabel, source: root.attrs.Source ?? '',
      instances,
      attributes: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, n]) => ({ path: p, present: n })),
    };
    if (rule.id === 'layout-object') {
      const types = new Set(list.map(({ node }) => JSON.stringify(layoutObjectFmType(node) ?? null)));
      if (types.size === 1) {
        const only = layoutObjectFmType(list[0].node);
        if (only) ref.fmType = only;
      }
    }
    refs.push(ref);
  }
  return refs;
}

export function enumerateExport(dir: string, filePrefix: string, exportLabel: string): Reference[] {
  const roots = new Map<string, XmlNode>();
  const rootFor = (file: string): XmlNode => {
    let r = roots.get(file);
    if (!r) { r = parseXml(fs.readFileSync(path.join(dir, `${filePrefix}_${file}.xml`), 'utf8')); roots.set(file, r); }
    return r;
  };
  const refs: Reference[] = [];
  for (const rule of KINDS) {
    const file = path.join(dir, `${filePrefix}_${rule.file}.xml`);
    if (!fs.existsSync(file)) continue;
    refs.push(...enumerateKind(rootFor(rule.file), rule, exportLabel));
  }
  return refs;
}

export function writeReferences(outDir: string, refs: Reference[]): string[] {
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const r of refs) {
    const f = path.join(outDir, r.kindId.replace(/[^a-z0-9:-]/gi, '-') + '.json');
    fs.writeFileSync(f, JSON.stringify(r, null, 2) + '\n');
    written.push(f);
  }
  return written;
}
