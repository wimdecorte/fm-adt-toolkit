import { describe, it, expect } from 'vitest';
import { newest, newestOther } from '../src/gaps/build-order.ts';

describe('newestOther', () => {
  it('returns null with no other names', () => {
    expect(newestOther([], '0.7.0-29823677')).toBeNull();
    expect(newestOther(['0.7.0-29823677'], '0.7.0-29823677')).toBeNull();
  });

  it('orders by version, not by string, so a GA sorts after its own prereleases', () => {
    const names = ['0.7.0-29823677', '0.8.0-beta.0-29827611', '0.8.0-29834929'];
    // As strings, '0.8.0-29834929' < '0.8.0-beta.0-29827611' ('2' < 'b'), which is wrong: a
    // release follows its own prereleases.
    expect(newestOther(names, '0.9.0-29846589')).toBe('0.8.0-29834929');
  });

  it('orders by version before build, because 0.12.0 restarted the build counter', () => {
    // 0.12.0 announces itself as `0.12.0 (42)`; every build before it was eight digits. Ordering
    // by build number put 0.12.0 below 0.6.0, so the next intake would diff against 0.11.0.
    const names = ['0.10.0-29853940', '0.11.0-29863806', '0.12.0-42'];
    expect(newestOther(names, '0.13.0-50')).toBe('0.12.0-42');
    expect(newestOther(names, '0.12.0-42')).toBe('0.11.0-29863806');
  });

  it('breaks a tie between two builds of one version by build number', () => {
    expect(newestOther(['0.12.0-43', '0.12.0-42', '0.11.0-29863806'], '0.13.0-50')).toBe('0.12.0-43');
  });

  it('compares prerelease identifiers numerically, as semver does', () => {
    // As strings, 'beta.10' < 'beta.2'.
    expect(newestOther(['0.8.0-beta.10', '0.8.0-beta.2'], '0.8.0')).toBe('0.8.0-beta.10');
  });

  it('excludes only the exact current name, and works with .json-suffixed names', () => {
    const names = ['0.7.0-29823677.json', '0.8.0-29834929.json'];
    expect(newestOther(names, '0.8.0-29834929.json')).toBe('0.7.0-29823677.json');
  });

  it('falls back to a string compare when a name carries no build number', () => {
    expect(newestOther(['0.6.0', '0.7.0'], '0.8.0')).toBe('0.7.0');
    expect(newestOther(['0.6.0', '0.7.0-1'], '0.8.0')).toBe('0.7.0-1');
    // Within one version, a build-numbered name outranks a build-less one.
    expect(newestOther(['0.7.0-1', '0.7.0'], '0.8.0')).toBe('0.7.0-1');
  });
});

describe('newest', () => {
  it('returns null with no names', () => {
    expect(newest([])).toBeNull();
  });

  it('orders by version, so a two-digit minor version is not taken for an older one', () => {
    // As strings, '0.9.0-29846589.json' > '0.11.0-29863806.json' ('9' > '1'), which is what made
    // `help-diff` default --to to 0.9.0 on the 0.11.0 intake.
    const names = ['0.10.0-29853940.json', '0.11.0-29863806.json', '0.9.0-29846589.json'];
    expect(newest(names)).toBe('0.11.0-29863806.json');
  });

  it('takes 0.12.0 (42) as newer than 0.11.0 (29863806)', () => {
    const names = ['0.10.0-29853940.json', '0.11.0-29863806.json', '0.12.0-42.json'];
    expect(newest(names)).toBe('0.12.0-42.json');
  });
});
