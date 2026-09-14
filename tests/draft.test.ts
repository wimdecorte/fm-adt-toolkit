import { describe, it, expect } from 'vitest';
import { draftEntry, fmTypeMismatch } from '../src/gaps/draft.ts';
import { loadRegister, saveRegister } from '../src/gaps/register.ts';
import type { Reference, ReferenceInstance } from '../src/gaps/enumerate.ts';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const paths = ['@id', '@name', 'Bounds@top', 'Options/Locked', 'ConditionalFormatting/Style'];

const reference: Reference = {
  kindId: 'layout-object:edit-box', op: 'read:layout', kind: 'object:Edit Box',
  file: 'LayoutCatalog', exportLabel: '2026-08-30-fm26.0.2', source: 'Ooe',
  instances: [{ id: '21', name: 'Home', context: {} }],
  attributes: paths.map((p) => ({ path: p, present: 1 })),
};

const instance: ReferenceInstance = { id: '21', name: 'Home', context: {} };
const fmInstance = { id: 21, name: '', bounds: { top: 1 }, locked: false, kind: 1 };
const probe = { ops: [{ op: 'read:layout' as const, name: 'Home', detail: true }], select: '**objects[id=21]' };

describe('draftEntry', () => {
  it('drafts one attribute per reference path, auto-matched to the fm instance, in path order', () => {
    const entry = draftEntry(reference, instance, probe, fmInstance, '0.6.0');
    expect(entry.id).toBe(reference.kindId);
    expect(entry.op).toBe('read:layout');
    expect(entry.kind).toBe('object:Edit Box');
    expect(entry.probe).toEqual(probe);
    expect(entry.firstSeen).toBe('0.6.0');
    expect(entry.ignoreKeys).toEqual([]);
    expect(entry.reportedToClaris).toBeNull();
    expect(entry.lastChecked).toBeNull();
    expect(entry.blocks).toEqual([]);
    expect(entry.attributes.map((a) => a.path)).toEqual(paths);
    expect(entry.attributes).toEqual([
      { name: 'id', path: '@id', knownFrom: 'SaXML LayoutCatalog @id', fmKey: 'id', reported: true },
      { name: 'name', path: '@name', knownFrom: 'SaXML LayoutCatalog @name', fmKey: 'name', reported: true },
      { name: 'Bounds top', path: 'Bounds@top', knownFrom: 'SaXML LayoutCatalog Bounds@top', fmKey: 'bounds.top', reported: true },
      { name: 'Options Locked', path: 'Options/Locked', knownFrom: 'SaXML LayoutCatalog Options/Locked', fmKey: 'locked', reported: true },
      { name: 'ConditionalFormatting Style', path: 'ConditionalFormatting/Style', knownFrom: 'SaXML LayoutCatalog ConditionalFormatting/Style', fmKey: null, reported: false },
    ]);
  });

  it('carries the reference fmType onto the entry and names a mismatch', () => {
    const typed: Reference = { ...reference, fmType: { type: 'field', control: 'editBox' } };
    const entry = draftEntry(typed, instance, probe, { id: 21, type: 'field', control: 'editBox' }, '0.6.0');
    expect(entry.fmType).toEqual({ type: 'field', control: 'editBox' });
    expect(fmTypeMismatch({ id: 21, type: 'field', control: 'editBox' }, typed.fmType!)).toBeUndefined();
    expect(fmTypeMismatch({ id: 21, type: 'popover' }, { type: 'popoverPanel', control: null }))
      .toBe('selector matched a different kind: type "popover", expected "popoverPanel"');
    expect(fmTypeMismatch({ id: 21, type: 'field', control: 'dropDownList' }, typed.fmType!))
      .toBe('selector matched a different kind: control "dropDownList", expected "editBox"');
    // A reference control of null is "not determined by the SaXML type", not "fm reports none".
    expect(fmTypeMismatch({ id: 21, type: 'field', control: 'editBox' }, { type: 'field', control: null })).toBeUndefined();
  });

  it('never produces two attributes with the same name, even when readable(path) collapses distinct paths', () => {
    // `readable` maps both '/' and '@' to a space: 'Options' and '@Options' both read
    // 'Options'; 'A/B' and 'A@B' both read 'A B'. Real collisions: layout-object:popoverpanel
    // (@Options vs Options) and steps 117, 139, 161, 222 in the shipped reference set.
    const collidingPaths = ['Options', '@Options', 'A/B', 'A@B'];
    const collidingReference: Reference = {
      ...reference,
      attributes: collidingPaths.map((p) => ({ path: p, present: 1 })),
    };
    const entry = draftEntry(collidingReference, instance, probe, {}, '0.6.0');
    const names = entry.attributes.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(4);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-gaps-draft-'));
    const file = path.join(dir, 'register.json');
    saveRegister(file, [entry]);
    expect(() => loadRegister(file)).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
