import { describe, it, expect } from 'vitest';
import { selectInstance } from '../src/gaps/select.ts';

const layout = { name: 'Home', theme: { name: 'Apex' }, contents: { objects: [
  { id: 21, type: 'field' },
  { id: 23, type: 'group', objects: [ { id: 24, type: 'label' } ] },
] } };
const script = { body: [ { stepID: 89, step: '#' }, { stepID: 141, step: 'Set Variable', name: '$x' } ] };

describe('selectInstance', () => {
  it('returns the result itself for an empty selector', () => { expect(selectInstance(layout, undefined)).toBe(layout); });
  it('walks dotted paths', () => { expect(selectInstance(layout, 'theme')).toEqual({ name: 'Apex' }); });
  it('filters arrays by key=value', () => { expect(selectInstance(script, 'body[stepID=141]')).toEqual(script.body[1]); });
  it('searches nested arrays of the same name with ** ', () => { expect(selectInstance(layout, '**objects[id=24]')).toEqual({ id: 24, type: 'label' }); });
  it('compares a [key=value] filter ignoring case and punctuation', () => {
    const withParts = { contents: { parts: [ { type: 'body' }, { type: 'leadingSubSummary' } ] } };
    expect(selectInstance(withParts, 'contents.parts[type=Body]')).toEqual({ type: 'body' });
    expect(selectInstance(withParts, 'contents.parts[type=Leading Sub-summary]')).toEqual({ type: 'leadingSubSummary' });
    expect(selectInstance(withParts, 'contents.parts[type=Footer]')).toBeUndefined();
  });
  it('returns undefined when nothing matches', () => {
    expect(selectInstance(layout, 'contents.parts[type=Body]')).toBeUndefined();   // no contents.parts at all
    expect(selectInstance(layout, '**objects[id=99]')).toBeUndefined();
  });
});
