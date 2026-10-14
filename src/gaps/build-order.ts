/** The trailing build number in a stored snapshot name, e.g. `0.8.0-beta.0-29827611` or
 *  `0.8.0-beta.0-29827611.json` -> 29827611. Null for a build-less name (a bare version,
 *  recorded when fm answers no build). */
function buildNumber(name: string): number | null {
  const m = /-(\d+)(?:\.json)?$/.exec(name);
  return m ? Number(m[1]) : null;
}

function compare(a: string, b: string): number {
  const na = buildNumber(a);
  const nb = buildNumber(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return 1;
  if (nb !== null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Picks the newest OTHER stored name -- what a build's snapshot should be diffed or compared
 *  against. fm's build numbers are a strictly increasing counter regardless of version or
 *  prerelease tag, so ordering by the trailing build number, rather than the name as a string,
 *  reflects release order even where the version string would not: a GA's build number is
 *  always greater than the prerelease it follows, where `0.8.0-29834929` sorts as a string
 *  before `0.8.0-beta.0-29827611`. Falls back to a plain string compare for the rare name with
 *  no build number. */
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
