import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** A located, verified ADT CLI. */
export interface FmCli {
  path: string;
  version: string;
  contract: number | null;
}

export interface LocateDeps {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  exists?: (path: string) => boolean;
  probe?: (path: string) => Promise<string | null>;
  /** Resolve `fm` on the user's own PATH. The last resort; see locateFmCli. */
  which?: () => Promise<string | null>;
}

/** Pull the version and contract out of the CLI's --version banner.
 *  Returns null for anything that is not recognizably that banner.
 *  Version is required; contract is optional (null when absent). */
export function parseVersionBanner(output: string): { version: string; contract: number | null } | null {
  const version = output.match(/\b(\d+\.\d+\.\d+)\b/);
  if (!version) return null;

  const contract = output.match(/\bcontract\s+(\d+)\b/);
  return {
    version: version[1],
    contract: contract ? Number(contract[1]) : null,
  };
}

async function defaultProbe(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(path, ['--version'], { timeout: 10_000 });
    return stdout;
  } catch {
    return null;
  }
}

/** Ask the user's own login shell where `fm` is.
 *
 *  A login shell so the user's profile is sourced: that is the whole point —
 *  the app's own PATH is not the user's. `command -v` rather than `which`
 *  because it is a shell builtin and needs nothing on PATH itself.
 */
async function defaultWhich(): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', 'command -v fm'], { timeout: 10_000 });
    // A profile that prints a banner leaves the answer on the last line.
    const path = stdout.trim().split('\n').pop()?.trim();
    return path && path.startsWith('/') ? path : null;
  } catch {
    return null;
  }
}

/** Verify one candidate by its --version banner. */
async function verify(
  path: string,
  exists: (path: string) => boolean,
  probe: (path: string) => Promise<string | null>,
): Promise<FmCli | null> {
  if (!exists(path)) return null;
  const output = await probe(path);
  if (!output) return null;
  const parsed = parseVersionBanner(output);
  return parsed ? { path, ...parsed } : null;
}

/** Resolve `fm` from an explicit list of candidates, verifying each by --version.
 *
 *  A login-shell PATH lookup is the LAST resort on purpose, and must stay there:
 *  an Electron app launched from Finder inherits a minimal PATH without
 *  /usr/local/bin, so a PATH-first lookup works under `npm run dev` and fails in
 *  the packaged app. It can only ever be a bonus for a user who installed `fm`
 *  somewhere else — never the mechanism the feature depends on.
 */
export async function locateFmCli(deps: LocateDeps = {}): Promise<FmCli | null> {
  const env = deps.env ?? process.env;
  const home = (deps.homedir ?? homedir)();
  const exists = deps.exists ?? existsSync;
  const probe = deps.probe ?? defaultProbe;
  const which = deps.which ?? defaultWhich;

  const candidates = [
    env.FM_CLI_PATH,
    '/usr/local/bin/fm',
    '/opt/homebrew/bin/fm',
    join(home, 'Library', 'Application Support', 'ADT', 'MCP', 'fm-cli', 'fm-cli'),
  ].filter((path): path is string => Boolean(path));

  for (const path of candidates) {
    const found = await verify(path, exists, probe);
    if (found) return found;
  }

  const onPath = await which();
  return onPath ? verify(onPath, exists, probe) : null;
}
