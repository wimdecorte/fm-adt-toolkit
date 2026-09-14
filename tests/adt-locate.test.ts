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
});

describe('locateFmCli', () => {
  const HOME = '/Users/test';

  // `which` defaults to "not on PATH" so a test never spawns a real login shell.
  function deps(present: string[], banner = BANNER, onPath: string | null = null) {
    return {
      env: {} as NodeJS.ProcessEnv,
      homedir: () => HOME,
      exists: (path: string) => present.includes(path),
      probe: async (path: string) => (present.includes(path) ? banner : null),
      which: async () => onPath,
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

  it('falls back to the ADT Application Support path', async () => {
    const adtPath = `${HOME}/Library/Application Support/ADT/MCP/fm-cli/fm-cli`;
    const found = await locateFmCli(deps([adtPath]));
    expect(found?.path).toBe(adtPath);
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
});
