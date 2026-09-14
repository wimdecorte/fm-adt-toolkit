import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** `gaps/checks` must be importable from a browser: it is the pure evaluation
 *  logic, with none of `gaps/register`'s node:fs dependency. */
describe('gaps/checks is browser-safe', () => {
  it('the built module has no node: import and no require(', () => {
    const distPath = join(ROOT, 'dist', 'gaps', 'checks.js');
    const path = existsSync(distPath) ? distPath : join(ROOT, 'src', 'gaps', 'checks.ts');
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/\bnode:/);
    expect(text).not.toMatch(/require\(/);
  });

  it('imports standalone with no register/fs dependency dragged in', async () => {
    const mod = await import('../src/gaps/checks.ts');
    expect(typeof mod.evaluateCheck).toBe('function');
  });

  it('is published as its own package export, separate from gaps', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.exports['./gaps/checks']).toEqual({
      types: './dist/gaps/checks.d.ts',
      default: './dist/gaps/checks.js',
    });
    expect(pkg.typesVersions['*']['gaps/checks']).toEqual(['dist/gaps/checks.d.ts']);
  });
});
