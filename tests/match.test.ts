import { describe, it, expect } from 'vitest';
import { flattenKeys, normaliseName, autoMatch } from '../src/gaps/match.ts';

describe('flattenKeys', () => {
  it('lists dotted key paths to a bounded depth', () => {
    const keys = flattenKeys({ id: 1, bounds: { left: 2, top: 3 }, scriptTriggers: [ { event: 'x' } ], deep: { a: { b: { c: 1 } } } });
    expect(keys).toEqual(expect.arrayContaining(['id', 'bounds', 'bounds.left', 'bounds.top', 'scriptTriggers', 'scriptTriggers[].event', 'deep.a.b']));
    expect(keys).not.toContain('deep.a.b.c');
  });
  it('collects an array-element key seen on any element, not just the first', () => {
    const keys = flattenKeys({ scriptTriggers: [ { event: 'a' }, { event: 'b', parameter: 'x' } ] });
    expect(keys).toEqual(expect.arrayContaining(['scriptTriggers[].event', 'scriptTriggers[].parameter']));
  });
});
describe('autoMatch', () => {
  it('matches a SaXML path to exactly one fm key by normalised name', () => {
    const m = autoMatch(['Bounds@top', 'Options/HideWhenPrinting', '@name', 'Field/FieldReference@name'], ['bounds.top', 'hideWhenPrinting', 'name', 'field.name', 'locked']);
    expect(m['Bounds@top']).toBe('bounds.top');
    expect(m['Options/HideWhenPrinting']).toBe('hideWhenPrinting');
    expect(m['@name']).toBe('name');
    expect(m['Field/FieldReference@name']).toBe('field.name');
  });
  it('leaves ambiguous and unmatched paths null', () => {
    const m = autoMatch(['@id'], ['id', 'field.id']);
    expect(m['@id']).toBe('id');                                   // the shorter exact match wins over a nested one
    expect(autoMatch(['Options/Locked'], ['bounds.top'])['Options/Locked']).toBeNull();
  });
});
