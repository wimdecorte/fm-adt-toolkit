import { normaliseName } from './match.ts';

/** A selector is dotted path segments; a segment may be `name[key=value]` to pick one
 *  element of an array; a leading `**` on the first segment means "search every array
 *  of that name at any depth". Values compare as strings, ignoring case and every
 *  non-alphanumeric character on both sides: the reference export writes a part type as
 *  `Body` or `Leading Sub-summary` and fm answers `body` or `leadingSubSummary`, and a
 *  selector drafted from the export must still find fm's instance. */
export function selectInstance(result: unknown, selector: string | undefined): unknown {
  if (!selector) return result;
  const deep = selector.startsWith('**');
  const segs = (deep ? selector.slice(2) : selector).split('.').filter(Boolean);
  const step = (cur: unknown, seg: string): unknown => {
    const m = seg.match(/^([^[]+)(?:\[([^=\]]+)=([^\]]*)\])?$/);
    if (!m || cur === null || typeof cur !== 'object') return undefined;
    const v = (cur as Record<string, unknown>)[m[1]];
    if (m[2] === undefined) return v;
    if (!Array.isArray(v)) return undefined;
    const want = normaliseName(m[3]);
    return v.find((x) => x && typeof x === 'object' && normaliseName(String((x as Record<string, unknown>)[m[2]])) === want);
  };
  if (!deep) return segs.reduce<unknown>((cur, seg) => step(cur, seg), result);
  const first = segs[0];
  const found: unknown[] = [];
  const walk = (cur: unknown) => {
    if (found.length || cur === null || typeof cur !== 'object') return;
    const r = step(cur, first);
    if (r !== undefined) { found.push(r); return; }
    for (const v of Object.values(cur as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
      if (found.length) return;
    }
  };
  walk(result);
  if (!found.length) return undefined;
  return segs.slice(1).reduce<unknown>((cur, seg) => step(cur, seg), found[0]);
}

/** The container a selector filters: the selector with its `[key=value]` predicates
 *  dropped. `contents.parts[type=Body]` -> `contents.parts`; `**objects[id=21]` ->
 *  `**objects`. A selector with no predicate is its own container. */
export function selectorContainer(selector: string): string {
  return selector.replace(/\[[^\]]*\]/g, '');
}

/** Why a selector found nothing: the container itself is missing from the instance, or
 *  the container is there and no element of it matched. The two are different facts about
 *  fm -- "this op reports no parts at all" versus "it reports parts and none is a Body" --
 *  and only the first is the gap the parts entries are waiting on. */
export function selectorFailure(result: unknown, selector: string): { kind: 'container-absent' | 'no-match'; container: string } {
  const container = selectorContainer(selector);
  return { kind: selectInstance(result, container) === undefined ? 'container-absent' : 'no-match', container };
}
