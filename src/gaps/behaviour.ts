/** Pure core of `fm-gaps behaviour`: what to probe, and how two builds' answers differ.
 *
 *  The register measures what fm REPORTS about a file. This measures how fm BEHAVES toward the
 *  account asking -- which privilege a session needs, what a read does when a grant is withheld,
 *  and whether two sessions can read at once. Those answers are not in the register and not in
 *  `fm help`, so nothing else in this repo would notice them changing.
 *
 *  The findings this pins are written up in docs/fm-adt-privileges.md. One of them is already
 *  expected to change: fm holds an exclusive schema lock even for reads, and a future build is
 *  expected to relax it. `lock:concurrent-reads` exists so that lands as a recorded diff rather
 *  than as a surprise.
 *
 *  No `node:` imports: this half is data and comparison, and the live probing lives in
 *  `bin/fm-gaps.mjs` because it WRITES -- it creates privilege sets and accounts, and a probe
 *  that tests a refusal has to send the op that gets refused. That is why this cannot be folded
 *  into `fm-gaps check`, whose every batch goes through `assertReadOnly`. */

/** One build's answers, keyed by probe id. The value is a short token rather than a structured
 *  result: a token diffs readably, and the point of a snapshot is to notice that an answer moved,
 *  not to re-litigate what it means. */
export interface BehaviourSnapshot {
  version: string;
  build: string;
  date: string;
  results: Record<string, string>;
}

export interface BehaviourDiff {
  changed: Array<{ id: string; from: string; to: string }>;
  added: Array<{ id: string; to: string }>;
  removed: Array<{ id: string; from: string }>;
}

/** The privilege sets the command builds, probes through, and deletes again. Each mirrors one of
 *  the configurations in docs/fm-adt-privileges.md, so a diff here maps onto a claim there.
 *
 *  `records` is `createEditDelete` on every set that holds the developer privilege because
 *  FileMaker forces it there and refuses to narrow it -- setting anything else is rejected. */
export interface BehaviourSet {
  /** Prefix for this set's probe ids, and the reason the set exists. */
  key: string;
  setName: string;
  accountName: string;
  description: string;
  /** The `create:privilegeSet` body, minus `op` and `name`. `firstLayout` is the name of a layout
   *  the calling account can see, needed only by the set that grants exactly one. */
  body: (firstLayout: string) => Record<string, unknown>;
}

const ALL_PRIVILEGES = {
  noIdleDisconnect: true, canChangePassword: true, canModifyExtensions: true,
  canModifyAccounts: true, canManageDatabase: true, canManageCustomMenu: true,
  printAllowed: true, exportAllowed: true, dataEntryOverride: true,
  menuCommands: 'all', allowOpenQuicklyLayoutsAndScripts: true,
} as const;
const DESIGN_GRANTED = { access: 'allModifiable', allowCreation: true } as const;
const DESIGN_WITHHELD = { access: 'allNoAccess', allowCreation: false } as const;

export const BEHAVIOUR_SETS: readonly BehaviourSet[] = [
  {
    key: 'developer-only',
    setName: 'ADT_Probe_DeveloperOnly',
    accountName: 'adt_probe_devonly',
    description: 'Manage database as a developer, nothing else. Establishes the floor.',
    body: () => ({
      fileOptions: { canManageDatabase: true, menuCommands: 'all' },
      records: { access: 'createEditDelete' },
      layouts: DESIGN_WITHHELD, scripts: DESIGN_WITHHELD, valueLists: DESIGN_WITHHELD,
    }),
  },
  {
    key: 'all-privileges',
    setName: 'ADT_Probe_AllPrivileges',
    accountName: 'adt_probe_allpriv',
    description: 'Every privilege ticked and all design grants -- still not [Full Access].',
    body: () => ({
      fileOptions: { ...ALL_PRIVILEGES },
      records: { access: 'createEditDelete' },
      layouts: DESIGN_GRANTED, scripts: DESIGN_GRANTED, valueLists: DESIGN_GRANTED,
    }),
  },
  {
    key: 'no-developer-privilege',
    setName: 'ADT_Probe_NoDeveloperBit',
    accountName: 'adt_probe_nodev',
    description: 'Everything EXCEPT the developer privilege. Tests whether fm runs at all.',
    body: () => ({
      fileOptions: { ...ALL_PRIVILEGES, canManageDatabase: false },
      records: { access: 'createEditDelete' },
      layouts: DESIGN_GRANTED, scripts: DESIGN_GRANTED, valueLists: DESIGN_GRANTED,
    }),
  },
  {
    key: 'layouts-only',
    setName: 'ADT_Probe_LayoutsOnly',
    accountName: 'adt_probe_layouts',
    description: 'Developer privilege plus Layouts only. Isolates what governs theme writes.',
    body: () => ({
      fileOptions: { canManageDatabase: true, menuCommands: 'all' },
      records: { access: 'createEditDelete' },
      layouts: DESIGN_GRANTED, scripts: DESIGN_WITHHELD, valueLists: DESIGN_WITHHELD,
    }),
  },
  {
    key: 'one-layout',
    setName: 'ADT_Probe_OneLayout',
    accountName: 'adt_probe_onelayout',
    description: 'Developer privilege plus exactly one layout. Shows partial filtering.',
    // A blanket `layouts.access` is refused alongside a per-layout list (`invalid_field`), so this
    // set names only the one layout and lets `newLayouts` cover the rest.
    body: (firstLayout: string) => ({
      fileOptions: { canManageDatabase: true, menuCommands: 'all' },
      records: { access: 'createEditDelete' },
      layouts: {
        allowCreation: false,
        newLayouts: { access: 'noAccess' },
        layouts: [{ name: firstLayout, access: 'modifiable' }],
      },
      scripts: DESIGN_WITHHELD, valueLists: DESIGN_WITHHELD,
    }),
  },
];

/** Every probe id this command records, in the order it reports them.
 *
 *  Ids are the snapshot's keys and appear in its diff, so they are part of the stored format:
 *  renaming one shows up as a removal plus an addition, which is honest but noisy. Prefer adding. */
export const PROBE_IDS: readonly string[] = [
  // Asked as the caller's own [Full Access] account.
  'lock:concurrent-reads',
  'extendedPrivilege:keywords',
  'plugin:validate-plugin-function',
  'plugin:validate-External',
  // Does fm run at all without the developer privilege?
  'no-developer-privilege:open',
  // The floor: developer privilege and nothing else.
  'developer-only:read:table',
  'developer-only:read:layout',
  'developer-only:read:script',
  'developer-only:read:valueList',
  'developer-only:read:account',
  'developer-only:read:privilegeSet',
  'developer-only:create:table',
  'developer-only:create:layout',
  'developer-only:create:script',
  'developer-only:create:valueList',
  'developer-only:create:theme',
  'developer-only:create:customMenu',
  'developer-only:create:extendedPrivilege',
  // Every privilege ticked, still not [Full Access].
  'all-privileges:read:layout',
  'all-privileges:read:account',
  'all-privileges:read:privilegeSet',
  'all-privileges:create:layout',
  'all-privileges:create:script',
  'all-privileges:create:valueList',
  'all-privileges:create:theme',
  // Which grant governs a theme write.
  'layouts-only:create:theme',
  'layouts-only:create:script',
  // Partial filtering: one layout granted of however many the file holds.
  'one-layout:read:layout',
];

/** What changed between two builds' answers. A first run has no previous snapshot, and every
 *  answer is then an addition rather than a change: there is no earlier claim to contradict. */
export function diffBehaviour(prev: BehaviourSnapshot | null, next: BehaviourSnapshot): BehaviourDiff {
  const before = prev?.results ?? {};
  const after = next.results;
  const changed: BehaviourDiff['changed'] = [];
  const added: BehaviourDiff['added'] = [];
  const removed: BehaviourDiff['removed'] = [];
  for (const id of Object.keys(after)) {
    if (!(id in before)) added.push({ id, to: after[id] });
    else if (before[id] !== after[id]) changed.push({ id, from: before[id], to: after[id] });
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) removed.push({ id, from: before[id] });
  }
  return { changed, added, removed };
}

/** One line per change, changes first because they are the ones that mean fm moved. Unchanged
 *  answers get no line: a behaviour snapshot is mostly unchanged and printing it all would bury
 *  the one row worth reading. */
export function renderBehaviourDiff(diff: BehaviourDiff, prevLabel: string, nextLabel: string): string {
  const lines: string[] = [];
  for (const c of diff.changed) lines.push(`~ ${c.id}  ${c.from} -> ${c.to}`);
  for (const a of diff.added) lines.push(`+ ${a.id}  ${a.to}`);
  for (const r of diff.removed) lines.push(`- ${r.id}  was ${r.from}`);
  if (!lines.length) return 'no behaviour changes';
  return [`${prevLabel} -> ${nextLabel}`, ...lines].join('\n');
}
