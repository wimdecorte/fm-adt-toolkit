import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { summariseHelp, diffHelp, renderHelpDiff } from '../src/gaps/help-diff.ts';
import type { HelpJson, HelpDiff } from '../src/gaps/help-diff.ts';

function help(nodes: HelpJson['nodes']): HelpJson {
  return { type: 'help', all: true, total: nodes.length, nodes };
}

describe('summariseHelp', () => {
  it('collects catalogs and ops, excluding a glossary node at the same depth', () => {
    const json = help([
      { path: [], kind: 'index' },
      { path: ['account'], kind: 'item' },
      { path: ['layout'], kind: 'item' },
      { path: ['forms'], kind: 'glossary' },
    ]);
    const s = summariseHelp(json);
    expect(s.catalogs).toEqual(['account', 'layout']);
    expect(s.ops).toEqual([]);
  });

  it('collects an op\'s own keys and a nested keyObject child\'s keys, prefixed by the sub-path beyond the op', () => {
    const json = help([
      { path: ['layout'], kind: 'item' },
      { path: ['layout', 'create'], kind: 'op', keys: [{ key: 'name' }, { key: 'type' }] },
      { path: ['layout', 'create', 'parts'], kind: 'keyObject', keys: [{ key: 'type' }, { key: 'height' }] },
      { path: ['layout', 'delete'], kind: 'op' },
    ]);
    const s = summariseHelp(json);
    expect(s.ops).toEqual(['layout:create', 'layout:delete']);
    expect(s.keysByOp['layout:create']).toEqual(['name', 'parts.height', 'parts.type', 'type']);
    expect(s.keysByOp['layout:delete']).toBeUndefined();
  });

  it('never confuses another op\'s nested keys with this op\'s own', () => {
    const json = help([
      { path: ['layout', 'create'], kind: 'op', keys: [{ key: 'name' }] },
      { path: ['layout', 'createFolder'], kind: 'op', keys: [{ key: 'label' }] },
    ]);
    const s = summariseHelp(json);
    expect(s.keysByOp['layout:create']).toEqual(['name']);
    expect(s.keysByOp['layout:createFolder']).toEqual(['label']);
  });
});

describe('diffHelp', () => {
  it('detects a catalog added, an op removed, and a nested key added', () => {
    const prev = summariseHelp(help([
      { path: ['account'], kind: 'item' },
      { path: ['layout', 'create'], kind: 'op', keys: [{ key: 'name' }] },
      { path: ['layout', 'delete'], kind: 'op' },
    ]));
    const next = summariseHelp(help([
      { path: ['account'], kind: 'item' },
      { path: ['theme'], kind: 'item' },
      { path: ['layout', 'create'], kind: 'op', keys: [{ key: 'name' }] },
      { path: ['layout', 'create', 'parts'], kind: 'keyObject', keys: [{ key: 'type' }] },
    ]));
    const diff = diffHelp(prev, next);
    expect(diff.catalogsAdded).toEqual(['theme']);
    expect(diff.catalogsRemoved).toEqual([]);
    expect(diff.opsAdded).toEqual([]);
    expect(diff.opsRemoved).toEqual(['layout:delete']);
    expect(diff.keysAdded).toEqual({ 'layout:create': ['parts.type'] });
    expect(diff.keysRemoved).toEqual({});
  });

  it('reports no differences between two identical summaries', () => {
    const s = summariseHelp(help([{ path: ['account'], kind: 'item' }, { path: ['account', 'read'], kind: 'op', keys: [{ key: 'name' }] }]));
    const diff = diffHelp(s, s);
    expect(diff).toEqual({ catalogsAdded: [], catalogsRemoved: [], opsAdded: [], opsRemoved: [], keysAdded: {}, keysRemoved: {} });
  });
});

describe('renderHelpDiff', () => {
  const diff: HelpDiff = {
    catalogsAdded: ['theme'], catalogsRemoved: [], opsAdded: [], opsRemoved: ['layout:delete'],
    keysAdded: { 'layout:create': ['parts.type'] }, keysRemoved: {},
  };

  it('renders one line per change, headed by the two labels', () => {
    const text = renderHelpDiff(diff, '0.6.0-1', '0.7.0-2');
    const lines = text.split('\n');
    expect(lines[0]).toBe('0.6.0-1 -> 0.7.0-2');
    expect(lines).toContain('+ catalog theme');
    expect(lines).toContain('- op layout:delete');
    expect(lines).toContain('+ key layout:create parts.type');
  });

  it('returns "no changes" when nothing differs', () => {
    const empty: HelpDiff = { catalogsAdded: [], catalogsRemoved: [], opsAdded: [], opsRemoved: [], keysAdded: {}, keysRemoved: {} };
    expect(renderHelpDiff(empty, 'a', 'b')).toBe('no changes');
  });
});

describe('the real fm 0.7.0 help snapshot', () => {
  const file = path.join(import.meta.dirname, '..', 'gaps', 'help', '0.7.0-29823677.json');

  it('summarises 21 catalogs, excludes glossary nodes, and finds theme:read and layout:create parts.type', () => {
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as HelpJson;
    const s = summariseHelp(json);
    expect(s.catalogs).toHaveLength(21);
    expect(s.catalogs).toContain('theme');
    expect(s.catalogs).not.toContain('theme-css');
    expect(s.catalogs).not.toContain('forms');
    expect(s.ops).toContain('theme:read');
    expect(s.keysByOp['layout:create']).toContain('parts.type');
  });
});
