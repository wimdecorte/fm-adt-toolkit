import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import catalogModule from '../src/catalogs/fm-step-display.js';

describe('catalog module twin', () => {
  it('is byte-for-byte the same data as the JSON', () => {
    const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/catalogs/fm-step-display.json'), 'utf8'));
    expect(catalogModule).toEqual(json);
  });
});
