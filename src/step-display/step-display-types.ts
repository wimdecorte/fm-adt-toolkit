/** The shape of `src/catalogs/fm-step-display.json` — a description of how
 *  FileMaker Pro's Script Workspace writes a script step, derived by measurement
 *  rather than convention.
 *
 *  Provenance: `scripts/derive-step-display.mjs` pairs each step the Claris ADT
 *  `fm` CLI reports (`read:script`) with the line FileMaker renders for it, then
 *  aggregates per step type. The types live here, not in the script, so the
 *  renderer that consumes the catalog and the tool that writes it cannot disagree.
 *
 *  Read `derivedFrom`, `examples`, `attribution` and `confidence` before trusting
 *  any single fact: this file's purpose is to make the weak facts visible rather
 *  than to present everything as equally certain.
 */

/** How one key of a step renders inside FileMaker's `Name [ … ]` brackets.
 *  Every kind here was observed in the owner's data; none is speculative.
 *
 *  Mirrors `RENDER_KINDS` in `scripts/fm-segment-parse.mjs` exactly.
 *  `assertUnionsMatch` in the derivation reads THIS FILE and compares the union
 *  member by member against that array, failing the run on any difference — so the
 *  two really cannot drift. It was kept in sync by hand under a comment claiming
 *  otherwise until a review caught it.
 *
 *  | kind | meaning | example |
 *  |---|---|---|
 *  | `labelled`         | `Label: value`, the value as the CLI reports it | `Target: $result` |
 *  | `bare`             | the value only, no label | `$url` |
 *  | `bareWhenTrue`     | the label alone when the flag is on, nothing when off | `Select` |
 *  | `bareState`        | the boolean's STATE alone, no label, in both polarities — see `values` for the word pair | `Allow User Abort [ Off ]` |
 *  | `labelledState`    | `Label: On` / `Label: No` — see `values` for which word pair | `With dialog: Off` |
 *  | `masked`           | `Label: ••••••••`; the value is NEVER printed | `Password: ••••••••` |
 *  | `enum`             | the value's display name, bare | `Resize to Fit` |
 *  | `labelledEnum`     | `Label: <display name of the value>` | `Flush: Always` |
 *  | `labelledMismatch` | the label is right and the text is neither the value nor a plausible display of it — a measured CLI/Workspace disagreement, not something to render |
 *  | `setMember`        | `Label: <display name of ONE member of a structured value's `set`>` — see `values` | `Style: Document` |
 *  | `suffix`           | printed inside another option rather than as one (`suffixOf`) | `Source Field: Table::Field[10]` |
 *  | `keyPresence`      | the option's text is a function of WHETHER the CLI reports the key, not of its value — see `values`, keyed `present`/`absent` | `Specified: By name` |
 */
export type StepRenderKind =
  | 'labelled'
  | 'bare'
  | 'bareWhenTrue'
  | 'bareState'
  | 'labelledState'
  | 'masked'
  | 'enum'
  | 'labelledEnum'
  | 'labelledMismatch'
  | 'setMember'
  | 'suffix'
  | 'keyPresence';

/** How the derivation justified attaching a rendered option to this key,
 *  strongest first.
 *
 *  `anchored` means the line itself carried the key's label or its value.
 *  The next three are inferences about content no key claimed: `valueWords` and
 *  `labelWords` share words with the key's value or its name, and `sole` means
 *  only "there was nothing else left" — the weakest evidence in the set, kept
 *  because it is labelled and testable rather than because it is reliable.
 *
 *  The last two are NOT rungs on that ladder and must not be read as the weakest
 *  ones. In both, the option's label and text are read straight off the line and
 *  the only thing inferred is WHICH KEY decides the text:
 *
 *  - `presence`      — the key's presence predicts the text in every example, and
 *    no other reported key does. Belongs to `keyPresence` segments.
 *  - `valueFunction` — the key's VALUE predicts the text in every example (with a
 *    distinct text for the state where the key is absent, kept in `whenAbsent`),
 *    and no other reported key does. This is how `Add Account`'s
 *    `Authenticate via` was found: the CLI reports a numeric account type and
 *    never the phrase FileMaker prints for it, so nothing in the line anchors the
 *    key and only the correlation across every example places it. */
export type StepSegmentAttribution =
  | 'anchored'
  | 'valueWords'
  | 'labelWords'
  | 'sole'
  | 'presence'
  | 'valueFunction';

/** Why a segment is not fully corroborated. Any of these makes `confidence`
 *  `'low'`; the strongest supporting evidence stays in `attribution`.
 *
 *  Every one of these is evidence the derivation itself computed. A fact it has
 *  evidence against does not read `measured`, whatever a report may argue: the
 *  point of this file is that the doubt travels with the fact.
 *
 *  - `singleExample`      — exactly one paired example produced this fact. One
 *    transposed pair is enough to invent one, and neither recurrence nor
 *    injectivity can catch that, so one example is never enough on its own.
 *  - `valueCollision`     — two DIFFERENT values of this key rendered as the same
 *    text. Tested only where the text is a derived form of the value (the enum,
 *    state and mismatch kinds), since a passthrough value is injective by
 *    construction and `masked` is deliberately not injective.
 *  - `valueNotFunctional` — ONE value of this key rendered as two different texts.
 *    Strictly stronger than `valueCollision`: it is proof that the text is not a
 *    function of this key, so this key did not produce it. Placements whose text
 *    another key contributed to (a repetition appended to its field) are excluded,
 *    since that difference is a measured render rule rather than a disagreement.
 *  - `labelCollision`     — another key of the same step type renders the same
 *    label, so the label does not identify the key.
 *  - `renderDisagreement` — examples disagreed on the render kind; the most
 *    frequent was taken.
 *  - `labelDisagreement`  — examples disagreed on the label; the most frequent
 *    was taken.
 *  - `rejectedMapping`    — a value -> text observation for this key was not a
 *    code paired with a display name, which is what a false attribution looks
 *    like. The mapping is not recorded and the fact it came from is doubted.
 *  - `thinMapping`        — every display form this key has rests on a single
 *    example AND the placement itself was inferred rather than anchored: nothing
 *    about the segment is corroborated.
 *  - `singleValueOnly`    — an inferred fact whose examples all carry ONE value.
 *    Recurrence over examples is not recurrence over values: it is one observation
 *    repeated, and it can agree by coincidence.
 *  - `mismatch`           — the render kind IS `labelledMismatch`: what FileMaker
 *    shows cannot be produced from what the CLI reports.
 *  - `conditionalLabelThin` — this segment carries a `labelWhen`, and at least one
 *    of the deciding values behind it was seen exactly once. The rule that the
 *    label follows another key's value is corroborated by recurrence across
 *    values; each individual value -> label pair need not be, and this says which
 *    kind of evidence is present.
 *  - `presenceGroupTie` — this is a `keyPresence` option, and SEVERAL reported keys
 *    are present in exactly the same examples as the one named. So the RULE is
 *    corroborated and the KEY is arbitrary: every member of the group renders
 *    identically, which is why the fact is recorded rather than declined, and the
 *    lowest-sorting name is the one written down. Measured on
 *    `Go to Related Record`, where the five unnamed values holding one window
 *    configuration all predict `New window` equally. Read it as "the condition is
 *    real, the address is one of several". */
export type StepSegmentDoubt =
  | 'singleExample'
  | 'valueCollision'
  | 'valueNotFunctional'
  | 'labelCollision'
  | 'renderDisagreement'
  | 'labelDisagreement'
  | 'rejectedMapping'
  | 'thinMapping'
  | 'singleValueOnly'
  | 'mismatch'
  | 'conditionalLabelThin'
  | 'presenceGroupTie';

/** Why an `ignored` claim is not fully corroborated.
 *
 *  - `singleExample`        — exactly one example reported the key and rendered
 *    nothing for it. Ruling 6 applies here as much as to a segment: one example is
 *    never enough on its own.
 *  - `withdrawalDependent`  — an example DID render something for this key and that
 *    reading was withdrawn as false. The claim is then only as good as the
 *    withdrawal: a withdrawal contributes no evidence, but it does remove the
 *    placement that would otherwise disqualify the key, so it is the but-for cause
 *    of this claim's existence. */
export type StepIgnoredDoubt = 'singleExample' | 'withdrawalDependent';

/** A key the CLI reports that FileMaker never shows.
 *
 *  **This is the boldest claim in the catalog** — a universal negative about a key,
 *  which a renderer acts on by printing nothing — so it carries the same evidence
 *  as a segment rather than being a bare string. It was a bare string once, and the
 *  first false entry had nowhere to put its doubt. */
export interface StepIgnoredKey {
  key: string;
  /** Present when `key` is `'slots'`: which member of the CLI's `slots` object
   *  this claim is about. See `StepSlotRef`. */
  slot?: StepSlotRef;
  /** How many examples reported the key and rendered nothing for it. */
  examples: number;
  confidence: 'measured' | 'low';
  /** Present only when `confidence` is `'low'`. */
  doubts?: StepIgnoredDoubt[];
  /** A source OUTSIDE this corpus that says FileMaker does not show this key, named so a
   *  reader can weigh it. Present only where the corpus alone could not settle the claim.
   *
   *  **IT IS THE THIRD PROVENANCE CLASS, the one `StepOrderAttestation` already occupies,
   *  and it is here for one measured situation.** A key whose only apparent rendering was
   *  set aside would otherwise carry `withdrawalDependent` and read `low` however many
   *  clean observations sit behind it, because the claim needs the set-aside to exist. Where
   *  the set-aside itself rests on an external measurement of FileMaker rather than on a
   *  judgment about this data, the claim rests on its own observations plus that source —
   *  so the doubt is answered and this field says by what.
   *
   *  Read it as narrowing rather than as strengthening: `confidence` is `'measured'` because
   *  the observations ARE measured, and this names the one thing about the claim that this
   *  corpus could not have established on its own. Derived from an `attestation` on the
   *  withdrawal in `scripts/derive-step-display.mjs`; the derivation fails the run if it
   *  appears beside the doubt it answers. */
  attestation?: string;
}

/** Where inside the CLI's `slots` object a displayed value comes from.
 *
 *  **`slots` is how the CLI reports a value it does not name.** It carries content
 *  FileMaker prints — a script parameter, a calculated title, a file reference, a
 *  scanned field — under a member name for the value's KIND and, for most members,
 *  a slot NUMBER within that kind. 146 of the 1203 derivation examples carry one,
 *  and until this existed every one of them read as a key FileMaker never shows.
 *
 *  Read it as a path: `number` present means `step.slots[member][number]`, absent
 *  means `step.slots[member]` is the value itself (measured: `fileReference` is a
 *  bare string, `memberKey` a bare number).
 *
 *  Which slot feeds which displayed option is DERIVED, key by key, from the same
 *  anchoring and corroboration the named keys go through — not hand-mapped. The
 *  numbering is stable per step type in the data behind this catalog, and a slot
 *  whose number moved would show up as a `valueNotFunctional` doubt rather than
 *  silently mis-render. */
export interface StepSlotRef {
  /** The `slots` member: `calc`, `fileReference`, `memberKey`, `text`, `numeric`,
   *  `list`, `field`, `path`, `scriptKey`, `fileReferenceKey` in this corpus. */
  member: string;
  /** The slot number within the member, as the CLI's own string key. Absent when
   *  the member holds the value directly. */
  number?: string;
}

/** The rule that refused an `ignored` observation, because the rendered line showed
 *  something that could be the key. See `StepDisplayEntry.ignored`. */
export type StepRefutation =
  | 'insideAnotherOption'
  | 'inUnattributedContent'
  | 'displayedUnderAnotherKey';

/** Why a key could not be settled either way.
 *
 *  - `withdrawn`      — a rendering was found for it and hand review established
 *    that the rendering was false.
 *  - `refuted`        — every example that could have evidenced an `ignored` claim
 *    was refused by one of the rules in `StepRefutation`, leaving none.
 *  - `opaqueMetadata` — the key's only placements were dropped as the CLI's own
 *    metadata on an opaque step, so no clean observation of it exists. Fires zero
 *    times on the corpus this catalog was derived from; the cause is named because
 *    the derivation can produce it, not because it did.
 *  - `labelOwnedElsewhere` — the key's only evidence was counting (`sole`), and the
 *    label it claimed is one another key of the same step type is anchored to. A
 *    label FileMaker printed for another key outweighs "nothing else was left over",
 *    so the segment is dropped rather than demoted — the option was being printed
 *    twice, which is the shape the owner rejected in ruling 7. */
export type StepUnresolvedCause =
  | 'withdrawn'
  | 'refuted'
  | 'opaqueMetadata'
  | 'labelOwnedElsewhere';

/** A key the data could not settle, and why.
 *
 *  It carries its reason for the same purpose the other lists carry evidence: a
 *  consumer should be able to tell "we considered this never-shown and the line
 *  refuted it" from "we found a rendering and withdrew it", without going to a
 *  report. */
export interface StepUnresolvedKey {
  key: string;
  /** Present when `key` is `'slots'`. See `StepSlotRef`. */
  slot?: StepSlotRef;
  cause: StepUnresolvedCause;
  /** For `refuted`: how many observations were set aside, and by which rules. */
  observations?: number;
  refutedBy?: StepRefutation[];
}

export interface StepSegment {
  /** The key the CLI reports, or `'slots'` when the value is one the CLI did not
   *  name — then `slot` says which one. */
  key: string;
  /** Present only when `key` is `'slots'`. See `StepSlotRef`. */
  slot?: StepSlotRef;
  render: StepRenderKind;
  /** Absent for `bare`, `enum` and `suffix`, which print no label. */
  label?: string;
  /** The label when it is not fixed: FileMaker relabels this option according to
   *  ANOTHER key's value. Keyed by that key's value, with `absent` for the state
   *  where the CLI does not report it at all; a value with no entry falls back to
   *  `label`.
   *
   *  Measured on `Add Account`, where one key's value decides three separate
   *  things at once — its own displayed option, THIS label, and whether some other
   *  options appear (`hiddenWhen`). Recorded only when exactly one reported key's
   *  value predicts the label in every example, so a second key that happens to
   *  correlate makes this decline rather than guess. */
  labelWhen?: { key: string; labels: Record<string, string> };
  /** For `suffix` only: the key whose option this one is printed inside. */
  suffixOf?: string;
  /** This option is printed INSIDE the named key's option, after its value, with a
   *  space and no `;` separator: `Script: “name” from file: “source”`.
   *
   *  A measured render form, not a formatting choice — FileMaker writes these two
   *  as one option, and the matcher can tell them apart because the label does not
   *  begin at an option boundary. Distinct from `suffixOf`, which appends a
   *  `[bracket]` and carries no label of its own. */
  inlineOf?: string;
  /** FileMaker wraps this key's value in curly quotes (`“noop”`, `“file.txt”`).
   *  Present only when every contributing example showed it; where examples
   *  disagreed it is absent and the disagreement is reported. */
  quoted?: true;
  /** The value's display form, by the value the CLI reports. Present for the
   *  kinds whose text is NOT the value (`enum`, `labelledEnum`, `labelledState`,
   *  `bareState`) and never for `masked`, whose whole point is that the value is
   *  not printed. Three kinds key it differently, each documented where it is
   *  derived:
   *
   *   - `setMember`   — by MEMBER of the structured value's `set`, not by the
   *     value, which is an object. A renderer looks up each member and expects
   *     exactly one hit.
   *   - `keyPresence` — by `present` / `absent`, since the value is irrelevant.
   *   - `suffix`      — by value, and the text is the BRACKET CONTENT, so
   *     `{"0": ""}` means FileMaker prints `[]`. `VALUE_MAP_KINDS` excluded
   *     `suffix` until the round-trip measured that empty bracket.
   *
   *  **ON `bare` AND `labelled` IT IS AN OVERRIDE, NOT AN ENUMERATION, and a consumer
   *  must read it that way.** Those kinds print the value as it stands; the map lists
   *  only the values FileMaker was measured to print differently, and a value with no
   *  entry prints as itself rather than becoming a missing display form. Measured:
   *  `Set Zoom Level` writes `zoom` bare for eight percentages and `Zoom In` / `Zoom Out`
   *  for two codes, and `Configure Region Monitor Script` writes `Monitor: iBeacon` but
   *  `Monitor: Geofence` for `geoLocation`. Making those segments an `enum` to hold two
   *  entries would print NOTHING for every zoom level these two scripts never used —
   *  the one direction the owner ruled out ("we should not omit options") — so the
   *  override is the safe shape as well as the measured one. */
  values?: Record<string, string>;
  /** What FileMaker prints for this option when the CLI does NOT report the key,
   *  with the number of examples behind it. `''` is the empty option slot —
   *  `Parameter:` with nothing after it — and is a real measurement, not a
   *  missing value.
   *
   *  Recorded only when EVERY example that omits the key shows the same thing —
   *  UNLESS `flagBit` says which examples show it.
   *
   *  `flagBit` is the one place this catalog reads a bit of the CLI's packed
   *  `flags` word, and it exists for FileMaker's broken-reference placeholder:
   *  `Go to Field [ <Table Missing> ]` reports no field key at all, exactly like a
   *  step with no field, and the ONLY thing that tells the two apart is that bit.
   *  It is derived, not assumed: a bit qualifies only if it is set in every
   *  absent-key example that shows the text and clear in every absent-key example
   *  that does not, and the bit is taken only when ONE bit satisfies that across
   *  every step type in the corpus at once. When `flagBit` is present a renderer
   *  must print `text` only while `(step.flags ?? 0) & flagBit`. */
  whenAbsent?: { text: string; examples: number; flagBit?: number };
  /** Values of this key for which FileMaker prints NOTHING — the option is
   *  present in the JSON and absent from the line.
   *
   *  Measured, and bounded by a rule that makes it safe: a value that ANY example
   *  rendered is never listed here, so a key whose option is suppressed by state
   *  rather than by value cannot end up looking like a value that never prints.
   *  The repetition default lives here (`["1"]`) — the owner: "FM does not print
   *  the rep number if it is 1" — and it lived in the derivation's code, reaching
   *  no consumer, until this field existed. */
  omittedValues?: string[];
  /** For a value that is a list of file paths: how much of the first entry
   *  FileMaker prints. `fileName` drops the scheme AND every path component; the
   *  owner ruled on it directly ("FM does not print the prefix"). */
  pathForm?: 'schemeStripped' | 'fileName';
  /** This option is not printed at all while the CLI reports the named key.
   *
   *  Two provenances, both machine-verified against every example by
   *  `assertHiddenWhen`: a small hand-stated table (`HIDDEN_WHEN` in
   *  `scripts/derive-step-display.mjs`, which explains why those three are stated
   *  rather than searched for), and a DERIVED search whose conditions are
   *  deliberately strict — the same value must be displayed in one state and not in
   *  the other, both states must recur, and exactly one reported key may explain
   *  the split. The strictness is the point: a loose version of this search fires
   *  on 26 step types here, most of them coincidence. */
  hiddenWhen?: {
    keyPresent: string;
    /** Present exactly when `keyPresent` is `'slots'`: which value the CLI does not NAME
     *  decides this. Measured on `Go to Related Record`, whose window configuration is five
     *  unnamed values and whose animation option FileMaker drops while they are there. */
    slot?: StepSlotRef;
  };
  /** How many paired examples showed this key rendering this way. Eight is
   *  evidence; one is a hypothesis. */
  examples: number;
  /** The STRONGEST justification any example gave. `'sole'` here means no example
   *  managed better than counting what was left over. */
  attribution: StepSegmentAttribution;
  confidence: 'measured' | 'low';
  /** Present only when `confidence` is `'low'`, naming every test that failed. */
  doubts?: StepSegmentDoubt[];
}

/** Examples of a step type whose FileMaker line this catalog knowably cannot
 *  reproduce, kept as three distinct causes because they are not the same kind of
 *  gap and must not be averaged into one "accuracy" number. */
export interface StepDisplayResidual {
  /** The CLI reported `{opaque, editable, reason}` and no options at all, so
   *  there is nothing to render from. */
  opaque?: number;
  /** FileMaker displayed options the CLI never reports (`Privilege Set:`,
   *  `Specified: From list`, `Animation: None`). Faithful rendering is not merely
   *  unknown here but impossible: we are never sent the data. */
  unreported?: number;
  /** Displayed content that some reported key might own, where the derivation
   *  refused to guess which. Ambiguity in the data, not a decision. */
  unattributed?: number;
}

/** Why two keys are in the order they are, when these examples never showed them
 *  together and something outside the data did.
 *
 *  A THIRD provenance class beside measured and inferred, and deliberately not a
 *  promotion: the segments keep whatever `confidence` their own evidence earns.
 *  Where the examples DO order a pair, they win and the attestation is dropped
 *  with a note — measured reality outranks attestation. */
export interface StepOrderAttestation {
  /** The two keys, in the attested order. */
  keys: [string, string];
  /** Where the attestation comes from, so a reader can weigh it. */
  source: string;
}

export interface StepDisplayEntry {
  /** Present only when FileMaker's displayed name differs from the CLI's. */
  displayName?: string;
  /** FileMaker's displayed name comes from state outside the script — an
   *  installed plugin's registered name — so no name can be derived for it. */
  displayNameUnverifiable?: true;
  /** FileMaker prints the brackets even when no option renders: `Set Variable []`
   *  rather than `Set Variable`. Measured per step type, because it is NOT
   *  universal — `End If` and a comment render with no bracket at all.
   *
   *  The repo owner on the empty slot generally: "FM is very inconsistent with
   *  this so I'm ok with whatever we do here." So this field exists by his
   *  indifference, and it follows the corpus: 18 examples print `[]`, and the two
   *  that pad the brackets with spaces are reported as still not matching rather
   *  than fitted to. */
  emptyBrackets?: true;
  /** FileMaker renders this step as `# <text>`: the step's `text` key printed
   *  after the name with no brackets and no label. Checked by the derivation
   *  against the value of `text`, which is therefore displayed and deliberately
   *  NOT listed in `ignored`. It describes the whole step rather than one of its
   *  keys, which is why it is a flag here and not a `StepRenderKind`. */
  commentStyle?: true;
  segments: StepSegment[];
  /** Keys the CLI reports that FileMaker never shows — so a consumer can tell
   *  "deliberately not shown" from "we did not know about it". Each carries its own
   *  evidence: see `StepIgnoredKey`, and read `confidence` before trusting one.
   *
   *  An example only counts as evidence if the rendered line showed nothing that
   *  could be the key. Three things REFUTE that, and a refuted example is not
   *  counted at all — a key left with none goes to `unresolved`, never here:
   *
   *   1. the key's value appears inside another option's text (a repetition printed
   *      on the option it belongs to is the clean case of this);
   *   2. the key's value appears in content no key claimed — something was rendered
   *      and the attribution failed, which is not the same as nothing being rendered;
   *   3. the same value is displayed under ANOTHER key's label, so the option could
   *      be either key's.
   *
   *  All three say only that the negative is not assertable from that example, never
   *  that the key WAS displayed or how. On the corpus this catalog was derived from,
   *  rule 1's only firing is a case where the value belongs to a third key entirely
   *  and the coincidence is what triggers it — the right verdict for the wrong
   *  mechanism. The failure direction is deliberately safe: a refutation can only
   *  lower a count or move a key to `unresolved`, never place one or invent a
   *  segment.
   *
   *  **THE ONE LIMITATION NO `examples` COUNT CAN WARN YOU ABOUT.** Everything else
   *  in this catalog calibrates confidence *within* the corpus it was derived from.
   *  This is the boundary *of* that corpus, and it is invisible from inside it:
   *
   *  > `ignored` is a universal negative derived from one corpus — 1203 steps from
   *  > one file. "FileMaker never shows this key" therefore means "never shown in
   *  > the option combinations this owner happened to write". A key FileMaker
   *  > reveals only when some other option is set will read as never shown with any
   *  > number of examples behind it.
   *
   *  No count, however large, detects that; only wider data or a round-trip against
   *  FileMaker can narrow it. This scoping applies to `ignored` specifically — the
   *  segment facts are scoped by their own evidence and are not affected by it. */
  ignored: StepIgnoredKey[];
  /** Keys the data could not settle. Neither shown nor deliberately hidden —
   *  unknown — and each says WHY, so declining to claim is itself informative
   *  rather than a silence: see `StepUnresolvedKey`.
   *
   *  A withdrawn key lands here unless the `ignored` claim stands on its own
   *  evidence — other examples that report the key and do not show it, which is
   *  measured independently of the withdrawal, since the withdrawn example is one
   *  that DID show something. So `ignored` never rests on a withdrawal alone, and
   *  a key is never in both lists. The derivation asserts both properties and
   *  prints each withdrawn key's disposition with its independent count. */
  unresolved?: StepUnresolvedKey[];
  /** Orderings in `segments` that these examples could not settle and external
   *  attestation did. Absent when the whole order is observed or inferred. */
  attestedOrder?: StepOrderAttestation[];
  /** How many paired examples supported this entry. One example with an unusual
   *  option set is weaker evidence than eight. */
  derivedFrom: number;
  /** Absent when every example was fully reproduced. */
  residual?: StepDisplayResidual;
  /** True when every contributing example round-trips exactly. Set by the
   *  round-trip verification, not by the derivation.
   *
   *  **IT IS A WEAKER STATEMENT THAN IT LOOKS, in two ways a consumer cannot see from
   *  here.** Both are measured on the corpus this catalog was derived from (147 of 209
   *  entries verified):
   *
   *   - **49 of the 147 have NO SEGMENTS AT ALL** — `End If`, `Else`, `Beep`,
   *     `Copy Record/Request`, most with `derivedFrom: 1`. FileMaker prints those steps as
   *     a bare name, so "every example round-trips" means the NAME reproduced and no
   *     display fact was checked, because the entry states none.
   *   - **`verified` and a segment's `confidence` are different claims and can disagree:
   *     101 of the 223 low-confidence segments live inside a verified entry.** Not a
   *     contradiction. `verified` is per-ENTRY line reproduction — the whole line came out
   *     right in every example — while `confidence` is per-SEGMENT evidence about the rule
   *     that produced one option. A line can reproduce while one of its facts rests on a
   *     single example: it agreed here and may not generalise. When they disagree, take
   *     `confidence` as the statement about the FACT and `verified` as the statement about
   *     the LINE. */
  verified: boolean;
}

/** Keyed by the name the CLI reports, which is what a consumer has in hand. */
export type StepDisplayCatalog = Record<string, StepDisplayEntry>;
