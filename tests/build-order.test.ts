import { describe, it, expect } from 'vitest';
import { newestOther } from '../src/gaps/build-order.ts';

describe('newestOther', () => {
  it('returns null with no other names', () => {
    expect(newestOther([], '0.7.0-29823677')).toBeNull();
    expect(newestOther(['0.7.0-29823677'], '0.7.0-29823677')).toBeNull();
  });

  it('orders by build number, not by string, so a GA sorts after its own prereleases', () => {
    const names = ['0.7.0-29823677', '0.8.0-beta.0-29827611', '0.8.0-29834929'];
    // As strings, '0.8.0-29834929' < '0.8.0-beta.0-29827611' ('2' < 'b'), which is wrong: the
    // GA's build (29834929) is the later one. Ordering by build number gets this right.
    expect(newestOther(names, '0.9.0-29846589')).toBe('0.8.0-29834929');
  });

  it('excludes only the exact current name, and works with .json-suffixed names', () => {
    const names = ['0.7.0-29823677.json', '0.8.0-29834929.json'];
    expect(newestOther(names, '0.8.0-29834929.json')).toBe('0.7.0-29823677.json');
  });

  it('falls back to a string compare when a name carries no build number', () => {
    expect(newestOther(['0.6.0', '0.7.0'], '0.8.0')).toBe('0.7.0');
    // A build-numbered name always outranks a build-less one.
    expect(newestOther(['0.6.0', '0.7.0-1'], '0.8.0')).toBe('0.7.0-1');
  });
});
