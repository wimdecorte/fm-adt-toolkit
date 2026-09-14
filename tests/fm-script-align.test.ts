import { describe, it, expect } from 'vitest';
import { alignSteps, normaliseCalc, DISPLAY_NAME_OVERRIDES, NAME_UNVERIFIABLE } from '../scripts/fm-script-align.mjs';

const displayNameFor = (cliName: string): string => DISPLAY_NAME_OVERRIDES[cliName] ?? cliName;

describe('normaliseCalc', () => {
  it('turns FileMaker returns into spaces and collapses runs', () => {
    expect(normaliseCalc('Let(\r\r[\r\r_a = 1\r]')).toBe('Let( [ _a = 1 ]');
  });

  it('handles \\n as well as \\r', () => {
    expect(normaliseCalc('a\nb\r\nc')).toBe('a b c');
  });

  it('trims and leaves an already-flat string alone', () => {
    expect(normaliseCalc('  a b  ')).toBe('a b');
    expect(normaliseCalc('$url')).toBe('$url');
  });

  it('returns an empty string for a non-string', () => {
    expect(normaliseCalc(undefined)).toBe('');
    expect(normaliseCalc(42)).toBe('42');
  });
});

describe('alignSteps', () => {
  it('pairs one step per line in the simple case', () => {
    const body = [
      { stepID: 141, step: 'Set Variable', name: '$a' },
      { stepID: 68, step: 'If', condition: '1=1' },
    ];
    const lines = ['Set Variable [ $a ; Value: 1 ]', 'If [ 1=1 ]'];
    const { pairs, failures } = alignSteps(body, lines, displayNameFor);
    expect(failures).toEqual([]);
    expect(pairs).toHaveLength(2);
    expect(pairs[1].line).toBe('If [ 1=1 ]');
  });

  it('records the tab indent separately from the line text', () => {
    const body = [{ stepID: 141, step: 'Set Variable', name: '$a' }];
    const { pairs } = alignSteps(body, ['\t\tSet Variable [ $a ]'], displayNameFor);
    expect(pairs[0].indent).toBe(2);
    expect(pairs[0].line).toBe('Set Variable [ $a ]');
  });

  it('consumes an extra line for every \\r in a comment, keeping later steps aligned', () => {
    const body = [
      { stepID: 89, step: '#', text: ' first\rsecond' },
      { stepID: 68, step: 'If', condition: 'x' },
    ];
    const lines = ['# first', 'second', 'If [ x ]'];
    const { pairs, failures } = alignSteps(body, lines, displayNameFor);
    expect(failures).toEqual([]);
    expect(pairs).toHaveLength(2);
    // The If must still find its own line, not 'second'.
    expect(pairs[1].line).toBe('If [ x ]');
  });

  it('accepts a display name that differs only in case', () => {
    const body = [{ stepID: 1, step: 'Set Field by Name', value: '1' }];
    const lines = ['Set Field By Name [ "T::f" ; 1 ]'];
    expect(alignSteps(body, lines, displayNameFor).failures).toEqual([]);
  });

  it('accepts a display name that differs outright, via the override table', () => {
    expect(DISPLAY_NAME_OVERRIDES['Page Setup']).toBe('Print Setup');
    const body = [{ stepID: 1, step: 'Page Setup' }];
    const lines = ['Print Setup [ With dialog: On ]'];
    expect(alignSteps(body, lines, displayNameFor).failures).toEqual([]);
  });

  it('reports a step it cannot align instead of skipping it', () => {
    const body = [{ stepID: 1, step: 'Go to Layout' }];
    const lines = ['Something Else [ x ]'];
    const { pairs, failures } = alignSteps(body, lines, displayNameFor);
    expect(pairs).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0].step).toBe('Go to Layout');
    expect(failures[0].reason).toMatch(/name/i);
  });

  it('reports running out of lines rather than throwing', () => {
    const body = [{ stepID: 68, step: 'If' }, { stepID: 70, step: 'End If' }];
    const { failures } = alignSteps(body, ['If [ x ]'], displayNameFor);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatch(/line/i);
  });

  it('accepts an unverifiable step name and tags the pair', () => {
    expect(NAME_UNVERIFIABLE.has('ExternalStep')).toBe(true);
    // ExternalStep renders as the plugin's name (e.g., "MBS"), not "ExternalStep"
    const body = [{ stepID: 186, step: 'ExternalStep', plugin: '4d425350' }];
    const lines = ['MBS [ Function: $Command ]'];
    const { pairs, failures } = alignSteps(body, lines, displayNameFor);
    expect(failures).toEqual([]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].nameUnverified).toBe(true);
    expect(pairs[0].line).toBe('MBS [ Function: $Command ]');
  });
});
