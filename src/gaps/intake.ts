import fs from 'node:fs';
import path from 'node:path';

/** Which fm build this repo's measurements came from. Written by `check`, never by hand:
 *  the build is read off the CLI that just answered the probes, so the record cannot
 *  disagree with the run that produced it. */
export interface Intake {
  /** The CLI's own `--version`, e.g. `0.7.0`. */
  version: string;
  /** The build number in that banner's parentheses, e.g. `29823677`. Empty when the
   *  banner carried none -- `evidenceDir` treats that the same way. */
  build: string;
  /** The date of the `check` run that wrote this, `YYYY-MM-DD`. */
  checked: string;
}

/** One file for the whole repo, not one per build: this says which build the register,
 *  the evidence and the shipped catalogs are CURRENTLY measured against, so a consumer
 *  can read it without first knowing what to look for. The per-build history lives in
 *  `gaps/help/` and `gaps/evidence/`, keyed on `<version>-<build>`. */
export function intakePath(root: string): string {
  return path.join(root, 'gaps', 'intake.json');
}

/** Records the build `check` just ran against. Called where the register is saved rather
 *  than where the help snapshot is captured: the point of the file is that it always agrees
 *  with the register's `lastChecked` stamps, so a run that does not write the register --
 *  a fatal batch -- must not write this either.
 *
 *  Pretty-printed and newline-terminated because its whole audience is a human reading a
 *  diff and asking "which build is this tree on?". */
export function writeIntake(root: string, version: string, build: string, checked: string): void {
  const abs = intakePath(root);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ version, build, checked }, null, 2) + '\n');
}

/** The recorded intake, or null when there is none to read. Null covers both a root no
 *  `check` has ever run against and a file too damaged to parse: a consumer's version
 *  comparison is a courtesy warning, so a corrupt record must degrade to "cannot say"
 *  rather than throw inside somebody else's startup path. */
export function readIntake(root: string): Intake | null {
  try {
    return JSON.parse(fs.readFileSync(intakePath(root), 'utf8')) as Intake;
  } catch {
    return null;
  }
}
