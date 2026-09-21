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

  it('collects a script step\'s own keys and its nested keyObject\'s, excluding a glossary in the roster', () => {
    const json = help([
      { path: ['script'], kind: 'item' },
      { path: ['script', 'steps'], kind: 'stepRoster' },
      { path: ['script', 'steps', 'Sort Records'], kind: 'step', keys: [{ key: 'withDialog' }] },
      { path: ['script', 'steps', 'Sort Records', 'sortOrder'], kind: 'keyObject', keys: [{ key: 'fields' }, { key: 'maintain' }] },
      { path: ['script', 'steps', 'forms'], kind: 'glossary' },
    ]);
    const s = summariseHelp(json);
    expect(s.steps).toEqual(['script:steps:Sort Records']);
    expect(s.keysByStep['script:steps:Sort Records']).toEqual(['sortOrder.fields', 'sortOrder.maintain', 'withDialog']);
  });

  it('counts the step roster as neither a catalog nor an op', () => {
    const json = help([
      { path: ['script'], kind: 'item' },
      { path: ['script', 'steps'], kind: 'stepRoster' },
      { path: ['script', 'steps', 'Beep'], kind: 'step' },
    ]);
    const s = summariseHelp(json);
    expect(s.catalogs).toEqual(['script']);
    expect(s.ops).toEqual([]);
  });

  it('never confuses another step\'s nested keys with this step\'s own', () => {
    const json = help([
      { path: ['script', 'steps', 'Print'], kind: 'step', keys: [{ key: 'withDialog' }] },
      { path: ['script', 'steps', 'Print PDF'], kind: 'step', keys: [{ key: 'path' }] },
      { path: ['script', 'steps', 'Print PDF', 'printOptions'], kind: 'keyObject', keys: [{ key: 'copies' }] },
    ]);
    const s = summariseHelp(json);
    expect(s.keysByStep['script:steps:Print']).toEqual(['withDialog']);
    expect(s.keysByStep['script:steps:Print PDF']).toEqual(['path', 'printOptions.copies']);
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

  it('detects a step added and a key added to a step that already existed', () => {
    const prev = summariseHelp(help([
      { path: ['script', 'steps', 'Sort Records'], kind: 'step', keys: [{ key: 'withDialog' }] },
      { path: ['script', 'steps', 'Beep'], kind: 'step' },
    ]));
    const next = summariseHelp(help([
      { path: ['script', 'steps', 'Sort Records'], kind: 'step', keys: [{ key: 'withDialog' }] },
      { path: ['script', 'steps', 'Sort Records', 'sortOrder'], kind: 'keyObject', keys: [{ key: 'fields' }] },
      { path: ['script', 'steps', 'Beep'], kind: 'step' },
      { path: ['script', 'steps', 'Open Sesame'], kind: 'step' },
    ]));
    const diff = diffHelp(prev, next);
    expect(diff.stepsAdded).toEqual(['script:steps:Open Sesame']);
    expect(diff.stepsRemoved).toEqual([]);
    expect(diff.stepKeysAdded).toEqual({ 'script:steps:Sort Records': ['sortOrder.fields'] });
    expect(diff.stepKeysRemoved).toEqual({});
  });

  it('reports no differences between two identical summaries', () => {
    const s = summariseHelp(help([{ path: ['account'], kind: 'item' }, { path: ['account', 'read'], kind: 'op', keys: [{ key: 'name' }] }]));
    const diff = diffHelp(s, s);
    expect(diff).toEqual({
      catalogsAdded: [], catalogsRemoved: [], opsAdded: [], opsRemoved: [], keysAdded: {}, keysRemoved: {},
      stepsAdded: [], stepsRemoved: [], stepKeysAdded: {}, stepKeysRemoved: {},
    });
  });
});

describe('renderHelpDiff', () => {
  const diff: HelpDiff = {
    catalogsAdded: ['theme'], catalogsRemoved: [], opsAdded: [], opsRemoved: ['layout:delete'],
    keysAdded: { 'layout:create': ['parts.type'] }, keysRemoved: {},
    stepsAdded: ['script:steps:Open Sesame'], stepsRemoved: [],
    stepKeysAdded: { 'script:steps:Sort Records': ['sortOrder.fields'] }, stepKeysRemoved: {},
  };

  it('renders one line per change, headed by the two labels', () => {
    const text = renderHelpDiff(diff, '0.6.0-1', '0.7.0-2');
    const lines = text.split('\n');
    expect(lines[0]).toBe('0.6.0-1 -> 0.7.0-2');
    expect(lines).toContain('+ catalog theme');
    expect(lines).toContain('- op layout:delete');
    expect(lines).toContain('+ key layout:create parts.type');
  });

  it('renders a step and a step key, naming the step so it cannot read as an op', () => {
    const lines = renderHelpDiff(diff, 'a', 'b').split('\n');
    expect(lines).toContain('+ step script:steps:Open Sesame');
    expect(lines).toContain('+ key script:steps:Sort Records sortOrder.fields');
  });

  it('returns "no changes" when nothing differs', () => {
    const empty: HelpDiff = {
      catalogsAdded: [], catalogsRemoved: [], opsAdded: [], opsRemoved: [], keysAdded: {}, keysRemoved: {},
      stepsAdded: [], stepsRemoved: [], stepKeysAdded: {}, stepKeysRemoved: {},
    };
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

  it('summarises all 218 script steps and their keys', () => {
    // The step roster is `kind: stepRoster`, not an op, so a summary that only walked ops
    // saw none of this: 0.8.0 documented 163 new step keys and `help-diff` said "no changes".
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as HelpJson;
    const s = summariseHelp(json);
    expect(s.steps).toHaveLength(218);
    expect(s.steps).toContain('script:steps:Sort Records');
    expect(s.steps).not.toContain('script:steps:forms');
    expect(s.keysByStep['script:steps:Sort Records']).toEqual(['restore', 'withDialog']);
  });
});
