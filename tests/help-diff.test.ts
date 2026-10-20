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

describe('summariseHelp, following a key to the page it points at', () => {
  // fm 0.12.0 documents a shape shared by several ops or steps once, on its own page, and
  // points every user at it with `childPath`. Read by path prefix alone, `field:create` lost
  // all 108 of its `options.*` keys and `layout:create` 371 of its `objects.*` keys, when
  // both ops still take every one of them.
  it('follows a key\'s childPath to a keyObject outside the unit, prefixed by that key', () => {
    const json = help([
      { path: ['field', 'create'], kind: 'op', keys: [{ key: 'name' }, { key: 'options', childPath: ['field', 'options'] }] },
      { path: ['field', 'options'], kind: 'keyObject', keys: [{ key: 'global' }] },
      { path: ['field', 'options', 'autoEnter'], kind: 'keyObject', keys: [{ key: 'serial' }] },
    ]);
    expect(summariseHelp(json).keysByOp['field:create']).toEqual(['name', 'options', 'options.autoEnter.serial', 'options.global']);
  });

  it('follows a step\'s payloadKeys childPath, as a nested child was read before', () => {
    const json = help([
      { path: ['script', 'steps', 'Perform Find'], kind: 'step', keys: [{ key: 'restore' }],
        payloadKeys: [{ key: 'findRequests', childPath: ['script', 'steps', 'findRequests'] }] },
      { path: ['script', 'steps', 'findRequests'], kind: 'keyObject', keys: [{ key: 'operation' }] },
      { path: ['script', 'steps', 'findRequests', 'criteria'], kind: 'keyObject', keys: [{ key: 'field' }] },
    ]);
    expect(summariseHelp(json).keysByStep['script:steps:Perform Find'])
      .toEqual(['findRequests.criteria.field', 'findRequests.operation', 'restore']);
  });

  it('never follows a pointer into the step roster, which would list every step under `body`', () => {
    const json = help([
      { path: ['script', 'create'], kind: 'op', keys: [{ key: 'body', childPath: ['script', 'steps'] }] },
      { path: ['script', 'steps'], kind: 'stepRoster' },
      { path: ['script', 'steps', 'Beep'], kind: 'step', keys: [{ key: 'sound' }] },
    ]);
    expect(summariseHelp(json).keysByOp['script:create']).toEqual(['body']);
  });

  it('stops at a page that points back at itself', () => {
    const json = help([
      { path: ['layout', 'create'], kind: 'op', keys: [{ key: 'objects', childPath: ['layout', 'layoutObject'] }] },
      { path: ['layout', 'layoutObject'], kind: 'keyObject', keys: [{ key: 'type' }, { key: 'objects', childPath: ['layout', 'layoutObject'] }] },
    ]);
    expect(summariseHelp(json).keysByOp['layout:create']).toEqual(['objects', 'objects.objects', 'objects.type']);
  });

  it('reads an array member\'s `[]` marker as no segment, so 0.11.0\'s `fields[].field` is 0.12.0\'s `fields.field`', () => {
    const json = help([
      { path: ['script', 'steps', 'Sort Records'], kind: 'step' },
      { path: ['script', 'steps', 'Sort Records', 'sortOrder'], kind: 'keyObject', keys: [{ key: 'fields[].field' }] },
    ]);
    expect(summariseHelp(json).keysByStep['script:steps:Sort Records']).toEqual(['sortOrder.fields.field']);
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

describe('the real fm 0.11.0 and 0.12.0 help snapshots', () => {
  const read = (label: string) => summariseHelp(JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, '..', 'gaps', 'help', `${label}.json`), 'utf8')) as HelpJson);

  it('still finds the keys 0.12.0 moved onto shared pages', () => {
    const prev = read('0.11.0-29863806');
    const next = read('0.12.0-42');
    for (const [unit, key] of [
      ['field:create', 'options.autoEnter.calculation.text'],
      ['layout:create', 'objects.anchors.top'],
      ['layout:update', 'addObjects.bounds.height'],
      ['privilegeSet:create', 'fileOptions.printAllowed'],
    ] as const) {
      expect(prev.keysByOp[unit], `${unit} ${key} in 0.11.0`).toContain(key);
      expect(next.keysByOp[unit], `${unit} ${key} in 0.12.0`).toContain(key);
    }
    expect(prev.keysByStep['script:steps:Perform Find']).toContain('findRequests.criteria.field');
    expect(next.keysByStep['script:steps:Perform Find']).toContain('findRequests.criteria.field');
    expect(next.keysByStep['script:steps:Print']).toContain('printOptions.pageSetup.orientation');
  });
});
