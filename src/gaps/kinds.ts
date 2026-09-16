import type { AdtOp } from '../types.ts';
import type { XmlNode } from './xml-walk.ts';
import type { ReferenceInstance } from './enumerate.ts';

export interface KindRule {
  id: string;                 // register id prefix, e.g. 'layout-object'
  op: string;                 // fm read op, or 'none'
  kind: string;               // 'layout' | 'part' | 'object' | 'field' | 'step' | ...; grouped kinds get ':<group>' appended by the enumerator
  file: string;               // catalog file suffix: 'LayoutCatalog'
  path: string[];             // element chain from the document element to the kind's elements, e.g. ['Structure','AddAction','LayoutCatalog','Layout']; '*' matches any depth (including zero)
  groupBy?: string;           // attribute whose value splits the kind into sub-kinds: 'type' for LayoutObject, 'datatype+fieldtype' for Field
  groupKey?: (node: XmlNode, value: string) => string;  // refines the raw groupBy value using the whole node; identity when absent. Only LayoutObject needs one: SaXML's `type="Panel"` is one shape by name but two by `kind` (12 tab, 17 slide) and the plain value collapses them.
  skip: string[];             // child tags whose subtrees are not attributes of this kind: ['PartsList'] for layout, ['LayoutObject'] for object and part, ['DDRREF'] for step
  idAttr?: string;            // attribute that identifies an instance: 'id'
  probe: (instance: ReferenceInstance) => { ops: AdtOp[]; select?: string };   // how to read this instance through fm
}

/** Turn a SaXML group value into a stable id fragment: 'Edit Box' -> 'edit-box'. */
export function groupSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** SaXML LayoutObject `@type` -> the fm `(type, control)` pair a `read:layout` reports for it.
 *  Copied from fm-adt-toolkit's `golden_construct.py` `_LO_TYPE` (26 values verified against Ooe's
 *  own 26 distinct LayoutObject @type values: 24 come from this table verbatim; 'Chart' is not a
 *  key in `_LO_TYPE` and falls through that module's own fallback — the first word lowercased, the
 *  rest camel-cased, i.e. 'chart'; 'Panel' is not in this table at all because `@type` alone cannot
 *  tell a tab panel from a slide panel — see `_LO_TYPE_BY_KIND` below, which decides it instead. */
const _LO_TYPE: Record<string, { type: string; control: string | null }> = {
  'Button': { type: 'button', control: null },
  'Button Bar': { type: 'buttonBar', control: null },
  'Text': { type: 'label', control: null },
  'Line': { type: 'line', control: null },
  'Rectangle': { type: 'rectangle', control: null },
  'Graphic': { type: 'graphic', control: null },
  'Rounded Rectangle': { type: 'roundedRectangle', control: null },
  'Oval': { type: 'oval', control: null },
  'Group': { type: 'group', control: null },
  'Grouped Button': { type: 'group', control: null },
  'Portal': { type: 'portal', control: null },
  'Web Viewer': { type: 'webViewer', control: null },
  'Tab Control': { type: 'tabControl', control: null },
  'Slide Control': { type: 'slideControl', control: null },
  'Popover Button': { type: 'popoverButton', control: null },
  'Edit Box': { type: 'field', control: 'editBox' },
  'Drop-down List': { type: 'field', control: 'dropDownList' },
  'Pop-up Menu': { type: 'field', control: 'popupMenu' },
  'Checkbox Set': { type: 'field', control: 'checkboxSet' },
  'Radio Button Set': { type: 'field', control: 'radioButtonSet' },
  'Drop-down Calendar': { type: 'field', control: 'dropDownCalendar' },
  'Concealed Edit Box': { type: 'field', control: 'secureText' },
  'Container': { type: 'field', control: null },
  // fm 0.6.0 reports the panel itself as `popover`, not `popoverPanel` (verified on Ooe
  // object 58 of 'My Layout for TestTable'); `popoverButton` is the button that opens it.
  'PopoverPanel': { type: 'popover', control: null },
  // Not in `_LO_TYPE`: fm's own fallback naming (first word lowercased, rest capitalized) for a type
  // with no dedicated entry there. Verified present in Ooe (`type="Chart"`, `kind="13"`).
  'Chart': { type: 'chart', control: null },
};

/** `Panel@kind` -> the fm type: `_LO_BY_KIND` in `golden_construct.py`. Overrides `_LO_TYPE`
 *  (which has no 'Panel' entry) whenever the object's own `kind` is one of these two values.
 *  Verified in Ooe: 8 instances of `type="Panel" kind="12"` and 8 of `type="Panel" kind="17"`. */
const _LO_TYPE_BY_KIND: Record<string, string> = { '12': 'tabPanel', '17': 'slidePanel' };

/** The fm `(type, control)` pair for one LayoutObject node, or undefined if its `@type` is not
 *  in the survey. `kind` is consulted first because it is the only attribute that disambiguates
 *  'Panel'; every other type is unambiguous from `@type` alone. */
export function layoutObjectFmType(node: XmlNode): { type: string; control: string | null } | undefined {
  const byKind = _LO_TYPE_BY_KIND[node.attrs.kind ?? ''];
  if (byKind) return { type: byKind, control: null };
  return _LO_TYPE[node.attrs.type ?? ''];
}

/** 'Panel' is one SaXML `@type` but two fm shapes; every other type's `kind` is a fixed constant
 *  of its type (verified against every (type, kind) pair in Ooe's LayoutCatalog), so only 'Panel'
 *  needs this override. Grouping by the fm name here (rather than a raw 'Panel:12' tag) makes the
 *  register's kindId read as the shape a person recognizes: 'layout-object:tabpanel'. */
function layoutObjectGroupKey(node: XmlNode, value: string): string {
  if (value !== 'Panel') return value;
  return _LO_TYPE_BY_KIND[node.attrs.kind ?? ''] ?? value;
}

const layoutProbe = (i: ReferenceInstance) => ({ ops: [{ op: 'read:layout', name: i.context.layout ?? i.name ?? '', detail: true }] });

export const KINDS: KindRule[] = [
  { id: 'layout', op: 'read:layout', kind: 'layout', file: 'LayoutCatalog', path: ['Structure', 'AddAction', 'LayoutCatalog', 'Layout'], skip: ['PartsList'], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:layout', name: i.name ?? '', detail: true }] }) },
  { id: 'part', op: 'read:layout', kind: 'part', file: 'LayoutCatalog', path: ['Structure', 'AddAction', 'LayoutCatalog', 'Layout', 'PartsList', 'Part'], groupBy: 'type', skip: ['LayoutObject'],
    // fm 0.7.0 reports the parts at the layout's TOP level (`parts`), not under `contents`
    // — before 0.7.0 it reported no parts at all, and the register's part entries all
    // carried `expectedError: container key absent: contents.parts`. The selector's value
    // match is case- and punctuation-insensitive (see `select.ts`), so the export's
    // `Leading Sub-summary` still finds fm's `leadingSubSummary`.
    probe: (i) => ({ ...layoutProbe(i), select: 'parts[type=' + (i.context.part ?? '') + ']' }) },
  { id: 'layout-object', op: 'read:layout', kind: 'object', file: 'LayoutCatalog', path: ['Structure', 'AddAction', 'LayoutCatalog', 'Layout', 'PartsList', 'Part', '*', 'LayoutObject'],
    groupBy: 'type', groupKey: layoutObjectGroupKey, skip: ['LayoutObject'], idAttr: 'id',
    probe: (i) => ({ ...layoutProbe(i), select: '**objects[id=' + i.id + ']' }) },
  { id: 'field', op: 'read:field', kind: 'field', file: 'FieldCatalog', path: ['Structure', 'AddAction', 'FieldsForTables', 'FieldCatalog', '*', 'Field'], groupBy: 'datatype+fieldtype', skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:field', table: i.context.table ?? '', name: i.name ?? '' }] }) },
  { id: 'table', op: 'read:table', kind: 'table', file: 'BaseTableCatalog', path: ['Structure', 'AddAction', 'BaseTableCatalog', 'BaseTable'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:table', name: i.name ?? '' }] }) },
  { id: 'table-occurrence', op: 'read:tableOccurrence', kind: 'tableOccurrence', file: 'TableOccurrenceCatalog', path: ['Structure', 'AddAction', 'TableOccurrenceCatalog', 'TableOccurrence'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:tableOccurrence', id: Number(i.id) }] }) },
  { id: 'relation', op: 'read:relation', kind: 'relation', file: 'RelationshipCatalog', path: ['Structure', 'AddAction', 'RelationshipCatalog', 'Relationship'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:relation', id: Number(i.id) }] }) },
  { id: 'script', op: 'read:script', kind: 'script', file: 'ScriptCatalog', path: ['Structure', 'AddAction', 'ScriptCatalog', 'Script'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:script', id: Number(i.id) }] }) },
  // Steps are not nested in Script/StepList in the real export: ScriptCatalog holds script metadata
  // only (id, name, isFolder), and every script's steps live in a SEPARATE top-level catalog,
  // StepsForScripts, under Script/ScriptReference (name/id) + Script/ObjectList/Step. `file` still
  // names 'ScriptCatalog' because that is this rule's catalog-file SUFFIX convention slot, but the
  // path below reaches into StepsForScripts, which enumerateExport also loads from the ScriptCatalog
  // file group (see the note on `enumerateExport`).
  // Context carries `script` (name), `scriptId`, `stepName` and `stepId` (plus `index`): the probe
  // needs the script's numeric id and the step's numeric id, and neither is reconstructible from
  // `i.id` (this rule has no `idAttr` — `id` is a sequence number among occurrences of this step
  // shape, not the step's own id) or from name alone. fm's documented script-lookup-by-name is an
  // error whenever the name is ambiguous, and 8 scripts in Ooe are literally named "--", so probing
  // by name would be unsound even before considering that a step's `name` in fm's own script body is
  // its variable/target value, not a stable key for the step itself.
  { id: 'step', op: 'read:script', kind: 'step', file: 'ScriptCatalog', path: ['Structure', 'AddAction', 'StepsForScripts', 'Script', '*', 'Step'], groupBy: 'id', skip: [],
    probe: (i) => ({ ops: [{ op: 'read:script', id: Number(i.context.scriptId ?? 0) }], select: 'body[stepID=' + (i.context.stepId ?? '') + ']' }) },
  { id: 'value-list', op: 'read:valueList', kind: 'valueList', file: 'ValueListCatalog', path: ['Structure', 'AddAction', 'ValueListCatalog', 'ValueList'], groupBy: 'Source@value', skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:valueList', id: Number(i.id) }] }) },
  { id: 'custom-function', op: 'read:customFunction', kind: 'customFunction', file: 'CustomFunctionsCatalog', path: ['Structure', 'AddAction', 'CustomFunctionsCatalog', '*', 'CustomFunction'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:customFunction', id: Number(i.id) }] }) },
  { id: 'account', op: 'read:account', kind: 'account', file: 'AccountsCatalog', path: ['Structure', 'AddAction', 'AccountsCatalog', '*', 'Account'], groupBy: 'type', skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:account', id: Number(i.id) }] }) },
  { id: 'privilege-set', op: 'read:privilegeSet', kind: 'privilegeSet', file: 'PrivilegeSetsCatalog', path: ['Structure', 'AddAction', 'PrivilegeSetsCatalog', '*', 'PrivilegeSet'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:privilegeSet', id: Number(i.id) }] }) },
  { id: 'extended-privilege', op: 'read:extendedPrivilege', kind: 'extendedPrivilege', file: 'ExtendedPrivilegesCatalog', path: ['Structure', 'AddAction', 'ExtendedPrivilegesCatalog', '*', 'ExtendedPrivilege'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:extendedPrivilege', id: Number(i.id) }] }) },
  { id: 'authorization', op: 'read:authorization', kind: 'authorization', file: 'FileAccessCatalog', path: ['Structure', 'AddAction', 'FileAccessCatalog', '*', 'Authorization'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:authorization', id: Number(i.id) }] }) },
  { id: 'custom-menu', op: 'read:customMenu', kind: 'customMenu', file: 'CustomMenuCatalog', path: ['Structure', 'AddAction', 'CustomMenuCatalog', 'CustomMenu'], skip: ['MenuItemList'], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:customMenu', id: Number(i.id) }] }) },
  // The real element is `CustomMenuItem`, not `MenuItem`, and it carries no `type` attribute
  // (`hash`, `index`, `isSubMenuItem`, `isSeparatorItem` instead) — so this kind is not grouped.
  { id: 'custom-menu-item', op: 'read:customMenu', kind: 'customMenuItem', file: 'CustomMenuCatalog', path: ['Structure', 'AddAction', 'CustomMenuCatalog', 'CustomMenu', 'MenuItemList', 'CustomMenuItem'], skip: [],
    probe: (i) => ({ ops: [{ op: 'read:customMenu', id: Number(i.context.menuId ?? 0) }], select: 'items[index=' + (i.context.index ?? '0') + ']' }) },
  { id: 'custom-menu-set', op: 'read:customMenuSet', kind: 'customMenuSet', file: 'CustomMenuSetCatalog', path: ['Structure', 'AddAction', 'CustomMenuSetCatalog', '*', 'CustomMenuSet'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:customMenuSet', id: Number(i.id) }] }) },
  { id: 'external-data-source', op: 'read:externalDataSource', kind: 'externalDataSource', file: 'ExternalDataSourceCatalog', path: ['Structure', 'AddAction', 'ExternalDataSourceCatalog', 'ExternalDataSource'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:externalDataSource', id: Number(i.id) }] }) },
  { id: 'base-directory', op: 'read:baseDirectory', kind: 'baseDirectory', file: 'BaseDirectoryCatalog', path: ['Structure', 'AddAction', 'BaseDirectoryCatalog', 'BaseDirectory'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:baseDirectory', id: Number(i.id) }] }) },
  // fm 0.7.0 refuses `id` here: an entry of this catalog has no id in or out (see
  // `fm help persistentData`) — FileMaker files it under one name built from the
  // (instance, key) pair, so the pair IS the address. The export records the instance as
  // `PersistentStore@instanceID` but `enumerateExport` keeps only `id` and `@name`, so
  // the instance half comes from `context.instance` when a future reference carries it
  // and otherwise from '' — the no-instance namespace, which is what Ooe's export writes
  // for every entry, and which fm treats as a namespace of its own rather than a default.
  { id: 'persistent-store', op: 'read:persistentData', kind: 'persistentData', file: 'PersistentStoreCatalog', path: ['Structure', 'AddAction', 'PersistentStoreCatalog', 'PersistentStore'], skip: [], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:persistentData', instance: i.context.instance ?? '', key: i.name ?? '' }] }) },
  // fm 0.7.0 has a theme catalog of its own. Before it, the only theme fm reported was the
  // summary a layout carries (`read:layout` -> `theme`), which is why this rule used to
  // probe a layout; `read:theme` describe answers with the stylesheet, the palette, the
  // named styles and the layouts using the theme.
  { id: 'theme', op: 'read:theme', kind: 'theme', file: 'ThemeCatalog', path: ['Structure', 'AddAction', 'ThemeCatalog', 'Theme'], skip: ['CSS', 'Image'], idAttr: 'id',
    probe: (i) => ({ ops: [{ op: 'read:theme', id: Number(i.id) }] }) },
  // Metadata's own document element is `Metadata` directly under the file root (no `Structure`
  // wrapper, unlike every other catalog); `AddAction` inside it wraps the 12-member File Options
  // block. `IconData` (the file's custom icon, as nested Base64/Hex binary streams) is skipped: it
  // is not part of File Options and its Stream elements carry the icon bytes as element text, which
  // this register never records regardless, but excluding the subtree keeps the kind's attribute
  // list to the File Options settings the brief names (script triggers, login, encryption, minimum
  // version, the hide checkboxes, save password).
  { id: 'file-options', op: 'none', kind: 'fileOptions', file: 'Metadata', path: ['Metadata', 'AddAction'], skip: ['IconData'],
    probe: () => ({ ops: [{ op: 'read:file' }] }) },
];
