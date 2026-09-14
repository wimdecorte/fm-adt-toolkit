export function flattenKeys(value: unknown, depth = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => { if (!seen.has(p)) { seen.add(p); out.push(p); } };
  const walk = (v: unknown, prefix: string, d: number) => {
    if (d === 0 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      // Any element of the array can carry a key the others do not (e.g. a script
      // trigger's `parameter`, present only on a later trigger) — walk all of them,
      // not just the first, so the union of their keys is reported.
      for (const x of v) if (x && typeof x === 'object') walk(x, prefix + '[]', d);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k;
      push(p);
      walk(x, p, d - 1);
    }
  };
  walk(value, '', depth);
  return out;
}

export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** For each SaXML path, the fm key whose normalised form equals one candidate built from
 *  the path: the immediate element plus attribute (for `Elem@attr` segments), each ancestor
 *  element plus attribute in turn from innermost to outermost, and finally the bare attribute
 *  (or, when the path names no attribute, each trailing element alone, innermost first). The
 *  first candidate with exactly one matching key wins; a candidate matching several keys of
 *  the same dotted depth leaves the path unmatched rather than guessing. */
export function autoMatch(paths: string[], keys: string[]): Record<string, string | null> {
  const byNorm = new Map<string, string[]>();
  for (const k of keys) {
    const nk = normaliseName(k.replace(/\[\]/g, ''));
    byNorm.set(nk, [...(byNorm.get(nk) ?? []), k]);
  }
  const pick = (cands: string[] | undefined): string | null => {
    if (!cands || cands.length === 0) return null;
    const shortest = Math.min(...cands.map((c) => c.split('.').length));
    const best = cands.filter((c) => c.split('.').length === shortest);
    return best.length === 1 ? best[0] : null;
  };
  const out: Record<string, string | null> = {};
  for (const p of paths) {
    const segs = p.split('/');
    const last = segs[segs.length - 1];                  // 'FieldReference@name', '@name' or 'HideWhenPrinting'
    const atIdx = last.indexOf('@');
    const hasAttr = atIdx !== -1;
    const attr = hasAttr ? last.slice(atIdx + 1) : '';
    const lastElem = hasAttr ? last.slice(0, atIdx) : last;
    const elements = [...segs.slice(0, -1), ...(lastElem ? [lastElem] : [])];   // outer -> inner
    const candidates: string[] = [];
    for (let i = elements.length - 1; i >= 0; i--) candidates.push(normaliseName(elements[i] + attr));
    if (hasAttr) candidates.push(normaliseName(attr));
    let match: string | null = null;
    for (const c of candidates) { match = pick(byNorm.get(c)); if (match) break; }
    out[p] = match;
  }
  return out;
}
