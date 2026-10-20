/** A stored snapshot name split into the CLI's version and the build in its banner's
 *  parentheses, e.g. `0.8.0-beta.0-29827611` or `0.8.0-beta.0-29827611.json` ->
 *  `0.8.0-beta.0` and 29827611. The build is null for a build-less name (a bare version,
 *  recorded when fm answers no build); the whole result is null for a name that is not a
 *  version at all. */
function parseName(name: string): { core: number[]; pre: string[]; build: number | null } | null {
  const base = name.replace(/\.json$/, '');
  // A prerelease tag must carry a letter (`beta.0`), so `0.7.0-1` reads as build 1.
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]*[A-Za-z][0-9A-Za-z.]*))?(?:-(\d+))?$/.exec(base);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
    build: m[5] !== undefined ? Number(m[5]) : null,
  };
}

/** Semver's prerelease precedence: none outranks any, numeric identifiers compare as numbers
 *  and below alphanumeric ones, and a longer list outranks its own prefix. */
function comparePre(a: string[], b: string[]): number {
  if (!a.length || !b.length) return b.length - a.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const na = /^\d+$/.test(a[i]!), nb = /^\d+$/.test(b[i]!);
    if (na && nb) { const d = Number(a[i]) - Number(b[i]); if (d) return d; continue; }
    if (na !== nb) return na ? -1 : 1;
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length - b.length;
}

function compare(a: string, b: string): number {
  const pa = parseName(a);
  const pb = parseName(b);
  if (pa && pb) {
    for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i]! - pb.core[i]!;
    const d = comparePre(pa.pre, pb.pre);
    if (d) return d;
    if (pa.build !== null && pb.build !== null) return pa.build - pb.build;
    if (pa.build !== null) return 1;
    if (pb.build !== null) return -1;
    return 0;
  }
  if (pa) return 1;
  if (pb) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Picks the newest OTHER stored name -- what a build's snapshot should be diffed or compared
 *  against. Ordered by version, semver-style, and only then by build number: a GA sorts after
 *  the prerelease it follows, where `0.8.0-29834929` sorts as a string before
 *  `0.8.0-beta.0-29827611`. The build number used to be the whole order, on the strength of
 *  every build through 0.11.0 carrying a larger one than the last; 0.12.0 announced itself as
 *  `0.12.0 (42)` after 0.11.0's 29863806, so the build now only breaks a tie between two
 *  builds of one version. Falls back to a plain string compare for a name that is not a
 *  version. */
export function newestOther(names: string[], current: string): string | null {
  return newest(names.filter((n) => n !== current));
}

/** Picks the newest stored name by the same order as `newestOther`, for a caller with no
 *  current build to exclude -- `help-diff`'s default `--to`. A string sort gets this wrong as
 *  soon as a version component reaches two digits: '0.9.0-...' sorts after '0.11.0-...'. */
export function newest(names: string[]): string | null {
  if (!names.length) return null;
  return names.reduce((best, n) => (compare(n, best) > 0 ? n : best));
}
