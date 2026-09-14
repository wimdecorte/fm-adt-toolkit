import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { enumerateExport } from '../src/gaps/enumerate.ts';

const DIR = path.resolve(__dirname, 'fixtures/saxml-mini');

describe('enumerateExport', () => {
  const refs = enumerateExport(DIR, 'Mini', 'mini');
  const byKind = Object.fromEntries(refs.map((r) => [r.kindId, r]));

  it('emits one reference per kind and per group', () => {
    expect(Object.keys(byKind).sort()).toEqual([
      'field:container-normal', 'field:text-normal', 'layout', 'layout-object:edit-box', 'layout-object:group', 'layout-object:text',
      'part:body', 'part:header', 'relation', 'script', 'step:141', 'step:89',
    ]);
  });
  it('lists attribute paths relative to the kind element, with presence counts, skipping excluded subtrees', () => {
    const layout = byKind['layout'];
    expect(layout.instances).toHaveLength(2);
    expect(layout.attributes.map((a) => a.path)).toEqual(expect.arrayContaining(['@id', '@name', '@width', 'TableOccurrenceReference@id', 'TableOccurrenceReference@name', 'Options']));
    expect(layout.attributes.find((a) => a.path.startsWith('PartsList'))).toBeUndefined();
    expect(layout.attributes.find((a) => a.path === 'Options')!.present).toBe(1);
    const text = byKind['layout-object:text'];
    expect(text.instances.map((i) => i.id)).toEqual(['22', '24']);       // nested object counted under its own kind
    expect(text.instances[0].context).toEqual({ layout: 'Home', part: 'Body' });
    const group = byKind['layout-object:group'];
    expect(group.attributes.find((a) => a.path.startsWith('LayoutObject'))).toBeUndefined();
  });
  it('skips DDRREF and chunk elements under a step and records the step id as the group', () => {
    const step = byKind['step:89'];
    expect(step.kind).toBe('step:89');
    expect(step.instances[0].context).toEqual({ script: 'S', stepName: '# (comment)' });
    expect(step.attributes.map((a) => a.path)).toEqual(['@enable', '@hash', '@id', '@index', '@name', 'Options', 'ParameterValues/Text', 'UUID']);
  });
  it('groups fields by datatype and fieldtype', () => {
    expect(byKind['field:container-normal'].instances[0].context).toEqual({ table: 'T' });
    expect(byKind['field:container-normal'].attributes.map((a) => a.path)).toContain('Storage/Container@external');
  });
  it('never records attribute values or element text', () => {
    const json = JSON.stringify(refs);
    expect(json).not.toContain('T::F');
    expect(json).not.toContain('"hi"');
  });
});
