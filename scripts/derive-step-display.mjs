#!/usr/bin/env node
/** Derive `src/catalogs/fm-step-display.json` — how FileMaker Pro's Script
 *  Workspace writes each script step — from paired data.
 *
 *  Data provenance: the owner's `fmnet://localhost/Ooe`, READ ONLY. Two scripts,
 *  each held twice over in `fm_scripts/`: `<stem>.adt.json` is what the Claris ADT
 *  `fm` CLI reports (`read:script`), `<stem>.txt` is the Script Workspace's own
 *  rendered text. Both halves are COMMITTED — see fm_scripts/README.md — so this
 *  runs anywhere the repo does. Nothing here opens the FileMaker file or invokes
 *  the CLI; the JSON is the cache, and a missing one is an incomplete checkout.
 *
 *  Composition: `alignSteps` (scripts/fm-script-align.mjs) pairs each step with
 *  its rendered line; `matchSegments` (scripts/fm-segment-parse.mjs) says which
 *  part of that line came from which JSON key. This file only AGGREGATES, and its
 *  whole job is to aggregate honestly:
 *
 *   - a fact's evidence count and how it was justified travel WITH the fact, so a
 *     consumer reading the JSON alone can tell eight examples from one;
 *   - two corroboration tests (recurrence and injectivity) run against every
 *     fact, and any failure marks it `low` rather than dropping it silently;
 *   - what the pairs could NOT settle is reported in three distinct categories
 *     (see `classifyResidual`) instead of being averaged into one number;
 *   - two facts established as false by hand review are withdrawn BY NAME
 *     (`WITHDRAWN_FACTS`) rather than quietly left out.
 *
 *  Hand-run: `node scripts/derive-step-display.mjs`. It is not shipped code, but
 *  the types it writes to are (`src/step-display/step-display-types.ts`), so the
 *  renderer and this script cannot disagree about the shape.
 *
 *  **REPRODUCING THE COMMITTED CATALOG IS TWO COMMANDS, IN THIS ORDER:**
 *
 *      npm run derive:step-display      # this script: writes the catalog
 *      npm run roundtrip:step-display   # measures it against FileMaker's text
 *
 *  This one emits `verified: false` on every entry AND asserts it, so a re-derivation
 *  cannot claim a verification it did not perform; the round-trip is the only thing that
 *  can know it and the only thing that writes it. So this script alone leaves the tracked
 *  catalog dirty by exactly those 147 lines, and the pair reproduces the committed file
 *  byte for byte.

 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { alignSteps, DISPLAY_NAME_OVERRIDES, NAME_UNVERIFIABLE, normaliseCalc } from './fm-script-align.mjs';
import {
  matchSegments,
  bracketContent,
  displayKeys,
  expandSlots,
  parseSlotID,
  isRepetitionKey,
  isSetValue,
  RENDER_KINDS,
} from './fm-segment-parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'src', 'catalogs', 'fm-step-display.json');

/** The two paired scripts, both halves committed in `fm_scripts/`: `body` is the
 *  CLI's `read:script` result verbatim, `text` is the Script Workspace export of
 *  the same script. Same stem, two extensions — see fm_scripts/README.md. */
const SOURCES = [
  {
    id: 70,
    body: path.join(ROOT, 'fm_scripts', '20260625_missing.adt.json'),
    text: path.join(ROOT, 'fm_scripts', '20260625_missing.txt'),
  },
  {
    id: 55,
    body: path.join(ROOT, 'fm_scripts', 'All script steps and all options 20260318.adt.json'),
    text: path.join(ROOT, 'fm_scripts', 'All script steps and all options 20260318.txt'),
  },
];

/** Facts the matcher produced that hand review established are FALSE. They are
 *  named here, with their evidence, because a silent omission would look exactly
 *  like a fact the data never contained.
 *
 *  **A withdrawal is stated as a SET, not as a single fact.** A transposition is a
 *  pair by definition — two keys reporting byte-identical values, each taking the
 *  other's label — so withdrawing one side leaves the other side asserted, and the
 *  surviving half is false by exactly the same evidence. Matching on one
 *  (step, key, label) triple made that structurally unavoidable, which is how
 *  `object name -> "Function Name"` survived the removal of its mirror.
 *
 *  A fact may also be withdrawn by its rendered TEXT, for a false value mapping
 *  inside an otherwise sound segment: `Move/Resize Window`'s `target` really does
 *  render `current` as `Current Window`, and really does not render `byName` as
 *  `Current file`. Withdrawing the segment would take the true mapping with it.
 *
 *  **Where a withdrawn key ends up.** `unresolved` — UNLESS the `ignored` claim
 *  stands on evidence of its own: examples that reported the key and rendered
 *  nothing for it. That evidence is independent of the withdrawal, because the
 *  withdrawn example placed something and so never contributed to `ignoredCounts`.
 *  Measured: `curlOptionsSpecified` is reported and not displayed in 7 of its 8
 *  examples, while `function` and both `objectName` keys have NO such example
 *  (0 of 1) and go to `unresolved`.
 *
 *  **But a withdrawal is still the but-for cause of the `ignored` membership**, since
 *  `ignored` filters on the post-withdrawal placements: delete a withdrawal and its
 *  key leaves the list. So it contributes no evidence and yet enables the claim, and
 *  the claim now says so — every such key carries the `withdrawalDependent` doubt
 *  and reads `low`. Nothing is enforced by prose here: `assertShape` fails the run
 *  if a key is in both lists, the derivation prints each withdrawn key's
 *  disposition with its independent count, and `assertWithdrawalsUsed` fails if a
 *  withdrawal matches nothing at all (a stale one would otherwise sit here
 *  asserting a fact the matcher no longer produces).
 *
 *  **UNLESS THE WITHDRAWAL BRINGS EVIDENCE THE CORPUS DOES NOT CONTAIN**, which is
 *  what an `attestation` on a fact declares. Then the `ignored` claim rests on its own
 *  clean observations PLUS a named source about FileMaker, rather than on a judgment,
 *  and the `withdrawalDependent` doubt is answered instead of carried. The attestation
 *  travels into the catalog on the `ignored` entry, so nothing reads as corpus-measured
 *  that is not — the same third provenance class `EXTERNAL_ORDER` occupies, and for the
 *  same reason.
 *
 *  **THE DISTINCTION IS THE WHOLE OF IT, and it is about the withdrawal's own
 *  provenance rather than about which key is convenient.** A withdrawal argued from the
 *  CORPUS — a transposition proved on another step type, a re-attribution of an option
 *  to the key whose value supplies its text — is a judgment INSIDE the data, and a
 *  universal negative that exists only because of it must say so. A withdrawal argued
 *  from an external measurement of FileMaker supplies a fact the corpus is missing. On
 *  this corpus exactly one fact qualifies, and the two that do not are instructive:
 *
 *   - `Perform Semantic Find`'s `returnCount` correlates PERFECTLY with the option in
 *     all 10 examples (5 true and shown, 5 false and not), and the withdrawal moves only
 *     the TEXT to `count`. The switch really does decide whether FileMaker shows the
 *     option, so `never shown` is a claim about this key that the data argues against.
 *     It keeps its doubt, and rightly.
 *   - `Go to List of Records`'s unnamed member key is set aside by a DERIVED rule
 *     (`labelOwnedElsewhere`) with no external source at all. It keeps its doubt too.
 *
 *  And the same test refuses to help the qualifying one on corpus evidence: its value is
 *  `true` in the one example that shows the phrase and `false` in the seven that do not,
 *  so the correlation is perfect there as well and no measurement inside this data can
 *  break it. That is exactly why an external source is the honest instrument, and why a
 *  derived rule was not written instead. */
const WITHDRAWN_FACTS = [
  {
    step: 'Perform SQL Query by Natural Language',
    facts: [
      { key: 'function', label: 'Web Viewer' },
      { key: 'objectName', label: 'Function Name' },
    ],
    reason:
      'transposition: `objectName` is what renders as `Web Viewer`, and `function` renders as ' +
      '`Function Name` (proved by `Perform JavaScript in Web Viewer` at script 55 step 1103, text ' +
      'line 1104, which renders `Object Name: … ; Function Name: …`). Both keys report byte-identical ' +
      'calculations at script 55 step 943, so the matcher paired them backwards and BOTH halves are ' +
      'false. Neither recurrence nor injectivity can catch it — each occurs once and label->key ' +
      'stays injective.',
  },
  {
    step: 'Generate Response from Model',
    facts: [
      { key: 'function', label: 'Web Viewer' },
      { key: 'objectName', label: 'Function Name' },
    ],
    reason:
      'the same transposition, on a second step type, and now with the same two keys: script 55 step ' +
      '880 renders `… ; Web Viewer: <calc> ; Function Name: <calc> …` and several keys carry that ' +
      'identical calculation. Until the suffix rule was generalised, the `Web Viewer` half was taken ' +
      'by `slidingWindowVariableRepetition` — a repetition key labelled `Web Viewer`, absurd on its ' +
      'face — because that key had no route to a `suffix` segment; it now takes its suffix and the ' +
      'transposition shows its true shape. The recurrence proves the failure is structural wherever ' +
      'two keys hold the same value, not one located incident.',
  },
  {
    step: 'Move/Resize Window',
    facts: [{ key: 'target', label: null, text: 'Current file' }],
    reason:
      'a false VALUE MAPPING inside a sound segment, withdrawn by its rendered text so the true ' +
      'mapping survives. `target: byName` does not render as `Current file` — script 55 step 642 ' +
      'renders `Name: <var> ; Current file ; Height: … ` and `byName` is already expressed by the ' +
      '`Name:` option, so `Current file` is a separate option the CLI does not report. The other ' +
      'example (step 641, `target: current` -> `Current Window`) is true and is kept. Demotion is ' +
      'for a fact we cannot corroborate; this one is disproved, so it is withdrawn.',
  },
  {
    step: 'Perform Script on Server with Callback',
    facts: [
      { key: 'callbackState', label: 'Callback script specified' },
      { key: 'script', label: 'Callback script specified' },
    ],
    reason:
      'two keys took `Callback script specified:` by sharing a word with it — `callbackState` shares ' +
      '"callback", `script` shares "script" — and neither owns it. Disproved from inside the data: ' +
      "`callbackState`'s real rendering is `State:` (`halt -> Halt`, `exit -> Exit`, `resume -> " +
      'Resume`, `pause -> Pause` at script 55 steps 98-101), and `script`\'s is the bare script name ' +
      '(`“…”` at steps 97-101). `Callback script specified` is the callback half of the ' +
      '`Specified:` option, which no reported key holds a value for at all. Both halves are withdrawn ' +
      'together because they are one misattribution appearing in the two states of one step.',
  },
  {
    step: 'Go to Related Record',
    facts: [{ key: '@slot:calc:0', label: null, text: 'New window' }],
    reason:
      'a false VALUE MAPPING that is a coincidence of the owner\'s own window name. The first of the five ' +
      'unnamed values this step reports for a new window is its NAME, and in five examples he named it ' +
      '"new window" — so the matcher paired the value with FileMaker\'s `New window` on shared words and ' +
      'the mapping reads as a display form. Disproved by script 55 steps 236-238, where the same slot ' +
      'holds a variable and FileMaker prints `New window` just the same: the option follows the ' +
      'PRESENCE of the window configuration, not the value of any part of it. Kept as a withdrawal ' +
      'rather than a demotion because a renderer acts on a low fact, and this one would print the option ' +
      'only for a window the owner happened to name that way. Withdrawing it frees all eight ' +
      'occurrences for the presence route, which places them on the same slot.',
  },
  {
    step: 'Perform Semantic Find',
    facts: [{ key: 'returnCount', label: 'Return count' }],
    reason:
      'the label is this key\'s and the TEXT is another key\'s value. FileMaker writes ' +
      '`Return count: <calc>` and `returnCount` is a boolean, which cannot produce a calculation — the ' +
      'mapping was rejected for exactly that reason and the segment then rendered nothing at all. The ' +
      'option is `count`\'s: `count` is reported in the five examples that show it (script 55 steps ' +
      '930-934) and absent in the five that do not (925-929), and its value IS the text. The earlier ' +
      'reading is already recorded as false in this plan\'s own ledger — the veto that put `count` in ' +
      '`unresolved` fired on a coincidence, and the note on it says "FileMaker really does display ' +
      '`count`, as `Return count:`". Withdrawing the label frees the option for the value-equality route, ' +
      'which places it on `count` and leaves `returnCount` as a key reported and not shown.',
  },
  {
    step: 'Go to Layout',
    facts: [{ key: 'target', label: 'Animation' }],
    reason:
      "WITHDRAWN ON THE REPO OWNER'S RULING. `target` does not render as `Animation:` at all. Put to " +
      'him as "we print Animation and FileMaker prints nothing for it", he answered: "this conclusion ' +
      'is wrong, clearly FM does print the animation option." He is right, and the lines say so: ' +
      'FileMaker prints `Animation:` ONCE and we printed it TWICE — once from the real `animation` key ' +
      'and once from this fact. What the 5 examples with no `animation` key show is `Animation: None`, ' +
      "which is the ABSENT-key form of `animation` (now `whenAbsent`), not anything of `target`'s. " +
      'Injectivity caught this in round 5 and it was demoted to `low` rather than withdrawn across four ' +
      'review rounds; a renderer acts on a `low` fact, so demotion was never enough.',
  },
  {
    step: 'Go to List of Records',
    facts: [{ key: 'target', label: 'Animation' }],
    reason:
      'the same false fact on a second step type, withdrawn on the same ruling: 2 placements labelled ' +
      '`Animation` gave this key the display forms `layoutNameByCalc -> None` and ' +
      '`layoutNumberByCalc -> None`, which are `animation`\'s absent-key form. The segment survives on ' +
      'its `Using layout` placements, which are true, so only the `Animation` half is withdrawn.',
  },
  {
    step: 'Insert from URL',
    facts: [{ key: 'curlOptionsSpecified', label: 'Do not automatically encode URL' }],
    reason:
      'single-example `sole` attribution that contradicts the `ignored` entry for this key, which 7 of ' +
      'its 8 examples support. Counting was the only evidence, so this is the weakness of `sole`, not ' +
      'a win for it — and no test inside this corpus can break the placement, because the value is ' +
      '`true` in exactly the one example that shows the phrase. The refutation is external, which is ' +
      'what `attestation` records.',
    // WHY THIS ONE WITHDRAWAL CARRIES A SOURCE. It is the key that has already caused a real
    // defect in this project, on the one step type the app itself generates: reading it as the
    // `Specify cURL options` checkbox silently dropped the method and headers from working
    // scripts. An option reading `curlOptionsSpecified` on a rendered line invites exactly
    // that conclusion again, so a `low` claim a renderer prints anyway is not good enough here.
    attestation:
      'CLAUDE.md, which records this key as reported but not displayed and not a gate: a ' +
      'FileMaker-authored working step reads it back false while its options render, and the ' +
      'options popover offers checkboxes for select entire contents, target and verify SSL ' +
      'certificates only, with no checkbox for the options themselves',
  },
];

/** An ordering the examples cannot settle, taken from external attestation.
 *
 *  A THIRD provenance class beside measured and inferred, and deliberately not a
 *  promotion of any segment's `confidence`: it says why the key order is what it
 *  is, nothing more. Each entry records its source in the catalog so a reader can
 *  tell it from an observed order. Applied ONLY where these two scripts show no
 *  precedence evidence at all; where the data speaks, the data wins and the
 *  contradiction is reported. */
const EXTERNAL_ORDER = [
  {
    step: 'Insert from URL',
    keys: ['verifySslCertificates', 'curlOptions'],
    source:
      'CLAUDE.md, where a FileMaker-authored Insert from URL step is recorded as rendering ' +
      '(... ; Verify SSL Certificates ; cURL options: <calc>). No example in either script carries a ' +
      'true verify-SSL-certificates flag together with a non-empty cURL-options calculation, so these ' +
      'pairs cannot order the two; this is the one step type the app itself generates, so the order ' +
      'matters more here than anywhere else in the catalog.',
  },
];

/** An option FileMaker stops printing while another key is present, stated by
 *  hand and verified against every example.
 *
 *  **Why this one is not derived.** The search that would derive it — "a key that
 *  is reported and not displayed here, while some other key present only here
 *  explains it" — runs over the same evidence as the 47 mismatches where WE print
 *  an option FileMaker does not, and the owner has explicitly accepted two of
 *  those shapes as they are (`Automatically open ; Create email`, `With dialog:
 *  On`): "item 9 and 10: I'm ok with how we do it." A derived rule would have
 *  reached into those rows and changed them, against his ruling. So the mechanism
 *  is confined to the case he DID rule on, and `assertHiddenWhenUsed` fails the
 *  run if an entry stops matching or is contradicted by any example.
 *
 *  Ruling 3, in his words: "item 3 is clearly completely wrong and I don't
 *  understand your reasoning for it." Measured: `Perform Script` reports
 *  `script: "<name>"` in all 4 examples, and in the one that also reports
 *  `scriptName` FileMaker prints no script name at all — it prints
 *  `Specified: By name` and the calculation. */
const HIDDEN_WHEN = [
  {
    step: 'Perform Script',
    key: 'script',
    keyPresent: 'scriptName',
    evidence:
      'script 55 steps 87-89 report `script` without `scriptName` and FileMaker prints it; step 90 ' +
      'reports both and FileMaker prints neither the name nor a slot for it.',
  },
  {
    step: 'Perform Script on Server',
    key: 'script',
    keyPresent: 'scriptName',
    evidence: 'the same shape on the server variant: script 55 step 94 reports both and shows no script name.',
  },
  {
    step: 'Perform Script on Server with Callback',
    key: 'script',
    keyPresent: 'scriptName',
    evidence: 'the same shape again: script 55 step 102 reports both and shows no script name.',
  },
];

/** The hand-stated rules plus the derived ones, filled in by the main flow before
 *  anything reads it. One table, so `deriveSegment` and `assertHiddenWhen` cannot
 *  see different rules — the assertion verifying only half of them would be exactly
 *  the kind of unchecked claim this file exists to avoid. */
const HIDDEN_RULES = [...HIDDEN_WHEN];

/** THE DERIVED HALF of `hiddenWhen`, and why its conditions are as strict as they
 *  are.
 *
 *  The repo owner ruled that `Add Account` shows a different option set depending
 *  on its account type — no password option at all for an externally authenticated
 *  account — and that this is derivable, because the deciding value is in the JSON.
 *  It is. But the OBVIOUS search for it ("a key reported and not displayed here,
 *  while some other key present only here explains it") fires on 26 step types in
 *  this corpus, and most of those are coincidence: a step type with many optional
 *  keys offers a dozen keys that happen to be present in exactly the examples where
 *  some other option is not shown.
 *
 *  So four conditions, each removing one way to be wrong, measured counts in
 *  brackets:
 *
 *   1. **the same value must be displayed in one state and hidden in the other**
 *      [26 -> 8]. If the value differs, the value is the simpler explanation and
 *      `omittedValues` is the field for it. `Add Account | password` reports one
 *      variable name in all 11 examples and FileMaker shows it in 3 — nothing about
 *      the value can explain that.
 *   2. **both states must recur at least three times** [8 -> 2]. Two examples
 *      either side is a coincidence a corpus this size produces freely; it is what
 *      offered `Perform RAG Action | target -> tokens per text chunk`, where the
 *      real switch is a third key's VALUE and the candidate merely correlates.
 *   3. **exactly one reported key may explain the split** [kills the rest]. Where
 *      seven keys predict it equally well the evidence cannot say which, and this
 *      declines rather than taking the first.
 *   4. **the deciding key must be one the CLI names.** `hiddenWhen.keyPresent` is a
 *      key name and a slot has none, so a slot candidate makes the search decline —
 *      stated rather than silently coerced.
 *
 *  Every rule this finds goes through `assertHiddenWhen` beside the hand-stated
 *  ones, so a derived rule is verified against every example exactly as the three
 *  written by hand are. */
const DERIVED_HIDDEN_WHEN_MIN = 3;

function deriveHiddenWhen(collected) {
  const found = [];
  const notes = [];
  const byName = new Map();
  for (const observation of collected.observations) {
    if (observation.opaqueStep) continue;
    if (!byName.has(observation.name)) byName.set(observation.name, []);
    byName.get(observation.name).push(observation);
  }

  for (const [name, list] of byName) {
    const keys = [...new Set(list.flatMap((observation) => displayKeys(observation.raw)))].sort();
    for (const key of keys) {
      const reported = list.filter((observation) => Object.hasOwn(observation.step, key));
      // The KEPT placements, so a withdrawn one cannot make a key look displayed.
      const shows = (observation) => observation.kept.some((segment) => segment.key === key);
      const shown = reported.filter(shows);
      const hidden = reported.filter((observation) => !shows(observation));
      if (shown.length < DERIVED_HIDDEN_WHEN_MIN || hidden.length < DERIVED_HIDDEN_WHEN_MIN) continue;
      const shownValues = new Set(shown.map((observation) => valueIdentity(observation.step[key])));
      const shared = [...new Set(hidden.map((observation) => valueIdentity(observation.step[key])))]
        .filter((value) => value !== null && value !== '' && shownValues.has(value));
      if (shared.length === 0) continue;
      const candidates = keys.filter(
        (other) =>
          other !== key &&
          hidden.every((observation) => Object.hasOwn(observation.step, other)) &&
          shown.every((observation) => !Object.hasOwn(observation.step, other)),
      );
      if (candidates.length === 0) continue;
      const named = candidates.filter((other) => parseSlotID(other) === null);
      // A NAMED key first, and alone if there is exactly one: it is not step-local the way
      // a slot number is, and the standing rule of this work is that a named key beats
      // anything else describing the same fact.
      //
      // WHERE THERE IS NO NAMED CANDIDATE, condition 4 used to end the search. That was
      // right about what it was protecting — `hiddenWhen.keyPresent` had no way to address
      // a slot — and wrong to be a dead end, because the CLI reports a whole class of
      // options without naming them. `Go to Related Record`'s
      // window configuration is five unnamed values, so the animation option it suppresses
      // had no describable cause at all. The tie between those five is resolved on the same
      // ground as `presenceOnlyOptions`: keys reported in EXACTLY the same examples as each
      // other are one condition with several names, not rival explanations, and every one
      // of them suppresses the option identically. Where they are not presence-identical
      // the evidence really does disagree and this still declines.
      const identical = candidates.every((other) =>
        list.every(
          (observation) =>
            Object.hasOwn(observation.step, other) === Object.hasOwn(observation.step, candidates[0]),
        ),
      );
      const decided = named.length === 1 ? named[0] : named.length === 0 && identical ? candidates[0] : null;
      if (decided === null) {
        notes.push({
          step: name,
          kind: 'hiddenWhenDeclined',
          detail:
            `${key}: shown in ${shown.length} example(s) and hidden in ${hidden.length} with the same value, but ` +
            `${candidates.length} key(s) explain the split equally well (${candidates.join(', ')})`,
        });
        continue;
      }
      found.push({
        step: name,
        key,
        keyPresent: decided,
        derived: true,
        group: decided === candidates[0] && candidates.length > 1 ? candidates : null,
        evidence:
          `derived: ${shown.length} example(s) display it and ${hidden.length} do not, all of them holding the same ` +
          `value, and ${decided} is reported in every hidden one and in none of the shown ones` +
          (candidates.length > 1 && named.length !== 1
            ? `; ${candidates.length} keys do so identically (${candidates.join(', ')}), and this one is named first`
            : ''),
      });
    }
  }
  return { found, notes };
}

/** The callback half of ruling 3 is NOT here, and the assertion is why. I wrote it
 *  by symmetry with the script half and `assertHiddenWhen` rejected it: on
 *  `Perform Script on Server with Callback`, `callback` and `callbackByName`
 *  never appear together at all — the CLI simply stops reporting `callback` in the
 *  by-name state, so there is nothing for a suppression rule to describe. The
 *  symmetry was mine, not FileMaker's. */

/** Strength order for `attributed`, strongest first — except `presence`, which is
 *  not on the ladder at all: see `StepSegmentAttribution` in the types. A segment
 *  with no `attributed` field was anchored by its own label or value in the line. */
const ATTRIBUTION_ORDER = ['anchored', 'valueWords', 'labelWords', 'sole', 'presence', 'valueFunction'];

/** The render kinds whose displayed text is a DERIVED form of the value rather
 *  than the value itself. Injectivity is only meaningful — and only testable —
 *  here: a passthrough value is injective by construction, and `masked` is
 *  deliberately not injective (that is the point of masking). */
const DERIVED_TEXT_KINDS = new Set([
  'enum',
  'labelledEnum',
  'labelledState',
  'bareState',
  'labelledMismatch',
  'keyPresence',
]);

/** The kinds a renderer cannot produce without knowing the value's display form,
 *  so the observed value -> text mapping is recorded for them. Never `masked`.
 *  `bareState` is here because FileMaker uses two word pairs (`On`/`Off` and
 *  `Yes`/`No`) and only the data says which pair a given key uses.
 *
 *  `suffix` is here because the round-trip measured a repetition rendering as
 *  something other than itself — the empty bracket — and the report's finding was
 *  that excluding `suffix` left that measurement nowhere to live. `setMember` is
 *  NOT here: its map is keyed by set member rather than by value, so it is built
 *  by `deriveSetMemberValues` instead. */
const VALUE_MAP_KINDS = new Set([
  'enum',
  'labelledEnum',
  'labelledState',
  'bareState',
  'keyPresence',
  'suffix',
]);

/** An enum is a CODE with a display name: `resizeToFit`, `always`, `1`, `true`.
 *  Same test as the matcher's `isEnumCode`. */
const ENUM_CODE = /^([A-Za-z][A-Za-z0-9_]*|-?[0-9]+)$/;

/** And its display name is a PHRASE: words, short, no calculation punctuation.
 *  A leading `<` is allowed for FileMaker's own placeholders (`<Current Layout>`).
 *
 *  Commas and accented letters are allowed because FileMaker's own display names
 *  use them — measured: `Blank record, as formatted` and `Português (Brasil)` were
 *  both rejected by an ASCII-only, comma-free pattern, which made the filter's
 *  rejection count report five true mappings as symptoms of a false attribution.
 *  A rejection now demotes the segment, so a false rejection would demote a true
 *  fact. */
const DISPLAY_PHRASE = /^[\p{L}<][\p{L}0-9 ,'’&./()<>_-]{0,47}$/u;

/** Record a value -> text mapping only when the value looks like a code and the
 *  text like its display name.
 *
 *  This is not tidying. Every mapping the filter rejects was measured to be the
 *  symptom of a FALSE attribution — `Save Records as PDF`'s `openPassword` (a
 *  variable) "rendering" as `Automatically open`, `Truncate Table`'s
 *  `table selection: 1` as a quoted table name that is really another key's value,
 *  and `Perform Semantic Find`'s `return count: true` as a whole calculation.
 *  Keeping them would assert a false fact AND copy the owner's script content into
 *  a committed artifact. A rejection now also DEMOTES the segment to `low`
 *  (`rejectedMapping`): rejecting a mapping while keeping the fact it came from was
 *  exactly how a false attribution kept reading `measured`. */
function isDisplayMapping(value, text) {
  return ENUM_CODE.test(value) && DISPLAY_PHRASE.test(text);
}

/** The identity of a JSON value, for the two injectivity tests.
 *
 *  A LIST is excluded (null): FileMaker renders only its first entry, so two
 *  lists that differ later are not a counter-example to anything.
 *
 *  An OBJECT is stringified rather than left to `normaliseCalc`, which turned
 *  every structured value into `"[object Object]"` — that made all 8 of
 *  `New Window | style`'s distinct values look like ONE value and hid the whole
 *  class of object-valued keys from injectivity test 1. */
function valueIdentity(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return normaliseCalc(value);
}

function readSources() {
  const missing = SOURCES.filter((source) => !fs.existsSync(source.body));
  if (missing.length > 0) {
    console.error(`Missing script bodies: ${missing.map((source) => path.relative(ROOT, source.body)).join(', ')}`);
    console.error(
      'These are COMMITTED data (fm_scripts/*.adt.json), so a missing one means an incomplete\n' +
        'checkout rather than a cache to refill: `git checkout fm_scripts` restores them.\n' +
        '\n' +
        'They are only ever re-read when the DATA ITSELF grows, by hand, with read:script ONLY\n' +
        '(the file is read-only and no other op may ever be issued against it):\n' +
        // The account name is deliberately a placeholder: this plan's own constraint is
        // that the file may be named as the data's provenance and the account may not.
        '  fm --file=fmnet://localhost/Ooe --username=<your account> --keychain --prompt\n' +
        '  {"op":"read:script","id":70}\n  {"op":"read:script","id":55}',
    );
    process.exit(1);
  }
  return SOURCES.map((source) => {
    const body = JSON.parse(fs.readFileSync(source.body, 'utf8'));
    const lines = fs.readFileSync(source.text, 'utf8').split('\n');
    if (lines.at(-1) === '') lines.pop();
    return { ...source, body, lines };
  });
}

/** The name FileMaker actually printed, read off the line rather than assumed:
 *  it differs from the CLI's by case (`Set Field By Name`) and outright
 *  (`Page Setup` -> `Print Setup`). */
function observedDisplayName(step, line) {
  const cli = String(step?.step ?? '');
  if (cli && line.toLowerCase().startsWith(cli.toLowerCase())) return line.slice(0, cli.length);
  const open = line.indexOf('[');
  return (open === -1 ? line : line.slice(0, open)).trim();
}

/** Does this line render the step as `# <text>` rather than `Name [ … ]`?
 *
 *  Checked against the value of `text`, so the flag states a measured fact about
 *  this step rather than hard-coding the comment step's name. A comment carrying
 *  returns occupies more than one line, so the line holds a PREFIX of the value. */
function isCommentStyle(step, line, displayName) {
  if (bracketContent(line, displayName) !== null) return false;
  const value = normaliseCalc(step?.text);
  if (!value) return false;
  const rest = normaliseCalc(line.slice(displayName.length));
  return rest !== '' && value.startsWith(rest);
}

/** Could a leftover key own displayed content at all? Mirrors `canRender` in
 *  fm-segment-parse.mjs: a null, a structured value and a repetition (which renders
 *  inside another option) cannot be a standalone option.
 *
 *  The repetition half is IMPORTED rather than restated, because it used to be a
 *  restatement (`key === 'repetition'`) and it silently stopped mirroring the moment
 *  the matcher generalised to every ` repetition` key. A comment claiming a mirror
 *  is exactly the defect this file is built to avoid, and one import removes the
 *  possibility instead of documenting it. (Measured: on this data the generalisation
 *  changes nothing — the residual split stays 81/87/67 — so this is a latent drift
 *  closed, not a figure moved.) */
function couldRender(step, key) {
  const value = step[key];
  if (value === null || value === undefined || isRepetitionKey(key)) return false;
  return Array.isArray(value) || typeof value !== 'object';
}

/** Is this example's silence about `key` refuted by the line itself? Returns
 *  `{ reason, detail }` or null.
 *
 *  An `ignored` claim is a universal negative — FileMaker never shows this key — so
 *  an example only evidences it if the LINE shows nothing that could be the key.
 *  Three ways it can show something, in order of how directly the evidence reads.
 *  All three are conservative in the same way: they remove an OBSERVATION, which can
 *  only lower a count or empty it into `unresolved`, and can never place a key or
 *  create a segment. */
function refutedBy(match, step, key) {
  const inside = shownInsideAnotherOption(match.segments, step, key);
  if (inside) {
    return {
      reason: 'insideAnotherOption',
      detail: `its value appears inside the option for ${inside}`,
    };
  }
  const value = valueIdentity(step[key]);
  if (value === null || value === '') return null;

  // The line carries the value in content NO key claimed. Then something was
  // rendered here and we failed to attribute it, which is a different state from
  // nothing being rendered. Measured: 7 observations, and all 7 are keys FileMaker
  // plainly displays — `Show Custom Dialog`'s `input2`/`input3` and their
  // repetitions (`… ; $var[11] ; Table::Field[12] ]`), `Perform JavaScript in Web
  // Viewer`'s `arg1`/`arg2`, and `Configure Region Monitor Script`'s
  // `scriptReference` (`Script: “…” from file: “…”`). Six of the seven were found
  // by review as false `ignored` claims; the seventh this rule found on its own.
  const stretch = match.unmatched.find((text) => containsAtTokenBoundary(text, value));
  if (stretch !== undefined) {
    return {
      reason: 'inUnattributedContent',
      detail: `its value appears in content no key claimed: ${JSON.stringify(stretch.slice(0, 60))}`,
    };
  }

  // The line shows this key's value under ANOTHER key's label. Then the option
  // could be either key's — the same indistinguishability the first rule rests on —
  // so this example cannot evidence that THIS key is never shown. Restricted to
  // values that identify a key at all: a boolean's `true`/`false` and a bare enum
  // code are shared by design and say nothing about ownership, whereas a
  // calculation or a variable name is distinctive. Measured: 14 observations, and
  // the case it exists for is `Perform Semantic Find | file`, where the owner wrote
  // one calculation into five keys and FileMaker's `Vector:` option went to `text`.
  if (!identifiesAKey(step[key])) return null;
  const twin = match.segments.find(
    (segment) =>
      segment.key !== key && identifiesAKey(step[segment.key]) && valueIdentity(step[segment.key]) === value,
  );
  if (twin) {
    return {
      reason: 'displayedUnderAnotherKey',
      detail: `the same value is displayed as ${JSON.stringify(twin.label ?? twin.value)} on ${twin.key}`,
    };
  }
  return null;
}

/** Does `value` occur in `text` without being part of a longer word? A bare
 *  substring test would let a value of `1` match almost any line. */
function containsAtTokenBoundary(text, value) {
  if (value.length < 2) return false;
  const haystack = normaliseCalc(text);
  const wordish = (character) => character !== undefined && /[A-Za-z0-9_]/.test(character);
  for (let at = haystack.indexOf(value); at !== -1; at = haystack.indexOf(value, at + 1)) {
    if (!wordish(haystack[at - 1]) && !wordish(haystack[at + value.length])) return true;
  }
  return false;
}

/** Could this value tell one key from another? A boolean and a bare code cannot —
 *  many keys of one step share `false` or `1` — while a calculation, a field
 *  reference or a variable name can. */
function identifiesAKey(value) {
  if (typeof value === 'boolean') return false;
  const text = valueIdentity(value);
  return text !== null && text !== '' && !ENUM_CODE.test(text);
}

/** Did the line show this unplaced key's value inside ANOTHER option? Returns the
 *  host key, or null.
 *
 *  The evidence is the matcher's own: a segment whose text carries an appended
 *  `[X]` — recorded as `decorated`, or inside `value` when a repetition variant
 *  matched — where X is this key's value. Either the key was displayed there and
 *  only the attribution failed, or a different key holding the same value was. The
 *  two are indistinguishable from here, and both make "FileMaker never shows this
 *  key" unassertable — so this vetoes the observation rather than doubting it, and
 *  the key goes to `unresolved` rather than nowhere.
 *
 *  Measured: it fires 5 times, on `Perform Semantic Find | count` — the one
 *  `ignored` entry already known to be false (FileMaker renders `Return count:` for
 *  the pair `returnCount` + `count`). It found that independently. */
function shownInsideAnotherOption(segments, step, key) {
  const value = valueIdentity(step[key]);
  if (value === null || value === '') return null;
  for (const segment of segments) {
    const decorated = /^\[(.*)\]$/.exec(String(segment.decorated ?? ''));
    const inValue = segment.withRepetition ? /\[([^[\]]*)\]$/.exec(String(segment.value ?? '')) : null;
    const shown = decorated?.[1] ?? inValue?.[1] ?? null;
    if (shown !== null && normaliseCalc(shown) === value) return segment.key;
  }
  return null;
}

/** Which of the three unreconcilable categories this example falls into, or null
 *  when its line was fully accounted for.
 *
 *  They are NOT the same kind of gap and must never be folded together:
 *   - `opaque`: the CLI reports `{opaque, editable, reason}` and no options, so
 *     there is nothing to pair. Irreducible.
 *   - `unreported`: content is left over and no reported key could own it —
 *     FileMaker shows options the CLI never sends (`Privilege Set:`,
 *     `Specified: From list`, `Animation: None`). Rendering it is impossible, not
 *     merely unknown.
 *   - `unattributed`: content is left over next to a key that might own it, and
 *     the matcher refused to guess. Ambiguity in the data. */
function classifyResidual(step, view, match) {
  if (Object.hasOwn(step, 'opaque')) return 'opaque';
  if (match.unmatched.length === 0) return null;
  const plausible = match.ignoredKeys.filter((key) => couldRender(view, key));
  return plausible.length === 0 ? 'unreported' : 'unattributed';
}

/** The withdrawal set covering this segment, if any. Matching a SET rather than a
 *  single triple is what makes a transposition withdrawable as the pair it is; a
 *  fact may narrow itself further with `text`, for one false mapping inside an
 *  otherwise sound segment. */
function withdrawalFor(stepName, segment) {
  const group = WITHDRAWN_FACTS.find(
    (item) =>
      item.step === stepName &&
      item.facts.some(
        (fact) =>
          fact.key === segment.key &&
          fact.label === (segment.label ?? null) &&
          (fact.text === undefined || fact.text === segment.value),
      ),
  );
  if (!group) return null;
  return { step: group.step, key: segment.key, label: segment.label ?? null, reason: group.reason };
}

/** Walk every pair and collect, per step type, every placement of every key. */
function collect(sources) {
  const types = new Map();
  const failures = [];
  const unmatchedReport = [];
  const withdrawn = [];
  const opaqueDrops = [];
  const contradictedIgnores = [];
  // Every pair, kept for the presentation pass, which cannot run until the
  // labels are known and so cannot run here.
  const observations = [];
  let pairCount = 0;

  const typeOf = (name) => {
    if (!types.has(name)) {
      types.set(name, {
        name,
        examples: 0,
        displayNames: new Map(),
        commentStyleExamples: 0,
        nameUnverifiedExamples: 0,
        keys: new Map(),
        keyOf: new Map(),
        ignoredCounts: new Map(),
        omittedValues: new Map(),
        reportedCounts: new Map(),
        emptyBracketExamples: 0,
        whenAbsent: new Map(),
        // For a presence option whose deciding key is one of several reported in exactly
        // the same examples: the whole group, so the segment can say the name is arbitrary.
        presenceGroup: new Map(),
        presentation: [],
        contradictedKeys: new Set(),
        withdrawnByLabel: new Set(),
        droppedOnOpaque: new Set(),
        refutations: new Map(),
        orders: [],
        residual: { opaque: 0, unreported: 0, unattributed: 0 },
      });
    }
    return types.get(name);
  };

  for (const source of sources) {
    const aligned = alignSteps(source.body, source.lines, (name) => DISPLAY_NAME_OVERRIDES[name] ?? name);
    for (const failure of aligned.failures) failures.push({ ...failure, script: source.id });
    pairCount += aligned.pairs.length;

    for (const pair of aligned.pairs) {
      const stepName = pair.step.step;
      const entry = typeOf(stepName);
      const displayName = observedDisplayName(pair.step, pair.line);
      const match = matchSegments(pair.step, pair.line, displayName);
      // The step as the matcher saw it, with `slots` expanded into one key per
      // slot. EVERY key lookup below has to use this and not `pair.step`, or a slot
      // the matcher placed reads as a key with no value.
      const view = expandSlots(pair.step);

      entry.examples += 1;
      entry.displayNames.set(displayName, (entry.displayNames.get(displayName) ?? 0) + 1);
      if (pair.nameUnverified) entry.nameUnverifiedExamples += 1;
      if (isCommentStyle(pair.step, pair.line, displayName)) entry.commentStyleExamples += 1;

      // An opaque step's JSON is `{opaque, editable, reason}` and nothing else:
      // the CLI is telling us it could not read the options, and `reason` is its
      // own English explanation, not a displayed option. Any match against those
      // three keys is therefore false by construction — measured: `reason` shares
      // enough words with a real option to be attributed to it 3 times out of 38,
      // which would have put a CLI diagnostic in the catalog as a display form.
      const opaqueStep = Object.hasOwn(pair.step, 'opaque');
      if (opaqueStep) {
        for (const segment of match.segments) {
          opaqueDrops.push({ step: stepName, key: segment.key, script: source.id, index: pair.index + 1 });
          // A key whose only placements were dropped here would otherwise fall out
          // of BOTH lists, since `ignored` is built from observations and this key
          // has none. Remembered so it cannot vanish silently; it lands in
          // `unresolved` if it never gets a clean observation elsewhere.
          entry.droppedOnOpaque.add(segment.key);
        }
      }

      const kept = [];
      const withdrawnHere = [];
      // The offsets come back parallel to the segments; zipped here so a placement
      // and its position travel together through the rest of this loop.
      const placedSegments = opaqueStep
        ? []
        : match.segments.map((segment, at) => ({ ...segment, position: match.positions[at] }));
      for (const segment of placedSegments) {
        const withdrawal = withdrawalFor(stepName, segment);
        if (withdrawal) {
          withdrawn.push({ ...withdrawal, script: source.id, index: pair.index + 1, text: segment.value ?? null });
          withdrawnHere.push(segment);
          continue;
        }
        kept.push(segment);
        if (!entry.keys.has(segment.key)) entry.keys.set(segment.key, []);
        entry.keyOf.set(segment.key, segment.key);
        entry.keys.get(segment.key).push({
          render: segment.render,
          label: segment.label ?? null,
          suffixOf: segment.suffixOf ?? null,
          attribution: segment.attributed ?? 'anchored',
          text: segment.value ?? null,
          inlineOf: segment.inlineOf ?? null,
          value: valueIdentity(view[segment.key]),
          // FileMaker prints some options with curly quotes around the value
          // (`“noop”`); a renderer cannot reproduce that without being told.
          quoted: Boolean(segment.quoted),
          // Text that another key contributed to (a repetition appended to the
          // field it belongs to, a layout's table in parentheses). Such a text is
          // not this key's value alone, so it must not be read as this key
          // rendering two different ways — see `functionalCollisions`.
          shared: Boolean(segment.withRepetition || segment.decorated),
          // The members of a structured value, for the one kind whose display form
          // is keyed by member rather than by value.
          setMembers: isSetValue(view[segment.key]) ? view[segment.key].set : null,
          // How much of a file path FileMaker printed, as the matcher measured it
          // on this very placement. It was already computed and thrown away.
          //
          // Only counted where the forms are TELLABLE APART: a path with no scheme
          // and no directory prints the same whichever rule applies, so reading it
          // as evidence for the verbatim rule would manufacture a disagreement out
          // of a value that cannot distinguish them.
          pathForm:
            segment.listFirst && pathIsDistinguishable(view[segment.key])
              ? (segment.derivedFrom ?? 'verbatim')
              : null,
          listFirst: Boolean(segment.listFirst),
          // Does the owner's ruling — print the file name and nothing else — hold on
          // THIS placement? Recorded per placement so the general rule is verified
          // against every file option rather than assumed from the two keys whose
          // values happen to carry a directory.
          fileNameAgrees: segment.listFirst
            ? fileNameForm(view[segment.key]) === unquote(segment.value)
            : null,
          // The whole step, so a later pass can ask what ANOTHER key held in this
          // example. A reference, not a copy: `deriveConditionalLabel` needs the
          // deciding key's value and nothing else here does.
          example: view,
          script: source.id,
          index: pair.index + 1,
        });
      }

      const order = [];
      const positions = [];
      for (const segment of kept) {
        if (order.includes(segment.key)) continue;
        order.push(segment.key);
        positions.push(segment.position ?? 0);
      }
      const orderEntry = { order, positions, size: kept.length, script: source.id, index: pair.index + 1 };
      entry.orders.push(orderEntry);

      for (const key of displayKeys(pair.step)) {
        entry.reportedCounts.set(key, (entry.reportedCounts.get(key) ?? 0) + 1);
      }
      // `ignoredKeys` means "the matcher placed nothing for this key", and the
      // catalog turns that into "FileMaker never shows it". An example only
      // evidences that if the LINE shows nothing for the key — so each observation
      // is put to `refutedBy` first, and a refuted one is not counted at all.
      //
      // This loop is the ONLY place `ignoredCounts` grows. It used to be one of two:
      // an opaque step also counted every key here AND in the opaque block above,
      // and once this count was published as `examples` that double count became a
      // false measurement — `Import Records | opaque` read 76 examples of a
      // 38-example step. One accumulation path, and an assertion that no count can
      // exceed its entry's `derivedFrom`, is the fix for the class.
      for (const key of match.ignoredKeys) {
        const refutation = refutedBy(match, view, key);
        if (refutation) {
          contradictedIgnores.push({
            step: stepName,
            key,
            script: source.id,
            index: pair.index + 1,
            ...refutation,
          });
          entry.contradictedKeys.add(key);
          if (!entry.refutations.has(key)) entry.refutations.set(key, []);
          entry.refutations.get(key).push(refutation.reason);
          continue;
        }
        entry.ignoredCounts.set(key, (entry.ignoredCounts.get(key) ?? 0) + 1);
        rememberOmittedValue(entry, key, view[key], match);
      }
      // A withdrawn placement leaves its key displayed nowhere in THIS example, so
      // the value it carried is an omission observation too — and it is the only
      // route by which `Go to Layout | target`'s two calculated-layout values can
      // be seen not to print, since a withdrawn key is in neither `segments` nor
      // `ignoredKeys`.
      for (const segment of withdrawnHere) {
        rememberOmittedValue(entry, segment.key, view[segment.key], match);
      }

      // A withdrawn fact leaves displayed content unaccounted for, exactly like a
      // stretch the matcher declined to attribute. Counting it keeps the entry's
      // residual honest instead of letting a withdrawal look like a clean example.
      observations.push({
        name: stepName,
        step: view,
        raw: pair.step,
        line: pair.line,
        displayName,
        match,
        kept,
        withdrawnHere,
        orderEntry,
        opaqueStep,
        script: source.id,
        index: pair.index + 1,
      });

      const residual = classifyResidual(pair.step, view, match) ?? (withdrawnHere.length > 0 ? 'unattributed' : null);
      if (residual) entry.residual[residual] += 1;
      for (const text of match.unmatched) {
        unmatchedReport.push({
          step: stepName,
          script: source.id,
          index: pair.index + 1,
          cause: residual ?? 'unattributed',
          text,
          leftoverKeys: match.ignoredKeys.filter((key) => couldRender(view, key)),
        });
      }
    }
  }

  return {
    types,
    failures,
    unmatchedReport,
    withdrawn,
    opaqueDrops,
    contradictedIgnores,
    observations,
    pairCount,
  };
}

/** The first entry of a list, as the CLI reports it. */
function firstEntry(value) {
  if (!Array.isArray(value)) return null;
  const first = value.find((entry) => entry !== null && entry !== undefined && typeof entry !== 'object');
  return first === undefined ? null : normaliseCalc(first);
}

/** Does this list's first entry print differently under the three file-path rules
 *  the matcher can see? Only a scheme or a directory separator tells them apart. */
function pathIsDistinguishable(value) {
  const text = firstEntry(value);
  if (text === null) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) || text.includes('/');
}

/** The owner's rule for a file option, applied: drop the scheme, then drop every
 *  directory. "FM does not print the prefix." */
function fileNameForm(value) {
  const text = firstEntry(value);
  if (text === null) return null;
  const noScheme = text.replace(/^[A-Za-z][A-Za-z0-9+.-]*:/, '');
  return noScheme.includes('/') ? noScheme.slice(noScheme.lastIndexOf('/') + 1) : noScheme;
}

/** FileMaker's curly quotes off a rendered value, so a quoted and an unquoted
 *  placement can be compared against the same rule. */
function unquote(text) {
  return String(text ?? '').replace(/^“(.*)”$/, '$1');
}

/** Note that this example reported `key` and FileMaker displayed nothing for it.
 *
 *  Only a scalar is remembered: a null cannot be printed, and a structured value
 *  or a list is not a value a renderer could compare against.
 *
 *  A BOOLEAN is excluded, and the reason is a ruling rather than tidiness.
 *  Including booleans suppresses the option on `Go to Record/Request/Page | with
 *  dialog`: FileMaker prints `With dialog: Off` for false and nothing for true, so
 *  `true` would be recorded as a value that never prints and we would stop
 *  printing `With dialog: On`. That is ruling 10, which the owner answered "I'm ok
 *  with how we do it", so suppressing it would be overriding him with a derivation.
 *  `bareWhenTrue`, `bareState` and `labelledState` already say what each polarity
 *  does, and a boolean that renders nothing against its kind still surfaces as a
 *  `renderDisagreement`. */
function rememberOmittedValue(entry, key, value, match) {
  // THE GUARD THAT MAKES THIS CLAIM HONEST. "FileMaker printed nothing for this
  // key" is only readable off an example whose line is FULLY accounted for. Where
  // any stretch went unexplained, the alternative reading — that FileMaker printed
  // the option and the matcher failed to attribute it — is live, and it is the
  // reading that turned out to be right: without this, `Insert File | storage`
  // recorded two values as never printed while FileMaker was printing both, and the
  // renderer went from showing the wrong text to showing nothing.
  if (match.unmatched.length > 0) return;
  const text = valueIdentity(value);
  if (text === null || text === '' || typeof value === 'object' || typeof value === 'boolean') return;
  if (!entry.omittedValues.has(key)) entry.omittedValues.set(key, new Map());
  const seen = entry.omittedValues.get(key);
  seen.set(text, (seen.get(text) ?? 0) + 1);
}

/** Option-shaped leftover text: a label, a colon, and the rest. The matcher's own
 *  `OPTION_LABEL` in the same shape — restated rather than exported because this
 *  pass reads the stretches the matcher could NOT place, which is a different job
 *  from placing them. */
const LEFTOVER_OPTION = /^([A-Za-z][A-Za-z0-9 '/&.()-]{0,38}):\s*(.*)$/;

/** Every option in this example that no key owns, as `{label, text, start}`.
 *
 *  Two sources, and the second is the point: a WITHDRAWN placement is displayed
 *  content whose attribution was false, so it is available here exactly like a
 *  stretch nobody claimed. Without it, `Go to Layout`'s `Animation: None` would
 *  have been withdrawn from `target` and then vanished, instead of being
 *  recognised as what it is — the absent-key form of `animation`. */
function leftoverOptions(observation) {
  const out = [];
  for (const gap of observation.match.unmatchedAt ?? []) {
    let at = 0;
    for (const piece of gap.text.split(';')) {
      const start = gap.start + at;
      at += piece.length + 1;
      const text = piece.trim();
      if (text === '') continue;
      const parsed = LEFTOVER_OPTION.exec(text);
      out.push(
        parsed
          ? { label: parsed[1].trim(), text: parsed[2].trim(), start }
          : { label: null, text, start },
      );
    }
  }
  for (const segment of observation.withdrawnHere) {
    out.push({ label: segment.label ?? null, text: segment.value ?? '', start: segment.position ?? 0 });
  }
  return out;
}

/** Every option slot in this line that FileMaker printed with NO label and NO text,
 *  as `{label: null, text: '', start}` — the same shape `leftoverOptions` returns.
 *
 *  Read off the bracket content rather than off the matcher's leftover stretches,
 *  because the matcher drops an empty piece: measured, 0 of the 1203 examples produce
 *  one through that route, while four step types print one on the line.
 *
 *  THE SPLIT IS GUARDED, because cutting on `;` is what shreds a calculation. A
 *  calculation containing `;` can produce an empty piece that is not a slot at all
 *  (`Case ( a ; ; b )`), so the whole line is refused unless every piece closes its own
 *  brackets — the same guard the matcher's `splitLeftover` applies for the same reason. */
function unlabelledEmptySlots(content) {
  if (typeof content !== 'string' || content === '' || !content.includes(';')) return [];
  const pieces = [];
  let at = 0;
  for (const raw of content.split(';')) {
    const start = at;
    at += raw.length + 1;
    if (!bracketsBalanced(raw)) return [];
    if (raw.trim() === '') pieces.push({ label: null, text: '', start });
  }
  return pieces;
}

/** Does every `(` and `[` in this text close inside it? `splitLeftover`'s own guard,
 *  restated here rather than exported, because this pass reads a different string. */
function bracketsBalanced(text) {
  const closes = { ')': '(', ']': '[' };
  const open = [];
  for (const character of text) {
    if (character === '(' || character === '[') open.push(character);
    else if (closes[character] && open.pop() !== closes[character]) return false;
  }
  return open.length === 0;
}

/** The label each key was observed under, so this pass can tell an option that
 *  belongs to a known key from one that belongs to no key at all.
 *
 *  Provisional in the sense that the segment derivation picks ONE label per key by
 *  frequency and this keeps every label a key was ever seen with — deliberately,
 *  because the purpose here is to REFUSE to attribute an option whose label any
 *  key has ever taken. */
function labelOwnersOf(entry) {
  const owners = new Map();
  for (const [key, placements] of entry.keys) {
    for (const placement of placements) {
      if (!placement.label) continue;
      const id = placement.label.toLowerCase();
      if (!owners.has(id)) owners.set(id, new Set());
      owners.get(id).add(key);
    }
  }
  return owners;
}

/** THE SECOND PASS, and the one the catalog was missing: what FileMaker prints
 *  that is not a function of a key's VALUE.
 *
 *  It cannot run inside `collect`, because every judgement here needs the labels,
 *  and the labels are an aggregate over all of a step type's examples. It runs
 *  before the order is derived, because one of the things it finds is an option
 *  that has to be ORDERED against the ones keys own.
 *
 *  Three measurements, each returning notes for whatever it declined:
 *
 *   1. `emptyBrackets` — the step prints `[]` when no option renders.
 *   2. `whenAbsent`    — what an option shows when the CLI omits its key. Recorded
 *      only when every absent example agrees, OR when one bit of the CLI's `flags`
 *      word says which absent examples show it: FileMaker's broken-reference
 *      placeholder is not a default and that bit is the only thing that reports it.
 *   3. `keyPresence`   — an option whose text is a function of WHICH keys are
 *      reported. Recorded only when exactly one reported key predicts it and
 *      every example shows the option, so a coincidence needs a second key to be
 *      wrong in the same direction in every example before it can be recorded.
 *   4. `valueFunction` — an option whose text is a function of one key's VALUE,
 *      where the line carries neither the key's name nor its value. This is the
 *      only route to `Add Account`'s `Authenticate via`, and it is the generalised
 *      form of 3 (presence being the degenerate case), so 3 is tried first. */
function measurePresentation(collected) {
  const notes = [];
  const byName = new Map();
  const pendingFlagged = [];
  for (const observation of collected.observations) {
    if (!byName.has(observation.name)) byName.set(observation.name, []);
    byName.get(observation.name).push(observation);
  }

  for (const [name, entry] of collected.types) {
    // An opaque step's three keys are the CLI's own metadata, so nothing about
    // its line can evidence a display rule.
    const examples = (byName.get(name) ?? []).filter((observation) => !observation.opaqueStep);
    const labelOwners = labelOwnersOf(entry);

    let noBracket = 0;
    const slots = new Map();
    const unowned = new Map();
    // Options whose PLACEMENT is settled and whose TEXT is not: see `valueDisplayForms`.
    const labelledForms = [];
    const bareForms = [];
    for (const observation of examples) {
      const content = bracketContent(observation.line, observation.displayName);
      if (content === '') entry.emptyBracketExamples += 1;
      if (content === null) noBracket += 1;

      const claimed = new Set(observation.match.segments.map((segment) => segment.key));
      for (const option of leftoverOptions(observation)) {
        if (option.label === null) continue;
        for (const owner of labelOwners.get(option.label.toLowerCase()) ?? []) claimed.add(owner);
      }
      for (const option of unlabelledEmptySlots(content)) {
        // AN EMPTY OPTION SLOT WITH NO LABEL AT ALL: `Get File Exists [ ; Target: ]`,
        // where FileMaker prints the file option as an empty slot. It carries no label
        // to say which key it is and no text to match a value against, so the only
        // thing that can identify it is counting — the sole key of this step type that
        // is ABSENT here, could render an option of its own, and is not already
        // accounted for by something else on this line. More than one candidate
        // declines rather than guessing, exactly as the placeholder route does.
        //
        // Invisible to `leftoverOptions`: the matcher's own leftover splitter drops an
        // empty piece (measured: 0 of 1203 examples yield one), so this reads the
        // bracket content directly.
        const candidates = [...entry.keys.keys()].filter(
          (id) =>
            !isRepetitionKey(id) &&
            !claimed.has(id) &&
            !Object.hasOwn(observation.step, id) &&
            entry.keys.get(id).some((placement) => placement.render !== 'suffix'),
        );
        if (candidates.length !== 1) {
          notes.push({
            step: name,
            kind: 'emptySlotDeclined',
            detail:
              `an empty option slot at offset ${option.start} has ${candidates.length} candidate key(s)` +
              `${candidates.length > 1 ? ` (${candidates.join(', ')})` : ''}, so nothing says which option it is`,
          });
          continue;
        }
        const key = candidates[0];
        claimed.add(key);
        if (!slots.has(key)) slots.set(key, []);
        slots.get(key).push({ ...option, observation });
      }

      for (const option of leftoverOptions(observation)) {
        // AN UNLABELLED PLACEHOLDER. `Go to Field [ <Table Missing> ]` prints
        // FileMaker's own broken-reference placeholder with no label at all, so the
        // labelled route below cannot reach it and the previous round reported it as
        // unfixable. A label is normally the only thing that can say which key a
        // slot belongs to — but a `<…>` phrase is FileMaker's, not the owner's, and
        // it can only stand for a reference, so the sole absent key that renders an
        // option of its own identifies it. More than one candidate declines.
        if (option.label === null) {
          // Not a placeholder and not empty: an option with no label whose text is
          // FileMaker's word for some reported value. It cannot be anchored — there is
          // no label to anchor it — so it is held for the cross-example pass below,
          // which is the only thing that can say which key's value predicts it.
          if (!PLACEHOLDER_PHRASE.test(option.text)) {
            if (option.text !== '') bareForms.push({ ...option, observation });
            continue;
          }
          const candidates = [...entry.keys.keys()].filter(
            (id) =>
              !isRepetitionKey(id) &&
              !Object.hasOwn(observation.step, id) &&
              entry.keys.get(id).some((placement) => placement.render !== 'suffix'),
          );
          if (candidates.length !== 1) {
            notes.push({
              step: name,
              kind: 'unlabelledPlaceholderDeclined',
              detail:
                `${JSON.stringify(option.text)} has ${candidates.length} candidate key(s)` +
                `${candidates.length > 1 ? ` (${candidates.join(', ')})` : ''}, so nothing says which option it is`,
            });
            continue;
          }
          const key = candidates[0];
          if (!slots.has(key)) slots.set(key, []);
          slots.get(key).push({ ...option, observation });
          continue;
        }
        const owners = labelOwners.get(option.label.toLowerCase());
        if (owners === undefined) {
          if (!unowned.has(option.label)) unowned.set(option.label, []);
          unowned.get(option.label).push({ ...option, observation });
          continue;
        }
        // A label two keys have taken cannot say which key's option this is —
        // the same indistinguishability the `ignored` refutation rules rest on.
        if (owners.size !== 1) continue;
        const key = [...owners][0];
        // The key IS reported here, so this is a second option under one label, not the
        // form the option takes when the key is missing. It is ANCHORED all the same:
        // FileMaker printed this option under a label exactly one key of this step type
        // is ever seen with, and that key has a value here. So the only thing unexplained
        // is the value's display form, and that is what `labelledForms` is collected for.
        if (Object.hasOwn(observation.step, key)) {
          labelledForms.push({ ...option, observation, key });
          continue;
        }
        if (!slots.has(key)) slots.set(key, []);
        slots.get(key).push({ ...option, observation });
      }
    }
    if (entry.emptyBracketExamples > 0 && noBracket > 0) {
      notes.push({
        step: name,
        kind: 'emptyBracketDisagreement',
        detail: `${entry.emptyBracketExamples} example(s) print empty brackets and ${noBracket} print no bracket at all; taking the brackets`,
      });
    }

    for (const [key, occurrences] of slots) {
      const absentExamples = examples.filter((observation) => !Object.hasOwn(observation.step, key));
      const absent = absentExamples.length;
      // ONE KEY RENDERS AT MOST ONE OPTION PER LINE, so two slots in one example cannot
      // both be this key's and nothing here says which is. `Perform Script on Server with
      // Callback` prints `Parameter:` TWICE — once for the script and once for the
      // callback script — and both carry the only label either has, so counting them as
      // this key's evidence claimed ten observations from five examples. The invariant
      // `examples <= derivedFrom` caught it; this is the cause rather than the symptom.
      const perExample = countBy(occurrences, (item) => item.observation);
      if ([...perExample.values()].some((count) => count > 1)) {
        notes.push({
          step: name,
          kind: 'whenAbsentDeclined',
          detail:
            `${key}: an example shows ${Math.max(...perExample.values())} slots that this key's own label ` +
            'could own, and one key renders at most one option, so nothing says which is its',
        });
        continue;
      }
      const texts = countBy(occurrences, (item) => item.text);
      const seen = occurrences.length;
      // Every example that omits the key must show the same thing — or one bit of
      // `flags` must say which of them do. Both readings are needed, because the
      // corpus contains both: an absent `animation` shows `None` on every example
      // (a default), while an absent field shows `<Table Missing>` on SOME (a broken
      // reference, and a different fact). Reading the second as a default would make
      // us print the placeholder for every step with no field.
      //
      // THE ONE EXCEPTION, AND IT IS THE OWNER'S RULING, NOT A LOOSENING WE CHOSE. Asked
      // whether FileMaker prints the label of an option it has no value for, he answered:
      //
      //   > "FM is inconsistent here but often does print an option with no value set. So
      //   > we should."
      //
      // So an EMPTY slot needs no unanimity and no bit: where any example that omits the
      // key shows one, we print one. Note the shape of the ruling — he grants that
      // FileMaker is inconsistent and instructs us to print anyway, which is his general
      // principle a third time ("we should not omit options"; "any weAddAnOption is not a
      // problem"). It costs exactly what he authorised: two steps where FileMaker prints
      // no slot now carry one, and they move from exact to settled-by-his-ruling.
      //
      // It is deliberately NOT extended to a placeholder phrase. `<Table Missing>` is a
      // claim that a reference is broken, and printing it on a step that simply has no
      // field would be inventing one — so that text keeps the unanimity-or-one-bit rule.
      const showing = new Set(occurrences.map((item) => item.observation));
      const emptySlotRuling = texts.size === 1 && [...texts.keys()][0] === '';
      const bits =
        texts.size === 1 && seen < absent && !emptySlotRuling
          ? separatingFlagBits(
              absentExamples.filter((observation) => showing.has(observation)),
              absentExamples.filter((observation) => !showing.has(observation)),
            )
          : [];
      if (texts.size > 1 || (seen !== absent && bits.length === 0 && !emptySlotRuling)) {
        notes.push({
          step: name,
          kind: 'whenAbsentDeclined',
          detail:
            `${key}: ${seen} of ${absent} example(s) that omit the key show a slot for it` +
            `${texts.size > 1 ? `, and they disagree (${[...texts.keys()].map((text) => JSON.stringify(text)).join(' / ')})` : ', and no bit of `flags` separates them'}`,
        });
        continue;
      }
      const text = [...texts.keys()][0];
      // An empty slot, or one of FileMaker's own placeholder phrases. Anything else
      // would be content, and content cannot belong to a key the CLI did not report
      // — so a text that is neither is a sign this pass has attributed something
      // wrongly, and it declines instead of committing it.
      if (text !== '' && !DISPLAY_PHRASE.test(text)) {
        notes.push({
          step: name,
          kind: 'whenAbsentDeclined',
          detail: `${key}: its absent-key text is not an empty slot or a display phrase`,
        });
        continue;
      }
      entry.whenAbsent.set(key, { text, examples: seen });
      // A bit is NOT adopted from this step type alone: the candidates go into one
      // pile and are resolved after every step type has contributed, because only the
      // intersection over all of them is one bit. Measured: `Insert Text | target`
      // offers two bits on its own evidence and `Go to Field | field` offers one, and
      // the one is inside the two.
      if (bits.length > 0) pendingFlagged.push({ step: name, entry, key, text, seen, absent, bits });
      // An absent-key slot has a POSITION, and that is order evidence the derivation
      // would otherwise throw away. It is the only evidence there is for a pair of
      // keys that never appear together with values: `Perform Script` reports
      // `parameter` in one example and `scriptName` in another, never both, so
      // without the empty `Parameter:` slot's position the two are ordered
      // alphabetically — and FileMaker puts them the other way round.
      for (const item of occurrences) spliceIntoOrder(item.observation.orderEntry, key, item.start);
    }

    for (const [label, occurrences] of unowned) {
      // Presence first: it is the degenerate case of the value function (one text
      // for every present state), and where it holds it is the stronger reading —
      // the deciding key's value there is a calculation the line never shows.
      const byPresence = keyPresenceFact(name, label, occurrences, examples, notes);
      if (byPresence) {
        adoptKeyPresence(entry, byPresence);
        continue;
      }
      const byValue = valueEnumFact(name, entry, label, occurrences, examples, notes);
      if (byValue) {
        adoptValueEnum(entry, byValue);
        continue;
      }
      const byEquality = valueAnchoredFact(name, entry, label, occurrences, examples, notes);
      if (byEquality) adoptValueAnchored(entry, byEquality);
    }

    const formed = valueDisplayForms(name, entry, examples, labelledForms, bareForms, notes);
    presenceOnlyOptions(name, entry, examples, bareForms.filter((option) => !formed.has(option)), notes);
  }
  resolveFlaggedAbsent(pendingFlagged, notes);
  return notes;
}

/** ONE VALUE'S DISPLAY FORM, on a key whose option is already placed.
 *
 *  The gap this closes, and why the per-example matcher cannot: FileMaker's word for a
 *  value sometimes shares no word with the value or the key, so nothing inside a single
 *  example connects them. `Insert File` reports `storage: "embedOnly"` and FileMaker
 *  writes `Insert`; `Set Zoom Level` reports `zoom: "zoomIn"` and writes `Zoom In`;
 *  `Configure Region Monitor Script` reports `monitor: "geoLocation"` and writes
 *  `Geofence`. The matcher ranks on shared words and then on counting, and counting
 *  cannot reach these — `Insert File` has three unplaced keys left over — so the option
 *  went unattributed and the catalog rendered nothing or the raw code.
 *
 *  This is NOT a new placement. In both routes the option is already known to be this
 *  key's, and the only thing derived is the TEXT for one value:
 *
 *   - `labelledForms` is ANCHORED. FileMaker printed the option under a label exactly one
 *     key of this step type is ever seen with, and that key has a value here. At most one
 *     such option per key per example, or nothing says which is which.
 *   - `bareForms` has no label to anchor, so the key is found the way `valueEnumFact`
 *     finds one: the text must appear in EVERY example where the key holds this value and
 *     in NO example where it holds another or is absent, and exactly one key may satisfy
 *     that. Both directions, because one of them alone is satisfied by a coincidence.
 *
 *  Two guards, and they are the same two that keep the rest of this file honest:
 *  `isDisplayMapping` demands a CODE paired with a display PHRASE, which is what keeps a
 *  calculation and the owner's own schema out of the emitted mapping by construction; and
 *  a value that ALREADY has an observed text is left alone, so this can only fill a hole
 *  and never overwrite a measurement or hide a `valueCollision`. */
function valueDisplayForms(step, entry, examples, labelledForms, bareForms, notes) {
  const decline = (why) => notes.push({ step, kind: 'valueFormDeclined', detail: why });
  // What the examples already say a value renders as, so a hole can be told from a
  // disagreement. Keyed `${key}\u0000${value}`.
  const known = new Set();
  for (const [key, placements] of entry.keys) {
    for (const placement of placements) {
      if (placement.value !== null) known.add(`${key}\u0000${placement.value}`);
    }
  }

  const taken = new Set();
  const adopt = (key, option, attribution) => {
    const value = valueIdentity(option.observation.step[key]);
    if (value === null || value === '') return;
    if (known.has(`${key}\u0000${value}`)) return;
    if (!isDisplayMapping(value, option.text)) {
      decline(`${key}: ${JSON.stringify(option.text)} is not a display form of a code`);
      return;
    }
    const shape = entry.keys.get(key)?.[0];
    if (!shape) return;
    // A FACT HAND REVIEW HAS DISPROVED MUST NOT COME BACK IN BY A NEW ROUTE. A withdrawal
    // removes a placement, and this pass makes placements, so without the check it
    // re-created `Move/Resize Window | target: byName -> "Current file"` — a mapping
    // withdrawn precisely BECAUSE `Current file` is a separate option the CLI does not
    // report at all. Found by diffing the catalog, not by reasoning about it, which is why
    // the check is in the code rather than in a reader's head.
    if (withdrawalFor(step, { key, label: shape.label, value: option.text })) {
      decline(`${key}: ${JSON.stringify(option.text)} is a withdrawn fact and is not re-adopted`);
      return;
    }
    known.add(`${key}\u0000${value}`);
    taken.add(option);
    entry.keys.get(key).push({
      render: shape.render,
      label: shape.label,
      suffixOf: null,
      inlineOf: null,
      attribution,
      text: option.text,
      value,
      quoted: false,
      shared: false,
      pathForm: null,
      displayForm: true,
      example: option.observation.step,
      script: option.observation.script,
      index: option.observation.index,
    });
    spliceIntoOrder(option.observation.orderEntry, key, option.start);
  };

  const perKeyPerExample = new Map();
  for (const option of labelledForms) {
    const id = `${option.key}\u0000${option.observation.index}`;
    perKeyPerExample.set(id, (perKeyPerExample.get(id) ?? 0) + 1);
  }
  for (const option of labelledForms) {
    if (perKeyPerExample.get(`${option.key}\u0000${option.observation.index}`) > 1) {
      decline(`${option.key}: one example shows two options under its label, so neither is attributable`);
      continue;
    }
    adopt(option.key, option, 'anchored');
  }

  // Grouped by text: one word FileMaker prints is one fact, however many examples show
  // it, and the test below is about the whole set of examples rather than about any one.
  const byText = new Map();
  for (const option of bareForms) {
    if (!byText.has(option.text)) byText.set(option.text, []);
    byText.get(option.text).push(option);
  }
  for (const [text, options] of byText) {
    const candidates = [];
    for (const [key, placements] of entry.keys) {
      // Only a key whose own option carries NO label can own an option with none, and a
      // slot's numbering follows the step's state, so it correlates with whatever that
      // state changes and explains nothing — the reason `valueEnumFact` excludes one too.
      if (parseSlotID(key) !== null || isRepetitionKey(key)) continue;
      if (!placements.every((placement) => placement.label === null)) continue;
      const values = new Set(
        options.map((option) => valueIdentity(option.observation.step[key])).filter((value) => value !== null),
      );
      if (values.size !== 1) continue;
      const value = [...values][0];
      if (value === '') continue;
      const shows = new Set(options.map((option) => option.observation));
      const functional = examples.every((observation) => {
        const here = Object.hasOwn(observation.step, key)
          ? valueIdentity(observation.step[key])
          : null;
        return (here === value) === shows.has(observation);
      });
      if (functional) candidates.push({ key, value });
    }
    if (candidates.length !== 1) {
      decline(
        `${JSON.stringify(text)} has ${candidates.length} key(s) whose value predicts it` +
          `${candidates.length > 1 ? ` (${candidates.map((item) => item.key).join(', ')})` : ''}`,
      );
      continue;
    }
    for (const option of options) adopt(candidates[0].key, option, 'valueFunction');
  }
  return taken;
}


/** FileMaker's own placeholder for something it cannot resolve: a phrase in angle
 *  brackets (`<Table Missing>`, `<unknown>`, `<Current Layout>`). Never the owner's
 *  content — FileMaker writes it — which is what makes it safe to attribute without
 *  a label. */
const PLACEHOLDER_PHRASE = /^<[^<>]+>$/;

/** The bits of `flags` set in every one of `showing` and clear in every one of
 *  `silent`. Bits 0-30 only: `flags` is reported as a JavaScript number and the sign
 *  bit of a 32-bit word is not something this corpus can speak to.
 *
 *  Returns every bit that separates them, not a choice between them — the choice
 *  needs the whole corpus and is made in `resolveFlaggedAbsent`. */
function separatingFlagBits(showing, silent) {
  if (showing.length === 0) return [];
  const flagsOf = (observation) => Number(observation.step.flags ?? 0);
  const bits = [];
  for (let bit = 0; bit < 31; bit += 1) {
    const mask = 1 << bit;
    if (!showing.every((observation) => (flagsOf(observation) & mask) !== 0)) continue;
    if (!silent.every((observation) => (flagsOf(observation) & mask) === 0)) continue;
    bits.push(mask);
  }
  return bits;
}

/** Decide the one bit, or adopt none.
 *
 *  THE CATALOG READS EXACTLY ONE BIT OF `flags`, and this is the whole of the
 *  reasoning for it. `flags` is the CLI's packed option word and decoding it per
 *  step type from 1203 examples is a different derivation with a different risk
 *  profile — which is why the previous round declined. What makes this one bit
 *  different is that a SINGLE bit explains every broken reference in the corpus at
 *  once, across unrelated step types: it is one fact with several independent
 *  confirmations, not one fitted parameter per step.
 *
 *  So the bit is adopted only if the intersection of every step type's candidate
 *  bits has exactly one member. If two step types disagree, or one of them cannot
 *  narrow it, nothing is adopted and the whole finding is reported as unproven —
 *  the safe direction, since a wrong bit prints a placeholder on a step that has
 *  none. */
function resolveFlaggedAbsent(pending, notes) {
  // GROUPED BY THE TEXT, not pooled. The claim is about one displayed thing —
  // "this is what a broken reference looks like" — so only the keys showing that
  // same text can corroborate each other. Pooled, the empty option slot's keys sat
  // beside the placeholder's, the intersection was empty and the whole finding was
  // declined for a reason that had nothing to do with it.
  const groups = new Map();
  for (const item of pending) {
    if (!groups.has(item.text)) groups.set(item.text, []);
    groups.get(item.text).push(item);
  }
  for (const [text, items] of groups) {
    let shared = new Set(items[0].bits);
    for (const item of items) shared = new Set(item.bits.filter((bit) => shared.has(bit)));
    const where = items.map((item) => `${item.step} | ${item.key}`).join('; ');
    if (shared.size !== 1) {
      for (const item of items) item.entry.whenAbsent.delete(item.key);
      notes.push({
        step: items[0].step,
        kind: 'flaggedAbsentDeclined',
        detail:
          `${JSON.stringify(text)}: ${shared.size} bit(s) of \`flags\` separate the examples that show it from those ` +
          `that do not, across ${items.length} key(s) (${where}); exactly one bit is required, so none is adopted`,
      });
      continue;
    }
    const bit = [...shared][0];
    for (const item of items) {
      item.entry.whenAbsent.set(item.key, { text: item.text, examples: item.seen, flagBit: bit });
    }
    notes.push({
      step: items[0].step,
      kind: 'flaggedAbsentAdopted',
      detail:
        `${JSON.stringify(text)}: bit 0x${bit.toString(16)} of \`flags\` is the only bit that, in EVERY one of ` +
        `${items.length} key(s) (${where}), is set in the absent-key examples showing it and clear in those showing none`,
    });
  }
}

/** Is this unowned option's text a function of exactly one key's VALUE?
 *
 *  The generalisation of `keyPresenceFact`, and the only thing that can place
 *  `Add Account`'s `Authenticate via`: the CLI reports a numeric account type, the
 *  line shows a phrase, and nothing connects them except that the value predicts the
 *  phrase in all eleven examples. The owner ruled this derivable and it is — but
 *  "one key's value happens to predict this text" is also what a coincidence looks
 *  like, so the conditions are the presence version's plus two:
 *
 *   - every PRESENT state must be a code paired with a display phrase. A calculation
 *     predicting a display phrase is not a rule FileMaker has, and this is also what
 *     keeps the owner's calculations out of the emitted mapping by construction.
 *   - the absent state, if any, must show ONE text, which becomes `whenAbsent`.
 *   - the key must own no other option. A key that already renders one of its own is
 *     the `keyPresence` shape (two options, one key) and this is not evidence for it:
 *     without this condition the placements double-count and the run trips the
 *     invariant that no fact may rest on more examples than its step type has —
 *     which is how the condition was found. */
function valueEnumFact(step, entry, label, occurrences, examples, notes) {
  const decline = (why) => {
    notes.push({ step, kind: 'valueEnumDeclined', detail: `${label}: ${why}` });
    return null;
  };
  if (occurrences.length !== examples.length) {
    return decline(`shown in ${occurrences.length} of ${examples.length} example(s), so no rule covers them all`);
  }
  if (new Set(occurrences.map((item) => item.observation)).size !== occurrences.length) {
    return decline('shown more than once in one example');
  }
  if (!occurrences.every((item) => DISPLAY_PHRASE.test(item.text))) {
    return decline('at least one of its texts is not a display phrase');
  }

  const candidates = new Set();
  for (const observation of examples) for (const key of displayKeys(observation.step)) candidates.add(key);
  const passing = [];
  for (const key of [...candidates].sort()) {
    // A slot is excluded here for the reason it is excluded from `keyPresenceFact`:
    // the CLI's slot numbering follows the step's own state, so it correlates with
    // whatever that state changes and explains none of it.
    if (entry.keys.has(key) || parseSlotID(key) !== null) continue;
    const byState = new Map();
    let usable = true;
    for (const item of occurrences) {
      const present = Object.hasOwn(item.observation.step, key);
      const state = present ? valueIdentity(item.observation.step[key]) : ABSENT_STATE;
      if (state === null || state === '') {
        usable = false;
        break;
      }
      if (present && !isDisplayMapping(state, item.text)) {
        usable = false;
        break;
      }
      if (!byState.has(state)) byState.set(state, new Set());
      byState.get(state).add(item.text);
    }
    if (!usable || byState.size < 2) continue;
    if ([...byState.values()].some((texts) => texts.size > 1)) continue;
    passing.push({ key, byState });
  }
  if (passing.length === 0) return decline("no reported key's value predicts its text");
  if (passing.length > 1) {
    return decline(
      `${passing.length} keys predict its text equally well (${passing.map((item) => item.key).join(', ')})`,
    );
  }
  return { label, occurrences, ...passing[0] };
}

/** Is this unowned option simply printing one reported key's VALUE under a label?
 *
 *  The strongest evidence class in this file — the line carries the key's own value — and
 *  the last one tried, because it only arises where the label points somewhere else.
 *  Measured on `Perform Semantic Find`: FileMaker writes `Return count: <calc>`, the label
 *  spells the boolean switch `returnCount`, and the TEXT is the value of a second key,
 *  `count`. The matcher anchors on the label, takes the option for the switch, and the
 *  calculation it holds is then no display form of `true` — so the mapping is rejected, the
 *  segment renders nothing, and `count` reads as a key FileMaker never shows.
 *
 *  Three conditions, and the second is what makes value equality mean anything in this
 *  corpus: the owner writes the SAME calculation into every key of a step, so a text
 *  equals several keys' values at once.
 *
 *   1. the key owns no option of its own. A key that does is already placed, and this
 *      would be claiming its option twice — the shape the owner rejected in ruling 7.
 *   2. the option must appear in EXACTLY the examples that report the key. A value
 *      matching by coincidence does not track the key's presence across ten examples.
 *   3. exactly one key may satisfy 1-2, so where two do the evidence cannot say which and
 *      this declines rather than taking the first. */
function valueAnchoredFact(step, entry, label, occurrences, examples, notes) {
  const decline = (why) => {
    notes.push({ step, kind: 'valueAnchoredDeclined', detail: `${label}: ${why}` });
    return null;
  };
  const shows = new Set(occurrences.map((item) => item.observation));
  if (shows.size !== occurrences.length) return decline('shown more than once in one example');
  const candidates = new Set();
  for (const observation of examples) for (const key of displayKeys(observation.step)) candidates.add(key);
  const passing = [];
  for (const key of [...candidates].sort()) {
    if (entry.keys.has(key) || isRepetitionKey(key)) continue;
    const matches = occurrences.every(
      (item) => valueIdentity(item.observation.step[key]) === normaliseCalc(item.text),
    );
    if (!matches) continue;
    if (!examples.every((observation) => Object.hasOwn(observation.step, key) === shows.has(observation))) {
      continue;
    }
    passing.push(key);
  }
  if (passing.length === 0) return decline("no unplaced key's value is what the option shows");
  if (passing.length > 1) {
    return decline(`${passing.length} unplaced keys hold that value (${passing.join(', ')})`);
  }
  return { key: passing[0], label, occurrences };
}

/** Add the option to the key whose value it shows, as a plain `labelled` segment. */
function adoptValueAnchored(entry, fact) {
  const key = fact.key;
  if (!entry.keys.has(key)) entry.keys.set(key, []);
  entry.keyOf.set(key, key);
  for (const item of fact.occurrences) {
    entry.keys.get(key).push({
      render: 'labelled',
      label: fact.label,
      suffixOf: null,
      inlineOf: null,
      attribution: 'anchored',
      text: item.text,
      value: valueIdentity(item.observation.step[key]),
      quoted: false,
      shared: false,
      pathForm: null,
      example: item.observation.step,
      script: item.observation.script,
      index: item.observation.index,
    });
    spliceIntoOrder(item.observation.orderEntry, key, item.start);
  }
}

/** THE PRESENCE OF A KEY, PRINTED AS ONE OF FILEMAKER'S OWN WORDS, with no label and no
 *  value of its own.
 *
 *  `Go to Related Record` prints `New window` when the step opens one, and the settings that
 *  configure it — the window's name, height, width, top and left — are five values the CLI
 *  reports WITHOUT NAMING, so nothing in the line anchors any of them. `keyPresenceFact`
 *  cannot reach it either: that one requires every example to show the option, because it
 *  derives a text for both states, and here one state prints nothing at all.
 *
 *  The conditions are the ones the `hiddenWhen` search arrived at, because this IS that
 *  search in the other polarity and the loose version of it fires on coincidences freely:
 *
 *   1. the text must be one of FileMaker's own display phrases. A calculation or a name is
 *      content, and content cannot come from a key's mere presence.
 *   2. both states must recur at least three times — the figure the `hiddenWhen` search
 *      measured, where it cut eight candidates to two.
 *   3. exactly one unplaced key may be reported in exactly the examples that show it.
 *
 *  **THE ONE TIE THAT IS RESOLVED RATHER THAN DECLINED, and why it is not a preference.**
 *  Where several candidates are reported in EXACTLY the same examples AS EACH OTHER they are
 *  not rival explanations; they are one condition with several names, and every one of them
 *  renders identically. `Go to Related Record` offers five — the five slots holding one
 *  window configuration. Declining would lose a real fact to a distinction without a
 *  difference, and taking the first silently would hide that the name is arbitrary. So the
 *  lowest-sorting is recorded and the segment carries `presenceGroupTie`, which says exactly
 *  that in the JSON a consumer reads. Where the candidates are NOT presence-identical the
 *  evidence really does disagree about the rule, and this declines.
 *
 *  `slots` itself is never a candidate. It is the whole bag, present whenever ANY unnamed
 *  value is, so on a step type whose bag holds only this configuration it looks exactly like
 *  the condition while naming no value at all. */
function presenceOnlyOptions(step, entry, examples, bareForms, notes) {
  const decline = (why) => notes.push({ step, kind: 'presenceOnlyDeclined', detail: why });
  const byText = new Map();
  for (const option of bareForms) {
    if (!byText.has(option.text)) byText.set(option.text, []);
    byText.get(option.text).push(option);
  }
  for (const [text, options] of byText) {
    if (!DISPLAY_PHRASE.test(text)) continue;
    const shows = new Set(options.map((option) => option.observation));
    if (shows.size !== options.length) {
      decline(`${JSON.stringify(text)}: shown more than once in one example`);
      continue;
    }
    if (shows.size < DERIVED_HIDDEN_WHEN_MIN || examples.length - shows.size < DERIVED_HIDDEN_WHEN_MIN) {
      decline(
        `${JSON.stringify(text)}: shown in ${shows.size} of ${examples.length} example(s), and each state must ` +
          `recur ${DERIVED_HIDDEN_WHEN_MIN} times`,
      );
      continue;
    }
    const keys = [...new Set(examples.flatMap((observation) => displayKeys(observation.step)))].sort();
    const candidates = keys.filter(
      (key) =>
        key !== 'slots' &&
        !isRepetitionKey(key) &&
        !entry.keys.has(key) &&
        examples.every((observation) => Object.hasOwn(observation.step, key) === shows.has(observation)),
    );
    if (candidates.length === 0) {
      decline(`${JSON.stringify(text)}: no unplaced key is reported in exactly the examples that show it`);
      continue;
    }
    // A NAMED key beats an unnamed value describing the same condition, because a slot
    // number is step-local and a key name is not. It costs nothing on this corpus — the two
    // facts this finds are all-named (`Send Mail`, six `oauth…` keys) and all-slot
    // (`Go to Related Record`, five window values) — and it is the standing rule of this
    // work rather than a tie-break invented here.
    const named = candidates.filter((key) => parseSlotID(key) === null);
    const pool = named.length > 0 ? named : candidates;
    const identical = pool.every((key) =>
      examples.every(
        (observation) =>
          Object.hasOwn(observation.step, key) === Object.hasOwn(observation.step, pool[0]),
      ),
    );
    if (pool.length > 1 && !identical) {
      decline(
        `${JSON.stringify(text)}: ${pool.length} keys predict it and they are not reported together ` +
          `(${pool.join(', ')})`,
      );
      continue;
    }
    adoptPresenceOnly(entry, {
      key: pool[0],
      text,
      options,
      examples,
      group: pool.length > 1 ? pool : null,
    });
  }
}

/** Add the presence option as synthetic `keyPresence` placements, one per example, so that
 *  every test the segment derivation runs applies to it unchanged.
 *
 *  BOTH states are placed — the showing examples with the text, the rest with the empty
 *  string — because a renderer reads `keyPresence` as a total function of presence, and a
 *  missing `absent` entry is a missing display form rather than "prints nothing". */
function adoptPresenceOnly(entry, fact) {
  const id = `@presence:${fact.text}`;
  entry.keys.set(id, []);
  entry.keyOf.set(id, fact.key);
  if (fact.group) entry.presenceGroup.set(id, fact.group);
  const shown = new Map(fact.options.map((option) => [option.observation, option]));
  for (const observation of fact.examples) {
    const here = shown.get(observation);
    entry.keys.get(id).push({
      render: 'keyPresence',
      label: null,
      suffixOf: null,
      inlineOf: null,
      attribution: 'presence',
      text: here ? fact.text : '',
      value: here ? 'present' : 'absent',
      quoted: false,
      shared: false,
      pathForm: null,
      example: observation.step,
      script: observation.script,
      index: observation.index,
    });
    if (here) spliceIntoOrder(observation.orderEntry, id, here.start);
  }
}

/** Add a value-driven option to the step type as synthetic placements, so every test
 *  the segment derivation runs applies to it unchanged — and in particular so that
 *  two values sharing one display text come out as the `valueCollision` doubt they
 *  are rather than as a clean mapping.
 *
 *  Held under the key ITSELF, not a synthetic id: unlike a `keyPresence` option, this
 *  IS the key's own option, and the key had no other. Its absent state becomes
 *  `whenAbsent`, which is the same fact in the same field as everywhere else. */
function adoptValueEnum(entry, fact) {
  const key = fact.key;
  if (!entry.keys.has(key)) entry.keys.set(key, []);
  let absentSeen = 0;
  let absentText = null;
  for (const item of fact.occurrences) {
    if (!Object.hasOwn(item.observation.step, key)) {
      absentSeen += 1;
      absentText = item.text;
      continue;
    }
    entry.keys.get(key).push({
      render: 'labelledEnum',
      label: fact.label,
      suffixOf: null,
      inlineOf: null,
      attribution: 'valueFunction',
      text: item.text,
      value: valueIdentity(item.observation.step[key]),
      quoted: false,
      shared: false,
      pathForm: null,
      example: item.observation.step,
      script: item.observation.script,
      index: item.observation.index,
    });
    spliceIntoOrder(item.observation.orderEntry, key, item.start);
  }
  if (absentText !== null) entry.whenAbsent.set(key, { text: absentText, examples: absentSeen });
}

/** Put a key into this example's observed order at the position its option sat, so
 *  an option no key anchored is still ordered by where FileMaker printed it. */
function spliceIntoOrder(orderEntry, key, start) {
  const { order, positions } = orderEntry;
  if (order.includes(key)) return;
  let at = 0;
  while (at < positions.length && positions[at] < start) at += 1;
  order.splice(at, 0, key);
  positions.splice(at, 0, start);
  orderEntry.size += 1;
}

/** Is this unowned option's text a function of which keys the CLI reports?
 *
 *  Returns the fact, or null with a note. Four conditions, each closing a way the
 *  correlation could be a coincidence:
 *
 *   1. every example of the step type shows the option exactly once — otherwise
 *      the model is silent about the examples that do not, and a renderer would
 *      print the option there anyway;
 *   2. the texts are display phrases, not calculation, so a mis-cut calculation
 *      fragment cannot become an option;
 *   3. exactly one reported key partitions the examples by text. Two keys that
 *      both do it are indistinguishable on this evidence, and this declines;
 *   4. a structured value is not a candidate, and NEITHER IS A SLOT. `slots` tracks
 *      the CLI's own slot numbering and is present in exactly the by-name examples
 *      on the `Perform Script` family, so it correlates perfectly and explains
 *      nothing. That used to follow from the structured-value test, because `slots`
 *      was one object-valued key; now that each slot is a key of its own with a
 *      scalar value, the exclusion has to be stated — and until it was, both
 *      `keyPresence` options in the catalog silently disappeared, declined for
 *      having two equally good predictors. */
function keyPresenceFact(step, label, occurrences, examples, notes) {
  const decline = (why) => {
    notes.push({ step, kind: 'keyPresenceDeclined', detail: `${label}: ${why}` });
    return null;
  };
  if (occurrences.length !== examples.length) {
    return decline(`shown in ${occurrences.length} of ${examples.length} example(s), so no rule covers them all`);
  }
  const seen = new Set(occurrences.map((item) => item.observation));
  if (seen.size !== occurrences.length) return decline('shown more than once in one example');
  if (!occurrences.every((item) => DISPLAY_PHRASE.test(item.text))) {
    return decline('at least one of its texts is not a display phrase');
  }

  const candidates = new Set();
  for (const observation of examples) for (const key of displayKeys(observation.step)) candidates.add(key);
  const passing = [];
  for (const key of [...candidates].sort()) {
    const structured = examples.some(
      (observation) => Object.hasOwn(observation.step, key) && typeof observation.step[key] === 'object',
    );
    if (structured || parseSlotID(key) !== null) continue;
    const texts = { present: new Set(), absent: new Set() };
    for (const item of occurrences) {
      texts[Object.hasOwn(item.observation.step, key) ? 'present' : 'absent'].add(item.text);
    }
    if (texts.present.size !== 1 || texts.absent.size !== 1) continue;
    const present = [...texts.present][0];
    const absent = [...texts.absent][0];
    if (present === absent) continue;
    passing.push({ key, present, absent });
  }
  if (passing.length === 0) return decline('no reported key predicts its text');
  if (passing.length > 1) {
    return decline(`${passing.length} keys predict its text equally well (${passing.map((item) => item.key).join(', ')})`);
  }
  return { label, occurrences, ...passing[0] };
}

/** Add a `keyPresence` option to the step type as synthetic placements, so every
 *  test the segment derivation runs — recurrence, both injectivity directions,
 *  label collision, display-form mapping — applies to it unchanged.
 *
 *  It is held under an ID rather than under its key, because the key usually has
 *  an option of its own as well (`scriptName` prints `Specified: By name` AND the
 *  calculation), and `entry.keyOf` maps the ID back for the emitted segment. It is
 *  spliced into each example's observed order BY POSITION, which is the whole
 *  reason this pass runs before the order is derived: the order that renders both
 *  `Perform Script` states correctly puts this option between two keys the
 *  examples never showed together. */
function adoptKeyPresence(entry, fact) {
  const id = `@presence:${fact.label}`;
  entry.keys.set(id, []);
  entry.keyOf.set(id, fact.key);
  for (const item of fact.occurrences) {
    const present = Object.hasOwn(item.observation.step, fact.key);
    entry.keys.get(id).push({
      render: 'keyPresence',
      label: fact.label,
      suffixOf: null,
      attribution: 'presence',
      text: item.text,
      value: present ? 'present' : 'absent',
      quoted: false,
      shared: false,
      pathForm: null,
      inlineOf: null,
      example: item.observation.step,
      script: item.observation.script,
      index: item.observation.index,
    });
    spliceIntoOrder(item.observation.orderEntry, id, item.start);
  }
}

function mostFrequent(counts) {
  let best = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

function countBy(items, pick) {
  const counts = new Map();
  for (const item of items) {
    const value = pick(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** A key's mean position in the lines that showed it, as a fraction of the line's
 *  options. Fractions compare across lines of different lengths; raw indices do
 *  not. Only used where no precedence evidence exists at all. */
function meanFraction(examples, key) {
  const seen = examples.filter((example) => example.order.includes(key));
  if (seen.length === 0) return 0;
  const total = seen.reduce((sum, example) => {
    const at = example.order.indexOf(key);
    return sum + (example.order.length > 1 ? at / (example.order.length - 1) : 0);
  }, 0);
  return total / seen.length;
}

/** Key order is the order OBSERVED, merged over every example.
 *
 *  THE BRIEF'S RULE IS NOT ENOUGH, and the data says so. "Take the order from the
 *  example with the most segments" settles a contradiction between two examples,
 *  but it says nothing about a key that example never showed — and appending those
 *  at the end is measurably wrong. No `AVPlayer Play` line shows both `url` and
 *  `objectName` (they are alternative sources), so the richest example's order
 *  put `url` LAST although eight lines render it FIRST. Same for `Insert
 *  Calculated Result`'s `select` and `Perform Script on Server`'s `scriptName`.
 *
 *  So: every example contributes its pairwise precedence; a genuine contradiction
 *  is resolved by weight of examples and then by the most fully specified one (the
 *  brief's rule, applied where it belongs) and REPORTED; and a pair of keys no
 *  example ever showed together is reported as unmeasured rather than presented as
 *  known. */
function deriveOrder(entry, keys) {
  const all = [...keys.keys()];
  const examples = entry.orders.filter((example) => example.order.length > 0);
  const richest = examples.reduce((best, example) => (!best || example.size > best.size ? example : best), null);
  const richestAt = new Map((richest?.order ?? []).map((key, at) => [key, at]));
  const fraction = new Map(all.map((key) => [key, meanFraction(examples, key)]));

  const pairID = (a, b) => JSON.stringify([a, b]);
  const seenBefore = new Map();
  for (const example of examples) {
    for (let i = 0; i < example.order.length; i += 1) {
      for (let j = i + 1; j < example.order.length; j += 1) {
        const id = pairID(example.order[i], example.order[j]);
        seenBefore.set(id, (seenBefore.get(id) ?? 0) + 1);
      }
    }
  }

  /** Which key comes first when neither precedes the other in the data. */
  const rank = (a, b) =>
    fraction.get(a) - fraction.get(b) ||
    (richestAt.get(a) ?? Number.POSITIVE_INFINITY) - (richestAt.get(b) ?? Number.POSITIVE_INFINITY) ||
    a.localeCompare(b);

  const follows = new Map(all.map((key) => [key, new Set()]));
  const conflicts = [];
  const unmeasured = [];
  const attested = [];
  const contradicted = [];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      const ab = seenBefore.get(pairID(a, b)) ?? 0;
      const ba = seenBefore.get(pairID(b, a)) ?? 0;
      const external = attestationFor(entry.name, a, b);
      if (ab === 0 && ba === 0) {
        // No evidence in these pairs. External attestation, if any, decides —
        // recorded on the entry as its own provenance class, never as a promotion.
        if (external) {
          attested.push({ keys: external.keys, source: external.source });
          follows.get(external.keys[0]).add(external.keys[1]);
        } else {
          unmeasured.push([a, b]);
        }
        continue;
      }
      const first = ab > ba ? a : ba > ab ? b : rank(a, b) <= 0 ? a : b;
      // Measured reality beats attestation: if these examples order the pair the
      // other way, the data wins and the contradiction is reported.
      if (external && external.keys[0] !== first) contradicted.push({ ...external, ab, ba });
      if (ab > 0 && ba > 0) conflicts.push({ a, b, ab, ba, first });
      follows.get(first).add(first === a ? b : a);
    }
  }

  const indegree = new Map(all.map((key) => [key, 0]));
  for (const [, targets] of follows) for (const target of targets) indegree.set(target, indegree.get(target) + 1);
  const order = [];
  const cycles = [];
  const remaining = new Set(all);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((key) => indegree.get(key) === 0).sort(rank);
    if (ready.length === 0) {
      // Three or more keys each observed before the next: a real contradiction no
      // pairwise rule can satisfy. Free the least constrained key and say so.
      const victim = [...remaining].sort((a, b) => indegree.get(a) - indegree.get(b) || rank(a, b))[0];
      cycles.push(victim);
      for (const [, targets] of follows) {
        if (targets.delete(victim)) indegree.set(victim, indegree.get(victim) - 1);
      }
      continue;
    }
    const next = ready[0];
    remaining.delete(next);
    order.push(next);
    for (const target of follows.get(next)) indegree.set(target, indegree.get(target) - 1);
    follows.get(next).clear();
  }

  return { order, conflicts, unmeasured, cycles, attested, contradicted };
}

/** The external attestation for this pair of keys, in either order, or null. */
function attestationFor(step, a, b) {
  return (
    EXTERNAL_ORDER.find(
      (item) => item.step === step && item.keys.includes(a) && item.keys.includes(b),
    ) ?? null
  );
}

/** One key of one step type -> one catalog segment, plus every reason to doubt it.
 *
 *  `id` is the key itself, except for a `keyPresence` option, which is held under
 *  a synthetic id because its key usually owns a second option too. */
function deriveSegment(id, placements, allPlacements, entry) {
  // Three names for one thing, deliberately kept apart: `id` is how this step
  // type's placements are held (a synthetic id for a `keyPresence` option, whose
  // key owns a second segment as well), `lookupKey` is what the entry's per-key
  // maps are keyed by, and the EMITTED key is `slots` for a slot, with the slot
  // reference beside it — because a slot has no name of its own.
  const lookupKey = entry.keyOf.get(id) ?? id;
  const slot = parseSlotID(lookupKey);
  const renderCounts = countBy(placements, (placement) => placement.render);
  const render = mostFrequent(renderCounts).value;
  const ofKind = placements.filter((placement) => placement.render === render);
  const labelCounts = countBy(ofKind, (placement) => placement.label);
  const label = mostFrequent(labelCounts).value;
  const suffixOf = mostFrequent(countBy(ofKind, (placement) => placement.suffixOf)).value;
  const inlineOf = mostFrequent(countBy(ofKind, (placement) => placement.inlineOf)).value;
  const labelWhen = deriveConditionalLabel(lookupKey, ofKind, labelCounts);
  const attribution = ATTRIBUTION_ORDER.find((name) =>
    placements.some((placement) => placement.attribution === name),
  );

  const doubts = [];
  if (placements.length === 1) doubts.push('singleExample');
  if (renderCounts.size > 1) doubts.push('renderDisagreement');
  // A label disagreement is only a doubt while it is UNEXPLAINED. Where another
  // key's value predicts which label FileMaker uses, the disagreement is the fact
  // rather than a weakness in it — but the fact's own evidence is then thin, since
  // most deciding values occur once, and that is what `conditionalLabelThin` says.
  if (labelCounts.size > 1 && !labelWhen) doubts.push('labelDisagreement');
  if (labelWhen && labelWhen.thin) doubts.push('conditionalLabelThin');
  // Several reported keys are present in EXACTLY the same examples as the one recorded, so
  // which of them decides this option is not a thing the data can say. See
  // `presenceOnlyOptions`: they are one condition with several names, every one renders
  // identically, and the name written down is the lowest-sorting of the group.
  const group = entry.presenceGroup.get(id);
  if (group) doubts.push('presenceGroupTie');
  if (render === 'labelledMismatch') doubts.push('mismatch');

  // Injectivity, test 1: two DIFFERENT values must not render as the same text.
  // This is what catches an attribution that recurs consistently and is still
  // wrong — `Go to Layout`'s `target` claiming `Animation: None` three times.
  if (DERIVED_TEXT_KINDS.has(render)) {
    const byText = new Map();
    for (const placement of ofKind) {
      if (placement.value === null) continue;
      if (!byText.has(placement.text)) byText.set(placement.text, new Set());
      byText.get(placement.text).add(placement.value);
    }
    if ([...byText.values()].some((values) => values.size > 1)) doubts.push('valueCollision');
  }

  // Injectivity, test 1b — THE STRONGER DIRECTION, and the one the ruling that
  // specified these tests did not name: ONE value rendering as TWO texts is proof
  // that the text is not a function of this key, so this key did not produce it.
  // A value collision is only a hint; this is a counter-example. Applies to every
  // kind, not just the derived-text ones, because it needs no assumption about
  // how the value is displayed.
  const collisions = functionalCollisions(ofKind);
  if (collisions.length > 0) doubts.push('valueNotFunctional');

  // Injectivity, test 2: no two keys of this step type may render the same label.
  // Compared by ID rather than by key, so a `keyPresence` option — whose key owns a
  // second segment — is not counted as colliding with ITSELF.
  if (label !== null) {
    const sameLabel = [...allPlacements.entries()].filter(
      ([other, list]) =>
        other !== id && list.some((placement) => (placement.label ?? '').toLowerCase() === label.toLowerCase()),
    );
    if (sameLabel.length > 0) doubts.push('labelCollision');
  }

  const values = {};
  const rejected = [];
  const mappingExamples = [];
  if (VALUE_MAP_KINDS.has(render)) {
    for (const [value, texts] of groupValues(ofKind)) {
      const text = mostFrequent(texts).value;
      // AN EMPTY TEXT ON A PRESENCE OPTION IS A MEASUREMENT, NOT A REJECTED MAPPING:
      // FileMaker prints this option in one state and nothing at all in the other, and
      // `keyPresence` is read as a total function of presence, so the empty string is how
      // "prints nothing" is stated. The same reasoning as `whenAbsent`'s `''`. Without
      // this it read as a display form that could not be derived, which both doubted a
      // sound fact and left the renderer with a missing form to gap on.
      if (render === 'keyPresence' && text === '') {
        values[value] = '';
        mappingExamples.push([...texts.values()].reduce((sum, count) => sum + count, 0));
      } else if (isDisplayMapping(value, text)) {
        values[value] = text;
        mappingExamples.push([...texts.values()].reduce((sum, count) => sum + count, 0));
      } else {
        rejected.push({ value, text });
      }
    }
  }
  // A repetition's display form, and ONLY where it differs from the value: the
  // bracket content is the value itself in every example but one, and recording
  // 24 identity mappings to carry a single real one would bury it. The real one is
  // `0 -> ""`, FileMaker's empty bracket, which is the empty option slot of ruling
  // 1 and not a repetition number — there is no repetition zero.
  if (render === 'suffix') {
    for (const [value, texts] of groupValues(ofKind)) {
      const content = String(mostFrequent(texts).value).replace(/^\[(.*)\]$/, '$1');
      if (content !== value) values[value] = content;
    }
  }
  // ONE VALUE'S DISPLAY FORM ON A PASSTHROUGH KIND, and only the values `valueDisplayForms`
  // adopted. A `bare` or `labelled` option prints its value as it stands, so its map is an
  // OVERRIDE and not an enumeration: recording every observed value would bury the one real
  // entry under identity mappings, and would copy the owner's own field and variable names
  // into the catalog as though they were FileMaker vocabulary. So the emission is scoped to
  // the placements that pass marked themselves with, each of which has already been through
  // `isDisplayMapping`. The `suffix` map below is the same reasoning, and the precedent.
  //
  // TWO ROUTES REACH IT, and the second is the one the corpus mostly uses. Some values of
  // a passthrough key are placed by the MATCHER as an enum, because the option shares a
  // word with the key — `Set Zoom Level` prints `25%` for `zoom: "25%"` in eight examples
  // and `Zoom In` for `zoom: "zoomIn"` in two, `Configure Region Monitor Script` prints
  // `Monitor: iBeacon` in eight and `Monitor: Geofence` in one. The segment then takes the
  // majority render, the minority placements' mappings were dropped with it, and the
  // renderer printed the raw code. A placement of a mapping kind carries a measured display
  // form whichever kind the segment ends up as, so it is kept; the disagreement itself is
  // already recorded as `renderDisagreement`.
  if (!VALUE_MAP_KINDS.has(render)) {
    for (const placement of placements) {
      if (placement.value === null || placement.text === null) continue;
      if (!placement.displayForm && !VALUE_MAP_KINDS.has(placement.render)) continue;
      if (placement.text === placement.value) continue;
      if (!isDisplayMapping(placement.value, placement.text)) continue;
      if (values[placement.value] === undefined) values[placement.value] = placement.text;
    }
  }
  const setMembers = render === 'setMember' ? deriveSetMemberValues(ofKind) : null;
  if (setMembers) Object.assign(values, setMembers.values);
  // A rejected mapping is not a formatting nicety: the value did not look like a
  // code, or the text did not look like a display name, which is what a FALSE
  // attribution looks like from here. Rejecting the mapping and keeping the fact
  // it came from was the pattern that left `Truncate Table | table selection` and
  // `Perform Semantic Find | return count` reading `measured`.
  if (rejected.length > 0) doubts.push('rejectedMapping');
  // Every display form this key has rests on a single observation, and the
  // placement itself was inferred rather than anchored: nothing here is
  // corroborated. Catches `Move/Resize Window | target`, whose two mappings are
  // one example each and one of which (`byName -> Current file`) is wrong.
  if (
    attribution !== 'anchored' &&
    mappingExamples.length > 0 &&
    mappingExamples.every((count) => count === 1)
  ) {
    doubts.push('thinMapping');
  }

  // Recurrence over EXAMPLES is not recurrence over VALUES. An inferred fact whose
  // examples all carry ONE value is one observation repeated — measured:
  // `Go to List of Records | name` agrees four times only because the owner named
  // his window `"new window"` while FileMaker's `New window` is the new-window
  // flag. This was reported in prose in round 1 and is now where a consumer sees it.
  if (singleValueOnly(render, attribution, placements)) doubts.push('singleValueOnly');

  const quoted = ofKind.length > 0 && ofKind.every((placement) => placement.quoted);

  // Values this key held while FileMaker showed nothing for it, minus every value
  // it was ever shown WITH. That subtraction is what makes the field safe: a key
  // suppressed by another option's state (`Perform Script | script`, hidden while
  // `scriptName` is reported) holds the same value in both cases, so it can never
  // be mistaken for a value that never prints.
  const shown = new Set(placements.map((placement) => placement.value));
  const omitted = [...(entry.omittedValues.get(lookupKey)?.keys() ?? [])].filter((value) => !shown.has(value));
  // Only a CODE can be a value FileMaker declines to print. A calculation that
  // rendered nowhere is a suppressed OPTION, which is a different fact and belongs
  // to `hiddenWhen` — and this filter is also what keeps the owner's own
  // calculations, field references and variable names out of a committed file by
  // construction rather than by an assertion catching them afterwards.
  const omittedValues = omitted.filter((value) => ENUM_CODE.test(value)).sort();
  const omittedCalcs = omitted.length - omittedValues.length;
  // THE OWNER'S RULING ON FILE OPTIONS, applied as a general rule and verified
  // rather than measured key by key. He ruled: "FM does not print the prefix." The
  // corpus can only tell `fileName` from `schemeStripped` on the two keys whose
  // values carry a directory, so measuring per key would leave the rest reading
  // `schemeStripped` — a narrower rule than the one he stated — while every example
  // agrees with his. So `fileName` is asserted for every file option and checked
  // against every placement; a placement that disagrees keeps the measured form and
  // is reported.
  const pathForms = new Set(ofKind.map((placement) => placement.pathForm).filter(Boolean));
  const listFirst = ofKind.some((placement) => placement.listFirst);
  const fileNameDisagrees = ofKind.filter((placement) => placement.fileNameAgrees === false).length;
  const pathForm = !listFirst
    ? null
    : fileNameDisagrees === 0
      ? 'fileName'
      : pathForms.has('fileName')
        ? 'fileName'
        : pathForms.has('schemeStripped')
          ? 'schemeStripped'
          : null;
  const hidden = HIDDEN_RULES.find((item) => item.step === entry.name && item.key === lookupKey);
  const whenAbsent = entry.whenAbsent.get(lookupKey) ?? null;

  const segment = {
    key: slot ? 'slots' : lookupKey,
    ...(slot ? { slot } : {}),
    render,
    ...(label === null ? {} : { label }),
    ...(labelWhen ? { labelWhen: { key: labelWhen.key, labels: labelWhen.labels } } : {}),
    ...(render === 'suffix' && suffixOf ? { suffixOf } : {}),
    ...(inlineOf ? { inlineOf } : {}),
    ...(quoted ? { quoted: true } : {}),
    ...(pathForm ? { pathForm } : {}),
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(whenAbsent ? { whenAbsent } : {}),
    ...(omittedValues.length > 0 ? { omittedValues } : {}),
    // A slot has no name, so the rule addresses it the way a segment does: the key is
    // `slots` and the reference sits beside it. The derivation holds the pseudo-key
    // `@slot:member:number`; only the emitted shape differs.
    ...(hidden
      ? {
          hiddenWhen: {
            keyPresent: parseSlotID(hidden.keyPresent) === null ? hidden.keyPresent : 'slots',
            ...(parseSlotID(hidden.keyPresent) === null ? {} : { slot: parseSlotID(hidden.keyPresent) }),
          },
        }
      : {}),
    examples: placements.length,
    attribution,
    confidence: doubts.length > 0 ? 'low' : 'measured',
    ...(doubts.length > 0 ? { doubts } : {}),
  };
  return {
    segment,
    rejected,
    collisions,
    quotedMixed: quotedMixed(ofKind),
    pathForms: [...pathForms],
    fileNameDisagrees,
    setMemberNote: setMembers?.note ?? null,
    omittedCalcs,
  };
}

/** The state key for "the CLI did not report the deciding key at all". A real value
 *  spelling `absent` would collide with it; nothing in this corpus does, and the
 *  types say the word is reserved. */
const ABSENT_STATE = 'absent';

/** Does FileMaker's label for this option follow ANOTHER key's value?
 *
 *  The repo owner's ruling on `Add Account`: one key's value decides both what
 *  `Authenticate via` shows and whether the account key is labelled `Account Name`
 *  or `Group Name`. So a label disagreement across examples is not always a
 *  weakness in the reading — sometimes it is the fact.
 *
 *  Four conditions, and each is a way this could otherwise invent a rule:
 *
 *   1. every example must have a state for the deciding key — its value, or
 *      `absent`. A structured or list value has no state to key on and disqualifies
 *      the candidate rather than being stringified into one.
 *   2. the state must be a FUNCTION of the label: one state, one label. Two labels
 *      under one state is proof that this key does not decide it.
 *   3. every present state must be a CODE. A calculation deciding a label is not a
 *      thing FileMaker does, and this is also what keeps the owner's own
 *      calculations out of the emitted `labelWhen` by construction rather than by
 *      an assertion catching them afterwards.
 *   4. exactly one key may satisfy 1-3. Where two do, the evidence cannot say which,
 *      and the label disagreement stays a doubt.
 *
 *  `thin` reports whether any deciding value was seen exactly once, which on this
 *  corpus is most of them: the RULE recurs across nine states, each individual
 *  state -> label pair does not. */
function deriveConditionalLabel(key, placements, labelCounts) {
  if (labelCounts.size < 2) return null;
  if (placements.some((placement) => !placement.example)) return null;
  const deciders = [...new Set(placements.flatMap((placement) => displayKeys(placement.example)))].sort();
  const passing = [];
  for (const decider of deciders) {
    if (decider === key || parseSlotID(decider) !== null) continue;
    const byState = new Map();
    let usable = true;
    for (const placement of placements) {
      const present = Object.hasOwn(placement.example, decider);
      const state = present ? valueIdentity(placement.example[decider]) : ABSENT_STATE;
      if (state === null || state === '' || (present && !ENUM_CODE.test(state))) {
        usable = false;
        break;
      }
      if (!byState.has(state)) byState.set(state, new Map());
      const labels = byState.get(state);
      const shown = placement.label ?? '';
      labels.set(shown, (labels.get(shown) ?? 0) + 1);
    }
    if (!usable || byState.size < 2) continue;
    if ([...byState.values()].some((labels) => labels.size > 1)) continue;
    passing.push({ decider, byState });
  }
  if (passing.length !== 1) return null;
  const { decider, byState } = passing[0];
  const labels = {};
  let thin = false;
  for (const [state, counts] of [...byState.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [shown, seen] = [...counts.entries()][0];
    labels[state] = shown;
    if (seen === 1) thin = true;
  }
  return { key: decider, labels, thin };
}

/** Which member of a structured value's `set` carries the display name.
 *
 *  A member qualifies for a text when it is in EVERY example showing that text and
 *  in no example showing another — the same discrimination test twice over, which
 *  is what makes the resulting map unambiguous for a renderer: each recorded member
 *  can only occur on values that display its own text.
 *
 *  Where several members qualify, the one named `…Mode` wins. That is the CLI's own
 *  naming for the window mode and it is what the repo owner's reading of the JSON
 *  identified. Measured on `New Window | style`: `documentMode`, `dialogMode` and
 *  `cardMode` name three of the four styles, and the fourth (`Floating Document`)
 *  has no `…Mode` member at all — its sole discriminator is `alwaysOnTop`, so the
 *  `…Mode` preference is a tie-break and cannot be a requirement. */
function deriveSetMemberValues(placements) {
  const usable = placements.filter((placement) => Array.isArray(placement.setMembers));
  if (usable.length === 0) return null;
  const texts = new Map();
  for (const placement of usable) {
    for (const member of placement.setMembers) {
      if (!texts.has(member)) texts.set(member, new Set());
      texts.get(member).add(placement.text);
    }
  }
  const values = {};
  const undecided = [];
  for (const text of new Set(usable.map((placement) => placement.text))) {
    const showing = usable.filter((placement) => placement.text === text);
    const candidates = [...texts.entries()]
      .filter(([member, seen]) => seen.size === 1 && seen.has(text))
      .map(([member]) => member)
      .filter((member) => showing.every((placement) => placement.setMembers.includes(member)));
    const chosen = candidates.find((member) => /Mode$/.test(member)) ?? (candidates.length === 1 ? candidates[0] : null);
    if (chosen === null) {
      undecided.push(`${JSON.stringify(text)} has ${candidates.length} discriminating member(s)`);
      continue;
    }
    values[chosen] = text;
  }
  return { values, note: undecided.length > 0 ? undecided.join('; ') : null };
}

/** Values that rendered as more than one text — a counter-example to the claim
 *  that this key produced the text.
 *
 *  Placements whose text ANOTHER key contributed to are excluded, and that
 *  exclusion is the whole difficulty: a field's repetition is appended to the
 *  field it belongs to, so `Set Variable | name` shows `$var` in one example and
 *  `$var[<calc>]` in another for the same `name`. That is a measured render rule
 *  (the `suffix` kind), not a disagreement. Without the exclusion this test fires
 *  on 13 segments of which 10 are that artefact; with it, on the 3 real ones. */
function functionalCollisions(placements) {
  const byValue = new Map();
  for (const placement of placements) {
    if (placement.value === null || placement.text === null || placement.shared) continue;
    if (!byValue.has(placement.value)) byValue.set(placement.value, new Set());
    byValue.get(placement.value).add(placement.text);
  }
  return [...byValue.entries()]
    .filter(([, texts]) => texts.size > 1)
    .map(([value, texts]) => ({ value, texts: [...texts] }));
}

/** Kinds whose value cannot vary, so "every example carried the same value" says
 *  nothing about them. */
const CONSTANT_VALUE_KINDS = new Set(['bareWhenTrue', 'masked', 'labelledState', 'suffix']);

function singleValueOnly(render, attribution, placements) {
  if (attribution === 'anchored' || CONSTANT_VALUE_KINDS.has(render)) return false;
  if (placements.length < 2) return false; // already `singleExample`
  const values = new Set(placements.filter((placement) => placement.value !== null).map((p) => p.value));
  return values.size === 1;
}

/** Did FileMaker quote this key's value in some examples but not others? Zero
 *  cases in the owner's data; reported rather than guessed at if one appears. */
function quotedMixed(placements) {
  const quoted = placements.filter((placement) => placement.quoted).length;
  return quoted > 0 && quoted < placements.length ? { quoted, of: placements.length } : null;
}

function groupValues(placements) {
  const byValue = new Map();
  for (const placement of placements) {
    if (placement.value === null || placement.text === null) continue;
    if (!byValue.has(placement.value)) byValue.set(placement.value, new Map());
    const texts = byValue.get(placement.value);
    texts.set(placement.text, (texts.get(placement.text) ?? 0) + 1);
  }
  return byValue;
}

/** Withdraw the placements of a key whose ONLY evidence is counting and whose label
 *  another key of the same step type demonstrably owns.
 *
 *  `sole` means "nothing else was left over", which is the weakest thing this
 *  derivation can say. A label FileMaker printed for another key is stronger
 *  counter-evidence than that, so where the two meet the counted one is not a fact.
 *
 *  **Demotion is not enough, and the repo owner's ruling 7 is why.** He rejected
 *  exactly this shape once already — an option claimed by a second key and printed
 *  twice — and the reason it survived four review rounds was that injectivity
 *  demoted it to `low` rather than removing it, while a renderer acts on a `low`
 *  fact. So this removes it, and the key goes to `unresolved` with its own cause
 *  rather than vanishing.
 *
 *  It fires twice on this corpus, and both are the same shape as his ruling: a key
 *  claiming `Animation:` on a step whose own `animation` key is right there, and a
 *  step-value key claiming another key's provider label. Both were printing their
 *  option a second time.
 *
 *  **It runs BEFORE the presentation pass, and that placement is load-bearing.** A
 *  withdrawn placement is displayed content whose attribution was false, so it goes
 *  back into `withdrawnHere` for `leftoverOptions` to offer again — and both of these
 *  options are then recognised for what they really are: the absent-key form of the
 *  key that owns the label (`Animation: None`, `Model Provider: OpenAI`). Withdrawing
 *  after the presentation pass instead removed the false option and left FileMaker's
 *  real one unexplained, which cost four lines that had been right for the wrong
 *  reason and gave nothing back. */
function withdrawCountedLabelRivals(collected) {
  const withdrawn = [];
  const index = ATTRIBUTION_ORDER.indexOf('sole');
  for (const [name, entry] of collected.types) {
    const summary = new Map();
    for (const [id, placements] of entry.keys) {
      const render = mostFrequent(countBy(placements, (placement) => placement.render)).value;
      const ofKind = placements.filter((placement) => placement.render === render);
      summary.set(id, {
        label: mostFrequent(countBy(ofKind, (placement) => placement.label)).value,
        strength: Math.min(...placements.map((placement) => ATTRIBUTION_ORDER.indexOf(placement.attribution))),
      });
    }
    for (const [id, info] of summary) {
      if (info.label === null || info.strength !== index) continue;
      const rival = [...summary.entries()].find(
        ([other, item]) => other !== id && item.label === info.label && item.strength < info.strength,
      );
      if (!rival) continue;
      withdrawn.push({
        step: name,
        id,
        label: info.label,
        rival: rival[0],
        placements: entry.keys.get(id).length,
      });
      entry.keys.delete(id);
      entry.keyOf.delete(id);
      entry.withdrawnByLabel.add(id);
      for (const order of entry.orders) {
        const at = order.order.indexOf(id);
        if (at === -1) continue;
        order.order.splice(at, 1);
        order.positions.splice(at, 1);
      }
    }
  }
  // The placements themselves, moved from `kept` to `withdrawnHere` on every example
  // that carried one, so the option they claimed is available to the passes that run
  // next exactly as a hand-withdrawn one is.
  for (const observation of collected.observations) {
    const entry = collected.types.get(observation.name);
    if (!entry || entry.withdrawnByLabel.size === 0) continue;
    const kept = [];
    for (const segment of observation.kept) {
      if (entry.withdrawnByLabel.has(segment.key)) observation.withdrawnHere.push(segment);
      else kept.push(segment);
    }
    observation.kept = kept;
  }
  return withdrawn;
}

/** How a key is NAMED in the emitted catalog. A slot has no name of its own, so it
 *  is emitted as the key `slots` plus the reference that says which slot — the same
 *  shape on a segment, an `ignored` claim and an `unresolved` one, so a consumer
 *  reads one convention rather than three. */
function emitKeyRef(key) {
  const slot = parseSlotID(key);
  return slot ? { key: 'slots', slot } : { key };
}

function deriveEntry(entry) {
  const { order, conflicts, unmeasured, cycles, attested, contradicted } = deriveOrder(entry, entry.keys);
  const derived = order.map((id) => ({ id, ...deriveSegment(id, entry.keys.get(id), entry.keys, entry) }));
  const segments = derived.map((item) => item.segment);
  const signals = derived;
  const droppedIDs = entry.withdrawnByLabel;

  const displayName = mostFrequent(entry.displayNames).value;
  const commentStyle = entry.commentStyleExamples > 0;
  // The REAL keys, since a `keyPresence` option is held under a synthetic id: a key
  // that owns one is displayed, and must not read as never shown.
  const placed = new Set(
    [...entry.keys.keys()].filter((id) => !droppedIDs.has(id)).map((id) => entry.keyOf.get(id) ?? id),
  );
  const withdrawals = WITHDRAWN_FACTS.filter((item) => item.step === entry.name);
  const withdrawnKeys = withdrawals
    .flatMap((item) => item.facts.map((fact) => fact.key))
    .filter((key, at, all) => all.indexOf(key) === at);
  // A key whose EVERY withdrawal names an external source. Every, not any: one unattested
  // withdrawal is enough to make the claim rest on a judgment again, and the answer to
  // "which of the two withdrawals is this claim standing on" is both of them.
  const attestedWithdrawals = new Map(
    withdrawnKeys
      .map((key) => {
        const mine = withdrawals.filter((item) => item.facts.some((fact) => fact.key === key));
        const sources = [...new Set(mine.map((item) => item.attestation))];
        return [key, sources.length === 1 && sources[0] !== undefined ? sources[0] : undefined];
      })
      .filter(([, source]) => source !== undefined),
  );

  // `ignored` asserts a universal negative — FileMaker never shows this key — which
  // is the boldest claim in the catalog and the one a renderer acts on by printing
  // nothing. It therefore carries the same evidence as a segment: how many examples
  // support it, and every reason to doubt it. As bare strings it had nowhere to put
  // a doubt, and the first false entry had none.
  const ignoredKeys = [...entry.ignoredCounts.keys()]
    .filter((key) => !placed.has(key))
    // A comment's text IS displayed, after `# ` and outside any bracket, so
    // listing it as never shown would be a false claim.
    .filter((key) => !(commentStyle && key === 'text'))
    // Zero clean observations is not a claim. It can happen when every example
    // that reported the key was refuted or dropped, and the honest answer then is
    // `unresolved`, not a universal negative with no evidence behind it.
    .filter((key) => (entry.ignoredCounts.get(key) ?? 0) > 0)
    .sort();
  // The RAW ids, so a slot can be told from another slot: every `ignored` entry emits
  // the key `slots`, and comparing emitted names put one slot in both lists at once.
  const ignoredIDs = new Set(ignoredKeys);
  const ignored = ignoredKeys.map((key) => {
    const examples = entry.ignoredCounts.get(key);
    const attestation = attestedWithdrawals.get(key);
    const doubts = [];
    if (examples === 1) doubts.push('singleExample');
    // A dropped segment is a withdrawal by another route, so it carries the same
    // doubt: this claim exists BECAUSE a rendering for the key was set aside — UNLESS the
    // withdrawal named a source outside this corpus, which supplies the evidence the
    // dependence was doubting. See `WITHDRAWN_FACTS`.
    if ((withdrawnKeys.includes(key) && attestation === undefined) || droppedIDs.has(key)) {
      doubts.push('withdrawalDependent');
    }
    return {
      ...emitKeyRef(key),
      examples,
      confidence: doubts.length > 0 ? 'low' : 'measured',
      ...(doubts.length > 0 ? { doubts } : {}),
      ...(attestation === undefined ? {} : { attestation }),
    };
  });

  // A key the derivation took out of `ignored` must not simply vanish: `unresolved`
  // is where "we could not settle this" lives, and that is exactly its state.
  // Silently omitting it would lose the very distinction `ignored` exists to draw —
  // and so would listing it as a bare name, since "considered never-shown and
  // refuted" is a different state from "found a rendering and withdrew it". Each
  // entry carries its cause, and a refuted one carries the rules and how many
  // observations they set aside.
  const unresolved = [...withdrawnKeys, ...droppedIDs, ...entry.contradictedKeys, ...entry.droppedOnOpaque]
    .filter((key, at, list) => list.indexOf(key) === at)
    .filter((key) => !placed.has(key) && !ignoredIDs.has(key))
    .sort()
    .map((key) => {
      // Precedence: a withdrawal is a hand-reviewed determination about a rendering
      // that WAS found, which says more than the absence a refutation reports.
      if (withdrawnKeys.includes(key)) return { ...emitKeyRef(key), cause: 'withdrawn' };
      if (droppedIDs.has(key)) return { ...emitKeyRef(key), cause: 'labelOwnedElsewhere' };
      const refutations = entry.refutations.get(key) ?? [];
      if (refutations.length > 0) {
        return {
          ...emitKeyRef(key),
          cause: 'refuted',
          observations: refutations.length,
          refutedBy: [...new Set(refutations)].sort(),
        };
      }
      return { ...emitKeyRef(key), cause: 'opaqueMetadata' };
    });
  // Say out loud where each withdrawn key ended up and on what evidence, rather
  // than leaving the classification to be inferred from two lists.
  const dispositions = withdrawnKeys.map((key) => ({
    key,
    where: placed.has(key)
      ? 'still placed by another example'
      : ignoredIDs.has(key)
        ? attestedWithdrawals.has(key)
          ? 'ignored (measured: the withdrawal names an external source)'
          : 'ignored (low: withdrawalDependent)'
        : 'unresolved',
    independentIgnored: entry.ignoredCounts.get(key) ?? 0,
    reported: entry.reportedCounts.get(key) ?? 0,
  }));

  const residual = Object.fromEntries(
    Object.entries(entry.residual).filter(([, count]) => count > 0),
  );

  const record = {
    ...(entry.nameUnverifiedExamples > 0
      ? { displayNameUnverifiable: true }
      : displayName === entry.name
        ? {}
        : { displayName }),
    ...(entry.emptyBracketExamples > 0 ? { emptyBrackets: true } : {}),
    ...(commentStyle ? { commentStyle: true } : {}),
    segments,
    ignored,
    ...(unresolved.length > 0 ? { unresolved } : {}),
    ...(attested.length > 0 ? { attestedOrder: attested } : {}),
    derivedFrom: entry.examples,
    ...(Object.keys(residual).length > 0 ? { residual } : {}),
    // Set by Task 4's round-trip, which is the only thing that can know it.
    verified: false,
  };
  return {
    record,
    conflicts,
    unmeasured,
    cycles,
    contradicted,
    signals,
    dispositions,
    displayNames: entry.displayNames,
  };
}

function derive(collected) {
  const catalog = {};
  const disagreements = [];
  const rejected = [];
  const dispositions = [];
  for (const name of [...collected.types.keys()].sort((a, b) => a.localeCompare(b))) {
    const entry = collected.types.get(name);
    const derivedEntry = deriveEntry(entry);
    const { record, conflicts, unmeasured, cycles, contradicted, signals, displayNames } = derivedEntry;
    catalog[name] = record;
    for (const item of derivedEntry.dispositions) dispositions.push({ step: name, ...item });
    for (const signal of signals) {
      const where = signal.segment.key;
      for (const mapping of signal.rejected) rejected.push({ step: name, key: where, ...mapping });
      if (signal.quotedMixed) {
        disagreements.push({
          step: name,
          kind: 'quoting',
          detail: `${where}: FileMaker quoted the value in ${signal.quotedMixed.quoted} of ${signal.quotedMixed.of} examples, so the quoted flag is not recorded`,
        });
      }
      // Two file-path rules on one key: FileMaker printed the whole path in one
      // example and only part of it in another. The owner ruled that it prints the
      // file name ("FM does not print the prefix"), so the shorter form is taken and
      // the disagreement is stated rather than hidden by that choice.
      if (signal.pathForms.length > 1) {
        disagreements.push({
          step: name,
          kind: 'pathForm',
          detail: `${where}: FileMaker printed ${signal.pathForms.sort().join(' and ')} across examples; took ${signal.segment.pathForm}`,
        });
      }
      // The owner's file-option ruling failed on a placement. Loud, because the rule
      // is applied to every file option on his authority and this is the only thing
      // that can show it is wrong somewhere.
      if (signal.fileNameDisagrees > 0) {
        disagreements.push({
          step: name,
          kind: 'fileNameRuleFails',
          detail: `${where}: ${signal.fileNameDisagrees} placement(s) show more than the file name, against the ruling; took ${signal.segment.pathForm ?? 'no path rule'}`,
        });
      }
      if (signal.setMemberNote) {
        disagreements.push({
          step: name,
          kind: 'setMemberUndecided',
          detail: `${where}: ${signal.setMemberNote}, so no member was recorded for it`,
        });
      }
      // The key rendered nothing while holding a value that is not a code. That is
      // an option suppressed by STATE, which `omittedValues` deliberately cannot
      // express — said out loud so the gap is visible rather than filtered away.
      if (signal.omittedCalcs > 0) {
        disagreements.push({
          step: name,
          kind: 'omittedByState',
          detail: `${where}: ${signal.omittedCalcs} value(s) rendered nowhere and are not codes, so the omission is not a property of the value`,
        });
      }
    }
    for (const item of contradicted) {
      disagreements.push({
        step: name,
        kind: 'orderAttestationContradicted',
        detail: `${item.keys.join(' before ')} is externally attested but these examples show the opposite (${item.ab} / ${item.ba}); the DATA wins and the attestation is not applied`,
      });
    }

    if (displayNames.size > 1) {
      disagreements.push({
        step: name,
        kind: 'displayName',
        detail: [...displayNames.entries()].map(([value, count]) => `${JSON.stringify(value)} x${count}`).join(', '),
      });
    }
    for (const conflict of conflicts) {
      disagreements.push({
        step: name,
        kind: 'keyOrderConflict',
        detail: `${conflict.a} before ${conflict.b} in ${conflict.ab} example(s), after it in ${conflict.ba} -> took ${conflict.first} first`,
      });
    }
    if (cycles.length > 0) {
      disagreements.push({
        step: name,
        kind: 'keyOrderCycle',
        detail: `precedence is circular across examples; freed ${cycles.join(', ')} to break it`,
      });
    }
    if (unmeasured.length > 0) {
      const shown = unmeasured.slice(0, 6).map(([a, b]) => `${a}/${b}`).join(', ');
      disagreements.push({
        step: name,
        kind: 'keyOrderUnmeasured',
        detail: `${unmeasured.length} key pair(s) never appeared in one line, so their relative order is inferred from mean position, not observed: ${shown}${unmeasured.length > 6 ? ', …' : ''}`,
      });
    }
    for (const signal of signals) {
      const segment = signal.segment;
      const placements = entry.keys.get(signal.id);
      for (const doubt of segment.doubts ?? []) {
        if (doubt === 'singleExample') continue; // counted, and visible on the segment
        disagreements.push({
          step: name,
          kind: doubt,
          detail: `${segment.key}: ${describeDoubt(doubt, segment, placements, signal)}`,
        });
      }
    }
  }
  return { catalog, disagreements, rejected, dispositions };
}

function describeDoubt(doubt, segment, placements, signal) {
  if (doubt === 'renderDisagreement') {
    return [...countBy(placements, (placement) => placement.render).entries()]
      .map(([render, count]) => `${render} x${count}`)
      .join(', ') + ` -> took ${segment.render}`;
  }
  if (doubt === 'labelDisagreement') {
    return [...countBy(placements, (placement) => placement.label).entries()]
      .map(([label, count]) => `${JSON.stringify(label)} x${count}`)
      .join(', ') + ` -> took ${JSON.stringify(segment.label ?? null)}`;
  }
  if (doubt === 'valueCollision') {
    const byText = new Map();
    for (const placement of placements) {
      if (placement.value === null) continue;
      if (!byText.has(placement.text)) byText.set(placement.text, new Set());
      byText.get(placement.text).add(placement.value);
    }
    return [...byText.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([text, values]) => `${[...values].join(' / ')} all render as ${JSON.stringify(text)}`)
      .join('; ');
  }
  if (doubt === 'valueNotFunctional') {
    return signal.collisions
      .map((item) => `${JSON.stringify(item.value)} renders as ${item.texts.map((text) => JSON.stringify(text)).join(' AND ')}`)
      .join('; ');
  }
  if (doubt === 'rejectedMapping') {
    return signal.rejected
      .map((item) => `${JSON.stringify(item.value)} -> ${JSON.stringify(item.text)} is not a code -> display-name pair`)
      .join('; ');
  }
  if (doubt === 'thinMapping') {
    return `every display form rests on one example, and the placement was inferred (${segment.attribution})`;
  }
  if (doubt === 'singleValueOnly') {
    const value = placements.find((placement) => placement.value !== null)?.value ?? '';
    return `all ${placements.length} examples carry one value (${JSON.stringify(value).slice(0, 40)}), so the recurrence is one observation repeated`;
  }
  if (doubt === 'labelCollision') return `label ${JSON.stringify(segment.label)} is shared with another key`;
  if (doubt === 'mismatch') return `FileMaker's text is not derivable from the CLI's value`;
  return doubt;
}

/** The fields `src/step-display/step-display-types.ts` declares. A JSON import
 *  widens string literals, so tsc cannot check the emitted catalog against the
 *  type; this does, structurally, and fails the run rather than committing a
 *  catalog the type does not describe. */
const ENTRY_FIELDS = new Set([
  'displayName',
  'displayNameUnverifiable',
  'emptyBrackets',
  'commentStyle',
  'segments',
  'ignored',
  'unresolved',
  'attestedOrder',
  'derivedFrom',
  'residual',
  'verified',
]);
const SEGMENT_FIELDS = new Set([
  'key',
  'slot',
  'render',
  'label',
  'labelWhen',
  'suffixOf',
  'inlineOf',
  'quoted',
  'pathForm',
  'values',
  'whenAbsent',
  'omittedValues',
  'hiddenWhen',
  'examples',
  'attribution',
  'confidence',
  'doubts',
]);
const PATH_FORMS = ['schemeStripped', 'fileName'];
const IGNORED_FIELDS = new Set(['key', 'slot', 'examples', 'confidence', 'doubts', 'attestation']);
const RESIDUAL_FIELDS = new Set(['opaque', 'unreported', 'unattributed']);
const DOUBTS = new Set([
  'singleExample',
  'valueCollision',
  'valueNotFunctional',
  'labelCollision',
  'renderDisagreement',
  'labelDisagreement',
  'rejectedMapping',
  'thinMapping',
  'singleValueOnly',
  'mismatch',
  'conditionalLabelThin',
  'presenceGroupTie',
]);
const IGNORED_DOUBTS = new Set(['singleExample', 'withdrawalDependent']);
const UNRESOLVED_FIELDS = new Set(['key', 'slot', 'cause', 'observations', 'refutedBy']);
const UNRESOLVED_CAUSES = ['withdrawn', 'refuted', 'opaqueMetadata', 'labelOwnedElsewhere'];
const REFUTATIONS = ['insideAnotherOption', 'inUnattributedContent', 'displayedUnderAnotherKey'];

/** The types file declares three closed vocabularies that this script also holds as
 *  runtime lists. Keeping them in step was a hand job under a comment claiming a
 *  machine did it — so here is the machine: the union members are read out of the
 *  `.ts` source and compared. A union and an array cannot be compared by the type
 *  system across a `.mjs` boundary, and this catalog's whole standard is that a
 *  claimed check exists. */
function assertUnionsMatch() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'step-display', 'step-display-types.ts'), 'utf8');
  const union = (name) => {
    const declaration = new RegExp(`export type ${name} =([^;]*);`).exec(source);
    if (!declaration) throw new Error(`step-display-types.ts declares no ${name}`);
    return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  };
  const same = (a, b) => a.length === b.length && a.every((value, at) => value === b[at]);
  const checks = [
    ['StepRenderKind', union('StepRenderKind'), RENDER_KINDS],
    ['StepSegmentDoubt', union('StepSegmentDoubt'), [...DOUBTS]],
    ['StepSegmentAttribution', union('StepSegmentAttribution'), ATTRIBUTION_ORDER],
    ['StepIgnoredDoubt', union('StepIgnoredDoubt'), [...IGNORED_DOUBTS]],
    ['StepUnresolvedCause', union('StepUnresolvedCause'), UNRESOLVED_CAUSES],
    ['StepRefutation', union('StepRefutation'), REFUTATIONS],
  ];
  for (const [name, declared, runtime] of checks) {
    if (!same(declared, runtime)) {
      throw new Error(
        `${name} in step-display-types.ts does not match this script's list, in members or order:\n` +
          `  types:  ${declared.join(', ')}\n  script: ${runtime.join(', ')}`,
      );
    }
  }
}

/** A withdrawal that matches nothing is a stale claim about the matcher, and this
 *  file's standard forbids exactly that. Generalising the suffix rule silently
 *  retired one (`sliding window variable repetition -> Web Viewer`, which the
 *  matcher no longer produces); without this it would have sat in the table looking
 *  like a live finding. */
function assertWithdrawalsUsed(withdrawn) {
  for (const group of WITHDRAWN_FACTS) {
    for (const fact of group.facts) {
      const used = withdrawn.some(
        (item) =>
          item.step === group.step &&
          item.key === fact.key &&
          item.label === fact.label &&
          (fact.text === undefined || fact.text === item.text),
      );
      if (!used) {
        throw new Error(
          `WITHDRAWN_FACTS: ${group.step} | ${fact.key} -> ${JSON.stringify(fact.label)}` +
            `${fact.text === undefined ? '' : ` = ${JSON.stringify(fact.text)}`} matched nothing; ` +
            'the matcher no longer produces it, so the withdrawal is stale',
        );
      }
    }
  }
}

/** A hand-stated `hiddenWhen` is only as good as its verification, so here it is,
 *  against every example rather than against the catalog it produced:
 *
 *   - at least one example must report both keys and show nothing for the hidden
 *     one, or the rule describes nothing;
 *   - NO example may report both and show the hidden one anyway, which would
 *     disprove the rule outright.
 *
 *  Without this, a hand-written table is a claim about the data that nothing
 *  checks — the exact failure `assertWithdrawalsUsed` exists to prevent for
 *  withdrawals. */
function assertHiddenWhen(collected) {
  for (const rule of HIDDEN_RULES) {
    const examples = collected.observations.filter(
      (observation) => observation.name === rule.step && !observation.opaqueStep,
    );
    const both = examples.filter(
      (observation) =>
        Object.hasOwn(observation.step, rule.key) && Object.hasOwn(observation.step, rule.keyPresent),
    );
    // Against the KEPT placements, not the matcher's raw output: a withdrawn
    // placement is one this catalog states is false, and letting it disprove a rule
    // would be treating a fact and its withdrawal as both true.
    const shown = both.filter((observation) =>
      observation.kept.some((segment) => segment.key === rule.key),
    );
    if (shown.length > 0) {
      throw new Error(
        `HIDDEN_WHEN: ${rule.step} | ${rule.key} is displayed in ${shown.length} example(s) that also ` +
          `report ${rule.keyPresent}, so the rule is disproved`,
      );
    }
    if (both.length === 0) {
      throw new Error(
        `HIDDEN_WHEN: ${rule.step} | ${rule.key} and ${rule.keyPresent} never appear together, so the ` +
          'rule describes nothing in this data',
      );
    }
  }
}

function assertShape(catalog) {
  const kinds = new Set(RENDER_KINDS);
  const bad = (where, message) => {
    throw new Error(`${where}: ${message}`);
  };
  // A key IDENTIFIES a fact only together with its slot: `slots` is one key holding
  // several values, so `key` alone made every slot of a step look like the same one
  // and the duplicate checks below fired on their first run.
  const refID = (item) =>
    item.slot === undefined ? item.key : `${item.key}.${item.slot.member}${item.slot.number === undefined ? '' : `.${item.slot.number}`}`;
  const checkSlot = (where, item) => {
    if (item.slot === undefined) return;
    if (item.key !== 'slots') bad(where, `a slot reference on key ${item.key}, which is not slots`);
    if (typeof item.slot.member !== 'string' || item.slot.member === '') bad(where, 'a slot with no member');
    if (item.slot.number !== undefined && typeof item.slot.number !== 'string') {
      bad(where, 'a slot number that is not the CLI\'s own string key');
    }
    for (const field of Object.keys(item.slot)) {
      if (field !== 'member' && field !== 'number') bad(where, `unknown slot field ${field}`);
    }
  };
  for (const [name, entry] of Object.entries(catalog)) {
    for (const field of Object.keys(entry)) {
      if (!ENTRY_FIELDS.has(field)) bad(name, `unknown entry field ${field}`);
    }
    if (typeof entry.derivedFrom !== 'number' || entry.derivedFrom < 1) bad(name, 'missing derivedFrom');
    if (entry.verified !== false) bad(name, 'verified must be false until Task 4 runs the round-trip');
    for (const field of Object.keys(entry.residual ?? {})) {
      if (!RESIDUAL_FIELDS.has(field)) bad(name, `unknown residual cause ${field}`);
    }
    for (const segment of entry.segments) {
      const where = `${name}.${refID(segment)}`;
      for (const field of Object.keys(segment)) {
        if (!SEGMENT_FIELDS.has(field)) bad(where, `unknown segment field ${field}`);
      }
      checkSlot(where, segment);
      if (segment.labelWhen) {
        if (typeof segment.labelWhen.key !== 'string') bad(where, 'labelWhen without a deciding key');
        if (Object.keys(segment.labelWhen.labels ?? {}).length < 2) {
          bad(where, 'labelWhen with fewer than two labels, which decides nothing');
        }
        // A conditional label whose fixed label is not among the conditional ones
        // would make the fallback print something no example showed.
        if (!Object.values(segment.labelWhen.labels).includes(segment.label)) {
          bad(where, 'labelWhen does not include the segment\'s own label');
        }
      }
      if (segment.whenAbsent?.flagBit !== undefined) {
        const bit = segment.whenAbsent.flagBit;
        if (!Number.isInteger(bit) || bit <= 0 || (bit & (bit - 1)) !== 0) {
          bad(where, `flagBit ${bit} is not a single bit`);
        }
      }
      if (!kinds.has(segment.render)) bad(where, `unknown render ${segment.render}`);
      if (typeof segment.examples !== 'number' || segment.examples < 1) bad(where, 'missing evidence count');
      // THE INVARIANT. No fact can rest on more examples than the step type has.
      // A count that breaks it is not a wrong number, it is an impossible one, and
      // the shipped catalog carried 12 of them: `Import Records | opaque` claimed 76
      // examples of a 38-example step, because one counter was incremented on two
      // paths. Bounding from below caught nothing; this is the bound that makes the
      // whole class unshippable rather than the 15 instances fixable.
      if (segment.examples > entry.derivedFrom) {
        bad(where, `${segment.examples} examples on a step type with only ${entry.derivedFrom}`);
      }
      if (!ATTRIBUTION_ORDER.includes(segment.attribution)) bad(where, `unknown attribution ${segment.attribution}`);
      if (segment.confidence !== 'measured' && segment.confidence !== 'low') bad(where, 'unknown confidence');
      if ((segment.confidence === 'low') !== Boolean(segment.doubts)) bad(where, 'confidence and doubts disagree');
      for (const doubt of segment.doubts ?? []) if (!DOUBTS.has(doubt)) bad(where, `unknown doubt ${doubt}`);
      // Ruling: a masked value must not reach this file by ANY route.
      if (segment.render === 'masked' && segment.values) bad(where, 'a masked key must never carry values');
      if (segment.pathForm && !PATH_FORMS.includes(segment.pathForm)) bad(where, `unknown pathForm ${segment.pathForm}`);
      if (segment.whenAbsent) {
        if (typeof segment.whenAbsent.text !== 'string') bad(where, 'whenAbsent without a text');
        if (!(segment.whenAbsent.examples > 0)) bad(where, 'whenAbsent without evidence');
        if (segment.whenAbsent.examples > entry.derivedFrom) {
          bad(where, `${segment.whenAbsent.examples} whenAbsent examples on a step type with only ${entry.derivedFrom}`);
        }
      }
      // An omitted value that some example DID render would be a contradiction, and
      // it is the one way this field could silence a true option — so the invariant
      // is asserted here rather than left to the filter that enforces it.
      for (const value of segment.omittedValues ?? []) {
        if (segment.values && Object.hasOwn(segment.values, value)) {
          bad(where, `${value} is listed as never printed and as having a display form`);
        }
      }
      if (segment.hiddenWhen) {
        const named = refID({ key: segment.hiddenWhen.keyPresent, slot: segment.hiddenWhen.slot });
        const known =
          entry.segments.some((other) => refID(other) === named) ||
          entry.ignored.some((item) => refID(item) === named) ||
          (entry.unresolved ?? []).some((item) => refID(item) === named);
        if (!known) bad(where, `hiddenWhen names ${named}, which this step type never reports`);
        if ((segment.hiddenWhen.keyPresent === 'slots') !== (segment.hiddenWhen.slot !== undefined)) {
          bad(where, 'hiddenWhen must carry a slot reference exactly when its key is `slots`');
        }
      }
    }
    // A key may hold TWO segments only when one of them is the `keyPresence` option
    // its presence decides — `Perform Script | script name` prints `Specified: By
    // name` and the calculation. Any other duplicate is two facts about one key and
    // a renderer would print both.
    const byKey = new Map();
    for (const segment of entry.segments) {
      const id = refID(segment);
      if (!byKey.has(id)) byKey.set(id, []);
      byKey.get(id).push(segment);
    }
    for (const [key, list] of byKey) {
      if (list.length === 1) continue;
      const presence = list.filter((segment) => segment.render === 'keyPresence').length;
      if (list.length !== 2 || presence !== 1) {
        bad(`${name}.${key}`, `${list.length} segments for one key, ${presence} of them keyPresence`);
      }
    }
    // `ignored` is the boldest claim here, so it is checked as hard as a segment.
    const ignoredNames = new Set();
    for (const item of entry.ignored) {
      const where = `${name}.ignored.${refID(item)}`;
      for (const field of Object.keys(item)) {
        if (!IGNORED_FIELDS.has(field)) bad(where, `unknown ignored field ${field}`);
      }
      checkSlot(where, item);
      if (typeof item.examples !== 'number' || item.examples < 1) bad(where, 'missing evidence count');
      // The same invariant, on the field where it was broken.
      if (item.examples > entry.derivedFrom) {
        bad(where, `${item.examples} examples on a step type with only ${entry.derivedFrom}`);
      }
      if (item.confidence !== 'measured' && item.confidence !== 'low') bad(where, 'unknown confidence');
      if ((item.confidence === 'low') !== Boolean(item.doubts)) bad(where, 'confidence and doubts disagree');
      for (const doubt of item.doubts ?? []) if (!IGNORED_DOUBTS.has(doubt)) bad(where, `unknown doubt ${doubt}`);
      // An attestation is a source, so it must BE one, and it must not sit beside the doubt it
      // exists to answer — a claim reading both `withdrawalDependent` and "externally attested"
      // says two different things about where its confidence comes from.
      if (item.attestation !== undefined) {
        if (typeof item.attestation !== 'string' || item.attestation.trim() === '') {
          bad(where, 'attestation with no source named');
        }
        if ((item.doubts ?? []).includes('withdrawalDependent')) {
          bad(where, 'attested and withdrawalDependent at once');
        }
      }
      if (ignoredNames.has(refID(item))) bad(where, 'listed twice');
      if (entry.segments.some((segment) => refID(segment) === refID(item))) bad(where, 'is both placed and ignored');
      ignoredNames.add(refID(item));
    }
    // A key is EITHER never shown (`ignored`) or unsettled (`unresolved`), never
    // both: the two lists are different claims. This is a REGRESSION GUARD on the
    // filter that builds `unresolved`, not a discovery — that filter already
    // excludes both cases, so the clause cannot fire against today's constructor,
    // and it exists so a future edit to the filter fails loudly instead of blurring
    // the two claims.
    for (const item of entry.unresolved ?? []) {
      const where = `${name}.unresolved.${refID(item)}`;
      for (const field of Object.keys(item)) {
        if (!UNRESOLVED_FIELDS.has(field)) bad(where, `unknown unresolved field ${field}`);
      }
      checkSlot(where, item);
      if (!UNRESOLVED_CAUSES.includes(item.cause)) bad(where, `unknown cause ${item.cause}`);
      // A refuted key must say what refuted it and how much was set aside; any other
      // cause must not, or the reason field becomes decoration.
      if ((item.cause === 'refuted') !== Boolean(item.refutedBy)) bad(where, 'cause and refutedBy disagree');
      if (Boolean(item.refutedBy) !== Boolean(item.observations)) bad(where, 'refutedBy without a count');
      for (const rule of item.refutedBy ?? []) if (!REFUTATIONS.includes(rule)) bad(where, `unknown refutation ${rule}`);
      if (item.refutedBy && item.refutedBy.length > item.observations) bad(where, 'more rules than observations');
      if (ignoredNames.has(refID(item))) bad(name, `${refID(item)} is both ignored and unresolved`);
      if (entry.segments.some((segment) => refID(segment) === refID(item))) {
        bad(name, `${refID(item)} is both placed and unresolved`);
      }
    }
    // An attested order must name keys this entry actually has, or it is a stale
    // hand-written table quietly doing nothing.
    for (const item of entry.attestedOrder ?? []) {
      const keys = entry.segments.map((segment) => segment.key);
      if (!item.keys.every((key) => keys.includes(key))) bad(name, `attested order names an absent key: ${item.keys.join(', ')}`);
      if (keys.indexOf(item.keys[0]) > keys.indexOf(item.keys[1])) bad(name, 'attested order was not applied');
      if (!item.source) bad(name, 'an attested order must cite its source');
    }
  }
}

/** Characters that only the owner's script content carries, in this data and in
 *  FileMaker generally: a variable sigil, a field reference's `::`, the password
 *  mask, and the curly or straight quotes FileMaker wraps a NAMED OBJECT in — a
 *  layout, table, script or window the owner named.
 *
 *  **Where this is load-bearing, and where it is not.** On a value's display text
 *  and on a label it adds nothing: `DISPLAY_PHRASE` here and `LABEL_SHAPE` in the
 *  matcher already exclude every glyph below. Its value is on the fields with no
 *  filter at all — entry names, `displayName`, the CLI's own key names, `suffixOf`,
 *  and hand-written prose like an attestation source — and that is exactly where it
 *  fired first, on my own prose. The point is to make "no owner content" a property
 *  the run enforces rather than one a reviewer re-establishes each round.
 *
 *  **What it does NOT close.** An unquoted owner object name read off the line as a
 *  label (`Set Field [ Kunden: $x ]` -> label `Kunden`) or as an enum display text
 *  against a code-shaped value passes both this and `DISPLAY_PHRASE`. Those two
 *  holes are real, they are not what this closes, and this comment used to claim
 *  otherwise. Closing them needs a different instrument — a check against the
 *  file's own schema, which this derivation does not read.
 *
 *  If a real FileMaker display phrase ever trips this, allow that exact phrase
 *  here with the raw-text line that proves it is FileMaker's, and leave the rest
 *  of the rule alone.
 *
 *  **THE ONE ARGUMENT THAT MUST NOT BE ACCEPTED FOR WEAKENING THIS.** The repo now
 *  publishes the owner's raw data on purpose: `fm_scripts/*.adt.json` and
 *  `fm_scripts/*.txt` carry his tables, fields, layouts, script names and two hosts,
 *  because he ruled that an auditable catalog is worth it. That authorisation is
 *  about THOSE FILES and nothing else. Two different things:
 *
 *   - **Data we deliberately publish** — a verbatim, read-only copy of two scripts,
 *     in one directory, with a README saying so. Its owner content is the point of
 *     it: remove it and the catalog cannot be re-derived or re-measured by anybody.
 *   - **Content that leaked into something meant to be general** — this catalog, the
 *     renderer, a script's prose, a test. `src/catalogs/fm-step-display.json` is
 *     consumed by this app, by other tools and by agents' contexts, and a table name
 *     that reached it would be published as though it were part of FileMaker's step
 *     syntax. That is what this check is for, and it is exactly as necessary now as
 *     it was before the data was committed.
 *
 *  So "the repo already ships his schema" is not a reason to allow an entry here. It
 *  is the reason the boundary needs stating: this assertion is the boundary. */
const OWNER_CONTENT = /[$•“”"]|::/;

/** Every string the catalog emits, by role, so the assertion cannot miss one. */
function* emittedStrings(catalog) {
  for (const [name, entry] of Object.entries(catalog)) {
    yield [`entry name`, name, name];
    if (entry.displayName) yield [`${name}.displayName`, entry.displayName, name];
    for (const item of entry.ignored) yield [`${name}.ignored`, item.key, name];
    for (const item of entry.unresolved ?? []) yield [`${name}.unresolved`, item.key, name];
    for (const item of entry.attestedOrder ?? []) {
      for (const key of item.keys) yield [`${name}.attestedOrder.keys`, key, name];
      yield [`${name}.attestedOrder.source`, item.source, name];
    }
    for (const item of entry.ignored) {
      if (item.slot) yield [`${name}.ignored.slot`, item.slot.member, name];
      if (item.attestation) yield [`${name}.ignored.attestation`, item.attestation, name];
    }
    for (const segment of entry.segments) {
      yield [`${name}.${segment.key}`, segment.key, name];
      if (segment.slot) yield [`${name}.slot.member`, segment.slot.member, name];
      if (segment.label) yield [`${name}.${segment.key}.label`, segment.label, name];
      if (segment.suffixOf) yield [`${name}.${segment.key}.suffixOf`, segment.suffixOf, name];
      if (segment.inlineOf) yield [`${name}.${segment.key}.inlineOf`, segment.inlineOf, name];
      if (segment.labelWhen) {
        yield [`${name}.${segment.key}.labelWhen.key`, segment.labelWhen.key, name];
        for (const [state, label] of Object.entries(segment.labelWhen.labels)) {
          yield [`${name}.${segment.key}.labelWhen state`, state, name];
          yield [`${name}.${segment.key}.labelWhen label`, label, name];
        }
      }
      if (segment.whenAbsent) yield [`${name}.${segment.key}.whenAbsent`, segment.whenAbsent.text, name];
      if (segment.hiddenWhen) yield [`${name}.${segment.key}.hiddenWhen`, segment.hiddenWhen.keyPresent, name];
      for (const value of segment.omittedValues ?? []) {
        yield [`${name}.${segment.key}.omittedValues`, value, name];
      }
      for (const [value, text] of Object.entries(segment.values ?? {})) {
        yield [`${name}.${segment.key}.values key`, value, name];
        yield [`${name}.${segment.key}.values text`, text, name];
      }
    }
  }
}

/** THE BOUNDARY between the data this repo publishes and the artifact it ships.
 *
 *  It reads every string the CATALOG emits — not the repo's files. `fm_scripts/` holds
 *  the owner's own scripts verbatim, with his authorisation and by design; this fails
 *  the derivation if one token of that data reaches
 *  `src/catalogs/fm-step-display.json`, which is meant to describe FileMaker's step
 *  syntax and nothing about his file. See `OWNER_CONTENT` for why the first fact is
 *  not an argument against the second. */
function assertNoOwnerContent(catalog) {
  for (const [where, text, ] of emittedStrings(catalog)) {
    const hit = OWNER_CONTENT.exec(text);
    if (hit) throw new Error(`${where}: ${JSON.stringify(text)} carries ${JSON.stringify(hit[0])}, which only owner content uses`);
  }
}

function report(collected, catalog, disagreements, rejected, dispositions) {
  const entries = Object.entries(catalog);
  const segments = entries.flatMap(([name, entry]) => entry.segments.map((segment) => ({ name, ...segment })));
  const low = segments.filter((segment) => segment.confidence === 'low');
  const doubtCounts = countBy(low.flatMap((segment) => segment.doubts), (doubt) => doubt);
  const attributionCounts = countBy(segments, (segment) => segment.attribution);
  const kindCounts = countBy(segments, (segment) => segment.render);
  const residualTotals = { opaque: 0, unreported: 0, unattributed: 0 };
  for (const [, entry] of entries) {
    for (const [cause, count] of Object.entries(entry.residual ?? {})) residualTotals[cause] += count;
  }

  const say = (text = '') => console.log(text);
  say('== sources ==');
  for (const source of SOURCES) say(`  script ${source.id}: ${source.body} + ${path.relative(ROOT, source.text)}`);
  say(`  pairs: ${collected.pairCount}    alignment failures: ${collected.failures.length}`);
  for (const failure of collected.failures) {
    say(`    FAILED script ${failure.script} step ${failure.index + 1} ${failure.step}: ${failure.reason}`);
  }

  say();
  say('== catalog ==');
  say(`  step types (entries): ${entries.length}`);
  say(`  entries with at least one segment: ${entries.filter(([, entry]) => entry.segments.length > 0).length}`);
  say(`  segments: ${segments.length}    measured: ${segments.length - low.length}    low confidence: ${low.length}`);
  say(`  render kinds: ${[...kindCounts.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join(' | ')}`);
  say(`  strongest attribution: ${[...attributionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join(' | ')}`);
  say(`  doubts: ${[...doubtCounts.entries()].sort((a, b) => b[1] - a[1]).map(([doubt, count]) => `${doubt} ${count}`).join(' | ')}`);
  const mapped = segments.filter((segment) => segment.values);
  const needsMap = segments.filter((segment) => VALUE_MAP_KINDS.has(segment.render));
  say(`  value -> display-form maps: ${mapped.length} segments, ${mapped.reduce((sum, segment) => sum + Object.keys(segment.values).length, 0)} mappings`);
  say(`  segments needing a map that have none: ${needsMap.length - mapped.length} (rejected mappings: ${rejected.length})`);
  say(`  segments carrying quoted: ${segments.filter((segment) => segment.quoted).length}`);
  // The facts the owner's rulings added, counted so the run says what it derived.
  const withField = (name) => segments.filter((segment) => segment[name] !== undefined).length;
  say(
    `  presentation facts: whenAbsent ${withField('whenAbsent')} | omittedValues ${withField('omittedValues')}` +
      ` | pathForm ${withField('pathForm')} | hiddenWhen ${withField('hiddenWhen')}` +
      ` | keyPresence options ${segments.filter((segment) => segment.render === 'keyPresence').length}` +
      ` | step types printing empty brackets ${entries.filter(([, entry]) => entry.emptyBrackets).length}`,
  );
  const ignoredAll = entries.flatMap(([name, entry]) => entry.ignored.map((item) => ({ name, ...item })));
  const ignoredLow = ignoredAll.filter((item) => item.confidence === 'low');
  const ignoredDoubts = countBy(ignoredLow.flatMap((item) => item.doubts), (doubt) => doubt);
  say(`  ignored keys: ${ignoredAll.length}    measured: ${ignoredAll.length - ignoredLow.length}    low: ${ignoredLow.length}`);
  say(`  ignored doubts: ${[...ignoredDoubts.entries()].sort((a, b) => b[1] - a[1]).map(([doubt, count]) => `${doubt} ${count}`).join(' | ')}`);
  const refutations = countBy(collected.contradictedIgnores, (item) => item.reason);
  say(`  ignored observations refuted by the line: ${collected.contradictedIgnores.length} (${[...refutations.entries()].map(([reason, count]) => `${reason} ${count}`).join(' | ')})`);
  say(`  unresolved keys (withdrawn, refuted or opaque metadata): ${entries.reduce((sum, [, entry]) => sum + (entry.unresolved?.length ?? 0), 0)}`);
  say(`  externally attested orderings: ${entries.reduce((sum, [, entry]) => sum + (entry.attestedOrder?.length ?? 0), 0)}`);
  say(`  examples by residual cause: opaque ${residualTotals.opaque} | unreported ${residualTotals.unreported} | unattributed ${residualTotals.unattributed} (total ${residualTotals.opaque + residualTotals.unreported + residualTotals.unattributed})`);

  say();
  say('== per step type (name | derivedFrom | segments | low | residual) ==');
  for (const [name, entry] of entries) {
    const lowHere = entry.segments.filter((segment) => segment.confidence === 'low').length;
    const residual = Object.entries(entry.residual ?? {}).map(([cause, count]) => `${cause}:${count}`).join(' ');
    say(`  ${name} | ${entry.derivedFrom} | ${entry.segments.length} | ${lowHere} | ${residual}`);
  }

  say();
  say(`== disagreements (${disagreements.length}) ==`);
  for (const item of disagreements) say(`  ${item.step} [${item.kind}] ${item.detail}`);

  say();
  say(`== single-example segments (${segments.filter((segment) => segment.examples === 1).length}) ==`);
  for (const segment of segments.filter((item) => item.examples === 1)) {
    say(`  ${segment.name} | ${segment.key} -> ${JSON.stringify(segment.label ?? null)} (${segment.render}, ${segment.attribution})`);
  }

  say();
  const soleOnly = segments.filter((segment) => segment.attribution === 'sole');
  say(`== facts whose only evidence is counting ('sole') (${soleOnly.length}) ==`);
  for (const segment of soleOnly) {
    say(`  ${segment.name} | ${segment.key} -> ${JSON.stringify(segment.label ?? null)} (${segment.render}, ${segment.confidence}${segment.doubts ? `: ${segment.doubts.join(',')}` : ''}, ${segment.examples} example${segment.examples === 1 ? '' : 's'})`);
  }

  say();
  const bySignal = (doubt) => segments.filter((segment) => (segment.doubts ?? []).includes(doubt));
  for (const doubt of ['valueNotFunctional', 'rejectedMapping', 'thinMapping', 'singleValueOnly']) {
    const hits = bySignal(doubt);
    say(`== ${doubt}: the derivation's own falsification signals (${hits.length}) ==`);
    for (const segment of hits) {
      say(`  ${segment.name} | ${segment.key} (${segment.render}, ${segment.attribution}, ${segment.examples} examples)`);
    }
    say();
  }

  say(`== rejected value mappings (${rejected.length}) ==`);
  for (const item of rejected) {
    say(`  ${item.step} | ${item.key}: ${JSON.stringify(item.value).slice(0, 40)} -> ${JSON.stringify(item.text).slice(0, 60)}`);
  }

  say();
  say(`== matches dropped on opaque steps (${collected.opaqueDrops.length}) ==`);
  for (const item of collected.opaqueDrops) {
    say(`  ${item.step} | ${item.key} (script ${item.script} step ${item.index}) — CLI metadata, not a displayed option`);
  }

  say();
  say(`== withdrawn facts (${collected.withdrawn.length} placements) ==`);
  for (const item of collected.withdrawn) {
    say(`  ${item.step} | ${item.key} -> ${JSON.stringify(item.label)} = ${JSON.stringify(item.text)} (script ${item.script} step ${item.index})`);
    say(`      ${item.reason}`);
  }

  say();
  say(`== ignored observations REFUTED by the line itself (${collected.contradictedIgnores.length}) ==`);
  for (const item of collected.contradictedIgnores) {
    say(`  ${item.step} | ${item.key} (script ${item.script} step ${item.index}) [${item.reason}] ${item.detail} — 'never shown' is not assertable from this example`);
  }

  say();
  say(`== where each withdrawn key ended up (${dispositions.length}) ==`);
  for (const item of dispositions) {
    say(`  ${item.step} | ${item.key} -> ${item.where} (${item.independentIgnored} of ${item.reported} examples report it and do not show it, independently of the withdrawal)`);
  }

  say();
  say(`== unmatched segments (${collected.unmatchedReport.length}) ==`);
  for (const item of collected.unmatchedReport) {
    say(`  [${item.cause}] ${item.step} (script ${item.script} step ${item.index}) ${JSON.stringify(item.text)}`);
    if (item.leftoverKeys.length > 0) say(`      keys still unplaced: ${item.leftoverKeys.join(', ')}`);
  }
}

const sources = readSources();
const collected = collect(sources);
// The presentation pass runs between collection and derivation: it needs the
// labels collection produces, and the order derivation needs what it finds.
// The suppression rules the data supports, added to the hand-stated ones BEFORE the
// derivation reads the table, and verified beside them by `assertHiddenWhen`.
const labelRivals = withdrawCountedLabelRivals(collected);
const hiddenWhenFound = deriveHiddenWhen(collected);
HIDDEN_RULES.push(...hiddenWhenFound.found);
const presentationNotes = [
  ...labelRivals.map((item) => ({
    step: item.step,
    kind: 'countedLabelRival',
    detail:
      `${item.id}: its only evidence was counting (\`sole\`) and its label ${JSON.stringify(item.label)} is ` +
      `${item.rival}'s, which the line anchors — so its ${item.placements} placement(s) are WITHDRAWN, not demoted, ` +
      'and the option goes back to the passes that can explain it',
  })),
  ...measurePresentation(collected),
  ...hiddenWhenFound.notes,
];
const { catalog, disagreements, rejected, dispositions } = derive(collected);
disagreements.push(...presentationNotes);
assertUnionsMatch();
assertShape(catalog);
assertNoOwnerContent(catalog);
assertWithdrawalsUsed(collected.withdrawn);
assertHiddenWhen(collected);
fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
report(collected, catalog, disagreements, rejected, dispositions);
console.log();
console.log(`wrote ${path.relative(ROOT, CATALOG_PATH)}`);
