/** A selector is dotted path segments; a segment may be `name[key=value]` to pick one
 *  element of an array; a leading `**` on the first segment means "search every array
 *  of that name at any depth". Values compare as strings. */
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
    return v.find((x) => x && typeof x === 'object' && String((x as Record<string, unknown>)[m[2]]) === m[3]);
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
