import { describe, it, expect } from 'vitest';
import { locateFmCli, parseVersionBanner } from '../src/runner/locate.ts';

const BANNER =
  '/Users/x/Library/Application Support/ADT/MCP/fm-cli/fm-cli 0.6.0 (29816214) ' +
  '(commit FORGE/0.5.0/x25-3-g4b45b32f, contract 2, engine 26.0.1)';

describe('parseVersionBanner', () => {
  it('pulls the version and contract out of the banner', () => {
    expect(parseVersionBanner(BANNER)).toEqual({ version: '0.6.0', contract: 2 });
  });

  it('returns null for output that is not an fm banner', () => {
    expect(parseVersionBanner('command not found')).toBeNull();
  });

  it('parses real fm --version output that lacks contract', () => {
    // Verbatim `fm --version` output from ADT 0.6.0
    expect(parseVersionBanner('0.6.0 (29816214)')).toEqual({ version: '0.6.0', contract: null });
  });

  it('keeps a prerelease tag, so a beta is never recorded as the release it precedes', () => {
    // Verbatim `fm --version` output from ADT 0.8.0-beta.0. Dropping the tag would file
    // this build's measurements under plain `0.8.0`, which a consumer comparing its own
    // CLI's version against `gaps/intake.json` would then read as a match for 0.8.0 GA.
    expect(parseVersionBanner('0.8.0-beta.0 (29826143)')).toEqual({ version: '0.8.0-beta.0', contract: null });
  });

  it('does not mistake a hyphenated word after the version for a prerelease tag', () => {
    expect(parseVersionBanner('0.8.0 (29826143) (engine 26.0.1)')).toEqual({ version: '0.8.0', contract: null });
  });
});

describe('locateFmCli', () => {
  const HOME = '/Users/test';

  // `which` defaults to "not on PATH" so a test never spawns a real login shell. `onPath` may
  // be one path for every name, or a name->path map when the launcher name is what is at stake.
  function deps(present: string[], banner = BANNER, onPath: string | Record<string, string> | null = null) {
    return {
      env: {} as NodeJS.ProcessEnv,
      homedir: () => HOME,
      exists: (path: string) => present.includes(path),
      probe: async (path: string) => (present.includes(path) ? banner : null),
      which: async (name: string) =>
        typeof onPath === 'string' ? onPath : (onPath?.[name] ?? null),
    };
  }

  it('prefers the FM_CLI_PATH override over anything else', async () => {
    const found = await locateFmCli({
      ...deps(['/custom/fm', '/usr/local/bin/fm']),
      env: { FM_CLI_PATH: '/custom/fm' } as NodeJS.ProcessEnv,
    });
    expect(found?.path).toBe('/custom/fm');
  });

  it('finds the binary at /usr/local/bin/fm', async () => {
    const found = await locateFmCli(deps(['/usr/local/bin/fm']));
    expect(found).toEqual({ path: '/usr/local/bin/fm', version: '0.6.0', contract: 2 });
  });

  // 0.8.0 renamed the launcher. That build installs `/usr/local/bin/filemaker` -- a wrapper
  // that execs the real binary under Application Support -- and installs no `fm` at all.
  // Measured on 0.8.0 (29834929): `command -v fm` finds nothing on a machine with it installed.
  it('finds the 0.8.0 launcher, which is named filemaker and not fm', async () => {
    const found = await locateFmCli(deps(['/usr/local/bin/filemaker']));
    expect(found).toEqual({ path: '/usr/local/bin/filemaker', version: '0.6.0', contract: 2 });
  });

  it('finds the renamed launcher under Homebrew too', async () => {
    const found = await locateFmCli(deps(['/opt/homebrew/bin/filemaker']));
    expect(found?.path).toBe('/opt/homebrew/bin/filemaker');
  });

  // An in-place upgrade can leave both names in one directory. The current one is the build
  // the rest of this repo is measured against, so it has to win.
  it('prefers the current name over a leftover fm in the same directory', async () => {
    const found = await locateFmCli(deps(['/usr/local/bin/fm', '/usr/local/bin/filemaker']));
    expect(found?.path).toBe('/usr/local/bin/filemaker');
  });

  // Which install location wins is unchanged by adding a second name to look for.
  it('still prefers /usr/local/bin over Homebrew', async () => {
    const found = await locateFmCli(
      deps(['/usr/local/bin/filemaker', '/opt/homebrew/bin/filemaker']),
    );
    expect(found?.path).toBe('/usr/local/bin/filemaker');
  });

  it('falls back to the ADT Application Support path', async () => {
    const adtPath = `${HOME}/Library/Application Support/ADT/MCP/fm-cli/fm-cli`;
    const found = await locateFmCli(deps([adtPath]));
    expect(found?.path).toBe(adtPath);
  });

  // This is why 0.8.0's rename cost this repo nothing and was missed here: the real binary
  // keeps its own name, so the locator resolved it and no probe, register row or exit code
  // differed. Worth pinning as the behaviour it is -- it is what makes the toolkit survive a
  // rename -- and worth knowing that it is also what hides one. `gaps/intake.json` records
  // which binary answered so the next rename is visible somewhere.
  it('resolves the unrenamed real binary when NEITHER launcher name is installed', async () => {
    const adtPath = `${HOME}/Library/Application Support/ADT/MCP/fm-cli/fm-cli`;
    const found = await locateFmCli(deps([adtPath]));
    expect(found?.path).toBe(adtPath);
    expect(await locateFmCli(deps(['/usr/local/bin/fm']))).not.toBeNull();
    // Neither launcher, no Application Support install: nothing to find.
    expect(await locateFmCli(deps([]))).toBeNull();
  });

  it('does not depend on PATH — an empty PATH still finds an explicit candidate', async () => {
    const found = await locateFmCli({
      ...deps(['/usr/local/bin/fm']),
      env: { PATH: '' } as NodeJS.ProcessEnv,
    });
    expect(found?.path).toBe('/usr/local/bin/fm');
  });

  it('returns null when nothing is installed', async () => {
    expect(await locateFmCli(deps([]))).toBeNull();
  });

  it('rejects a candidate that exists but does not identify itself as fm', async () => {
    const found = await locateFmCli(deps(['/usr/local/bin/fm'], 'not the fm cli'));
    expect(found).toBeNull();
  });

  it('falls back to a login-shell PATH lookup when no explicit path has it', async () => {
    const found = await locateFmCli(deps(['/opt/custom/bin/fm'], BANNER, '/opt/custom/bin/fm'));
    expect(found?.path).toBe('/opt/custom/bin/fm');
  });

  // PATH must stay the LAST resort: a Finder-launched Electron app has a minimal
  // PATH, so anything that depended on it would work in dev and fail packaged.
  it('prefers an explicit path over whatever is on PATH', async () => {
    const found = await locateFmCli(
      deps(['/usr/local/bin/fm', '/opt/custom/bin/fm'], BANNER, '/opt/custom/bin/fm'),
    );
    expect(found?.path).toBe('/usr/local/bin/fm');
  });

  it('rejects a PATH hit that does not verify', async () => {
    const found = await locateFmCli(deps([], 'not the fm cli', '/opt/custom/bin/fm'));
    expect(found).toBeNull();
  });

  // The PATH branch exists for a user who installed the CLI somewhere of their own, and that
  // somewhere is named whatever their build called it — so it has to ask for both names.
  it('asks PATH for the current launcher name, not only for fm', async () => {
    const found = await locateFmCli(
      deps(['/opt/custom/bin/filemaker'], BANNER, { filemaker: '/opt/custom/bin/filemaker' }),
    );
    expect(found?.path).toBe('/opt/custom/bin/filemaker');
  });

  it('still asks PATH for fm, for a machine that never got the renamed build', async () => {
    const found = await locateFmCli(deps(['/opt/custom/bin/fm'], BANNER, { fm: '/opt/custom/bin/fm' }));
    expect(found?.path).toBe('/opt/custom/bin/fm');
  });

  it('does not let an unverifiable PATH hit for one name shadow a good one for the other', async () => {
    const found = await locateFmCli({
      ...deps(['/opt/custom/bin/fm'], BANNER, {
        filemaker: '/opt/custom/bin/filemaker',
        fm: '/opt/custom/bin/fm',
      }),
      // `filemaker` is on PATH but is something else entirely; `fm` is the real one.
      exists: (path: string) => ['/opt/custom/bin/filemaker', '/opt/custom/bin/fm'].includes(path),
      probe: async (path: string) => (path === '/opt/custom/bin/fm' ? BANNER : 'not the fm cli'),
    });
    expect(found?.path).toBe('/opt/custom/bin/fm');
  });
});
