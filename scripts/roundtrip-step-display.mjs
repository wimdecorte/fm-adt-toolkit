#!/usr/bin/env node
/** Round-trip `src/catalogs/fm-step-display.json` against FileMaker's own text.
 *
 *  Renders every one of the 1203 paired examples FROM THE CATALOG ALONE and
 *  compares the result with the line FileMaker's Script Workspace wrote for it.
 *  Nothing here consults `scripts/fm-segment-parse.mjs` to BUILD a line: the
 *  matcher's job was to derive the catalog, and rendering with it would test the
 *  matcher against itself. It is used only AFTER a comparison has failed, to say
 *  which of the derivation's residual causes the failure falls under.
 *
 *  **IT RENDERS WITH THE APP'S OWN RENDERER, `renderStepFromCatalog` in
 *  src/step-display/step-display-render.ts — imported, never copied.** That is the one
 *  structural rule of this file. A catalog-driven renderer living here as well would
 *  make all four counts below figures about code the read sheet does not run, and this
 *  project has already had the miniature of that bug: a helper whose docstring said it
 *  mirrored the derivation did mirror the function while being called with the wrong
 *  view, and 11 rows were filed as impossible because of it. When the duplicate was
 *  replaced by this import, all four counts and every byte of the HTML report stayed
 *  identical — which is what makes the swap checkable rather than asserted.
 *
 *  Node strips the types on import (22.18+), so no build step stands between this and
 *  the shipped source. It prints one MODULE_TYPELESS_PACKAGE_JSON warning on stderr,
 *  because package.json declares no module type and the app's main process needs it
 *  that way; `npm run roundtrip:step-display` runs this with the warning disabled.
 *
 *  Data provenance: the owner's `fmnet://localhost/Ooe`, READ ONLY and not opened
 *  here at all — both halves of every pair are committed in `fm_scripts/`, the CLI's
 *  as `<stem>.adt.json` and FileMaker's as `<stem>.txt` (see fm_scripts/README.md).
 *  This script issues no `fm` command.
 *
 *  **REPRODUCING THE COMMITTED CATALOG IS TWO COMMANDS, IN THIS ORDER:**
 *
 *      npm run derive:step-display      # writes the catalog, verified: false everywhere
 *      npm run roundtrip:step-display   # measures it, and fills in verified
 *
 *  Neither is optional and the order is not a preference: the derivation cannot know
 *  whether an entry round-trips, so it asserts `verified: false`, and only this run may set
 *  it. `derive` alone therefore leaves the tracked catalog dirty; the pair reproduces it
 *  byte for byte. **THIS SCRIPT WRITES TO `src/catalogs/fm-step-display.json`**, so running
 *  it just to read a number can dirty your tree the moment a verdict moves.
 *
 *  It also prints a summary and writes an HTML report for the repo owner. The report quotes his own script
 *  text, so it is written outside `src/` and is deliberately NOT committed; this
 *  script itself must contain none — see `OWNER_CONTENT` in
 *  scripts/derive-step-display.mjs for the standard. Every step name, label,
 *  value and line in the output is read from the data at run time.
 *
 *  THE SPEC FORBIDS ASSERTING A 100% MATCH and forbids one blended accuracy
 *  figure. FOUR counts are reported against one denominator and never averaged:
 *  exact, settled by one of the owner's rulings, still different, and not
 *  writable from what the CLI sends.
 *
 *  FOUR normalisations, and every operation that touches a compared string is one
 *  of them. Two are the design spec's (the marker, truncation). Two are the repo
 *  owner's explicit rulings, quoted at their sites (colon spacing, and spacing
 *  generally). Both of his are applied to BOTH sides and counted.
 *
 *  There were six for a while, and the two extra were the interesting failure: a
 *  whitespace-run collapse and a `.trim()` inside `normaliseCalc`, applied to our
 *  side only because that is the only side that passes a JSON value through it. An
 *  independent review found them. They are gone from this file — see `oneLine` in
 *  scripts/fm-script-align.mjs — and the lesson is in the shape rather than the
 *  size: a normalisation hidden inside another operation is not declared, and a
 *  one-sided one can only ever move rows toward matching.
 *
 *  It also fills in each entry's `verified`, which nothing else can know: the
 *  derivation emits `false` everywhere and asserts it stays false, so a re-derivation
 *  cannot claim a verification it did not perform. Running derive and then this is
 *  idempotent — see `writeVerified`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { alignSteps, DISPLAY_NAME_OVERRIDES, oneLine } from './fm-script-align.mjs';
import { matchSegments, displayKeys, expandSlots, isRepetitionKey } from './fm-segment-parse.mjs';
// THE APP'S OWN RENDERER, not a copy of it. See `renderFor` below for why this import
// is the point of the file rather than a convenience.
import {
  catalogEntry,
  renderStepFromCatalog,
  segmentID,
  stepConventions,
  STEP_MASK as MASK,
} from '../src/step-display/step-display-render.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'src', 'catalogs', 'fm-step-display.json');
const REPORT_PATH = path.join(
  ROOT,
  '.superpowers',
  'sdd',
  '2026-09-13-fm-step-display',
  'roundtrip.html',
);

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

/** `MASK` and `maskedKeysOf` are imported from the renderer the app runs, so the mask
 *  the report prints and the mask the read sheet prints cannot differ.
 *
 *  The claim `redactMasked` rests on, checked rather than trusted: no `masked` segment
 *  addresses a value inside the CLI's `slots` object. `maskedKeysOf` collects keys by
 *  name and a slot has none, so a masked slot would be silently unprotected — in the
 *  report here and in the app's rows both. */
function assertNoMaskedSlots(catalog) {
  for (const [name, entry] of Object.entries(catalog)) {
    for (const segment of entry.segments) {
      if (segment.render === 'masked' && segment.slot) {
        throw new Error(
          `${name}: a masked segment addresses ${segmentID(segment)}, which maskedKeysOf cannot ` +
            'collect by name — redactMasked would pass the secret through and the renderer would ' +
            'print it',
        );
      }
    }
  }
}

/** The step with every masked value replaced by the mask FileMaker itself shows, AT ANY
 *  DEPTH.
 *
 *  It was a shallow copy under a comment two lines below claiming "at any depth", which is
 *  the class of defect this branch has been called on five times. The report prints the
 *  whole step object, so a masked key nested inside another key's value would have been
 *  printed — nothing in this corpus nests one, and that is a fact about the corpus rather
 *  than a property of the code. Case-insensitive, for the same reason
 *  `conventions.isMaskedKey` is. */
function redactMasked(value, conventions, seen = new Set()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '(circular)';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactMasked(item, conventions, seen));
    const out = {};
    for (const [key, held] of Object.entries(value)) {
      out[key] = conventions.isMaskedKey(key) ? MASK : redactMasked(held, conventions, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** THE GUARANTEE, ASSERTED RATHER THAN CLAIMED. No masked value may appear in the data
 *  this run carries, on any row, at any depth — the report is built from these rows and
 *  nothing else, so a value that is not here cannot be printed.
 *
 *  A report asserting a protection that the code does not implement is worse than no
 *  claim at all, and that is what a review found. This is the difference between the
 *  two. */
function assertNoMaskedValues(rows, conventions) {
  const walk = (value, row, path, seen) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, held] of Object.entries(value)) {
      const here = `${path}.${key}`;
      if (conventions.isMaskedKey(key) && held !== MASK) {
        throw new Error(
          `script ${row.script} step ${row.index} (${row.step}) carries an unmasked value at ${here} for a ` +
            'masked key; the report is built from these rows, so it would have been printed',
        );
      }
      walk(held, row, here, seen);
    }
  };
  for (const row of rows) walk(row.json, row, 'step', new Set());
}

/** What the CLI writes into a calculation whose function it cannot resolve. Not a
 *  render kind and not owner content: it is the CLI's own placeholder, and whether
 *  FileMaker prints it too is a measurable fact this run reports. */
const FUNCTION_MISSING = '<Function Missing>';

// ---------------------------------------------------------------------------
// The normalisations: the two the spec names, and one the domain expert ruled
// ---------------------------------------------------------------------------

/** 1. The `➜🌍` a step that schedules a script for later carries. The owner
 *     confirms it is meaningless for our purposes and the catalog records it as
 *     deliberately not reproduced. FileMaker writes it as `] ➜🌍 ` with a
 *     trailing space, so removing the trailing run is part of removing the
 *     marker — and is applied ONLY when there is a marker. Applied
 *     unconditionally, that trim silently rewrote every comment line as well
 *     (a comment's own line ends in a space), which is a second normalisation
 *     smuggled in under the first. */
const MARKER = /\s*➜🌍\s*/gu;
const ELLIPSIS = '…';

function stripMarker(text) {
  if (!text.includes('➜🌍')) return text;
  return text.replace(MARKER, ' ').replace(/\s+$/, '');
}

/** 2. Truncation. FileMaker's rows are single-line so it cuts a long option with
 *     U+2026; we print the whole value because hiding data is worse.
 *
 *     `…` stands for "and the rest of this option", so the fragments either side
 *     of it must still appear, in order, with the first anchoring the start and
 *     the last the end. The spec words this as "where FileMaker's line ends in
 *     `…`, check the prefix" — which is one row short of the corpus: one line is
 *     truncated on a NON-FINAL option and still carries text after it. The
 *     generalisation is the same normalisation with the same justification, and
 *     the run counts final and non-final separately so the widening is visible
 *     rather than assumed. */
/** 3. Colon spacing, on BOTH sides — and the only normalisation here that the
 *     design spec does not name.
 *
 *     It is applied on the repo owner's explicit ruling, in his words:
 *
 *     > "I have never noticed but it is cosmetic, just always use 'label: value'
 *     > with no space after label."
 *
 *     He is the domain expert and the author of both scripts, so this is authority
 *     rather than a convenience: FileMaker itself writes all three of `Label:
 *     value`, `Object Name : "…"` and `Group Name:$…`, and he has ruled that we
 *     emit one form and do not reproduce his Workspace's variants. A comparison
 *     that then failed on the difference would be measuring the very thing he took
 *     out of scope, so both sides are normalised and the count changes as a result.
 *
 *     Five presentation rules were reported as findings rather than applied in the
 *     previous round precisely because the spec did not name them. This one is now
 *     ruled; the other four are implemented as catalog facts instead, which is why
 *     they are not here. `::` is preserved — a field reference is not a label. */
function normaliseColons(text) {
  // A colon followed by `/` is a URL scheme inside a VALUE, not a label separator.
  // Without that exclusion this rewrote `"http://…"` to `"http: //…"` on both sides
  // — harmless to the verdict, since both sides are normalised, and corrupting in
  // the report, where the owner reads his own script text.
  return text.replace(/(?<!:)[ ]*:[ ]*(?![:/])/g, ': ');
}

/** 4. Whitespace, on BOTH sides, and the second normalisation here that comes from
 *     the repo owner rather than from the design spec. In his words:
 *
 *     > "item 25: we don't care about whitespace differences."
 *
 *     So a row whose two sides are identical once every space and tab is ignored is
 *     SETTLED BY HIM, and it is reported as such — in its own bucket with its own
 *     count, never folded into the rows better rendering fixed. Line breaks are
 *     deliberately not ignored: a comment's line breaks are content, not spacing.
 *
 *     **READ NARROWLY, AND DELIBERATELY SO.** Spaces INSIDE a quoted value are not
 *     spacing at all — in FileMaker a string literal with two spaces is a different
 *     value from one with one space — so they are kept, and a row differing only
 *     there stays a difference for us to fix. Two rows were accepted under the wide
 *     reading, and both were a defect of ours: `normaliseCalc` was collapsing runs
 *     inside a string literal. The rule for a ruling that flatters our numbers when
 *     read broadly is to read it narrowly, and this is that rule in code rather
 *     than in a comment. */
function ignoringSpaces(text) {
  let out = '';
  let straight = false;
  let curly = 0;
  for (const character of String(text ?? '')) {
    if (character === '"') straight = !straight;
    else if (character === '“') curly += 1;
    else if (character === '”') curly = Math.max(0, curly - 1);
    else if ((character === ' ' || character === '\t') && !straight && curly === 0) continue;
    out += character;
  }
  return out;
}

/** The three outcomes his rulings decide rather than our rendering, with the reason
 *  each one is his. Kept beside the verdict so a reader of the code sees the same
 *  attribution the report shows. */
const ACCEPTED = {
  ownerAcceptedExtraOption: 'we print an option FileMaker does not',
  ownerAcceptedWhitespace: 'the two differ only in spacing',
  ownerAcceptedFunctionMissing: "we print the CLI's placeholder for a function it cannot resolve",
  ownerAcceptedCatalogMismatch:
    "the catalog records that FileMaker's text here cannot be produced from the value the CLI sends",
};

function truncationMatches(fmLine, ours) {
  const fragments = fmLine.split(ELLIPSIS);
  if (!ours.startsWith(fragments[0])) return false;
  const last = fragments.at(-1);
  if (last !== '' && !ours.endsWith(last)) return false;
  let cursor = fragments[0].length;
  for (const fragment of fragments.slice(1, -1)) {
    const at = ours.indexOf(fragment, cursor);
    if (at === -1) return false;
    cursor = at + fragment.length;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Rendering, from the catalog and nothing else
// ---------------------------------------------------------------------------

/** Why a step cannot be rendered from the catalog at all. Each names one fact
 *  about the catalog or the CLI; none is a bucket. */
const BLOCKED = {
  noEntry: 'the catalog has no entry for this step type',
  opaque: 'the CLI reports {opaque, editable, reason} and no options at all',
  nameUnverifiable: "FileMaker's displayed name comes from an installed plugin, not from the step",
};

/** The one place this file decides a step cannot be written out at all — and the
 *  reason those three checks are HERE rather than inside the renderer.
 *
 *  The app and this run answer them differently, and both answers are right for what
 *  they are doing. A measurement that cannot verify a name must not count the row; a
 *  read sheet must still draw it. So the renderer renders and the caller decides what it
 *  is willing to count, which is what keeps ONE renderer serving both.
 *
 *  The order is the order the previous, duplicated version checked in, so a verdict here
 *  cannot have moved: no entry, then opaque, then a name only an installed plugin knows.
 */
function renderFor(step, entry, conventions) {
  if (!entry) return { blocked: 'noEntry' };
  if (Object.hasOwn(step, 'opaque')) return { blocked: 'opaque' };
  if (entry.displayNameUnverifiable) return { blocked: 'nameUnverifiable' };
  return renderStepFromCatalog(step, entry, conventions);
}

// ---------------------------------------------------------------------------
// Why a mismatch is a mismatch
// ---------------------------------------------------------------------------

/** Mirrors `couldRender` in the derivation: a null, a structured value and a
 *  repetition (which prints inside another option) cannot be an option of their
 *  own, so their absence does not make leftover content attributable.
 *
 *  **IT MUST BE HANDED THE EXPANDED VIEW, NOT THE RAW STEP**, and that is a property
 *  of the CALL, which is where this went wrong. The keys it is asked about come from
 *  `displayKeys`, which expands `slots`, so on a raw step a slot pseudo-key looks up
 *  as `undefined` and the answer is "this cannot be an option" about a value the CLI
 *  did send. Eleven rows were filed as content the CLI never sends because of it —
 *  including a broken layout reference, which is the shape the owner ruled must not
 *  be skipped. The docstring used to say "mirrors the derivation": it mirrored the
 *  function and not the call, which is exactly the failure the derivation's own
 *  comment on this warns about. */
function couldRender(view, key) {
  const value = view[key];
  if (value === null || value === undefined || isRepetitionKey(key)) return false;
  return Array.isArray(value) || typeof value !== 'object';
}

/** The derivation's residual causes, recomputed per example:
 *
 *   - `unreported`: FileMaker displayed content and NO value the CLI sent — under a
 *     key of its own or inside `slots` — could own it.
 *   - `unattributed`: content is left over beside a value that might own it, and the
 *     derivation refused to guess. Ambiguity in the data.
 *   - null: the line was fully accounted for, so a mismatch here is OURS.
 *
 *  This says nothing on its own about whether a row can be rendered — see
 *  `DATA_GAP_CAUSES` for why that needed a second condition. */
function residualCause(step, line, displayName) {
  const match = matchSegments(step, line, displayName);
  if (match.unmatched.length === 0) return null;
  const view = expandSlots(step);
  const plausible = match.ignoredKeys.filter((key) => couldRender(view, key));
  return plausible.length === 0 ? 'unreported' : 'unattributed';
}

/** The two causes for which "FileMaker shows something the CLI never sends" is the
 *  WHOLE of the difference, and therefore the only two that may be filed as
 *  unrenderable.
 *
 *  **`unreported` was the whole test, and it is not a boundary.** It asks whether the
 *  matcher left an attributable key over — a question about attribution — and the
 *  bucket claims something else entirely: that no rendering could ever fix the row.
 *  An independent review produced the demonstration that settles it: five steps of one
 *  step type with ONE identical gap were split between "review this" and "impossible,
 *  skip it" by nothing but whether an unrelated key happened to be present. Fourteen
 *  more rows were told to be skipped while their own classification called them a
 *  presentation rule, or a text difference on an option BOTH sides print, or a display
 *  form the catalog happens to lack — none of which is a missing value.
 *
 *  So a row is only unrenderable when the leftover content is unattributable AND the
 *  difference is that FileMaker prints an option we do not. Everything else is a
 *  mismatch: work, visible, in the list he reads. */
const DATA_GAP_CAUSES = new Set(['weOmitAnOption', 'differentOptionSets']);

// ---------------------------------------------------------------------------
// Diagnostic repairs — NOT normalisations
// ---------------------------------------------------------------------------

/** A repair is a hypothesis about ONE render rule the catalog does not carry.
 *
 *  **What is guaranteed, stated exactly, because the old wording was not true.** A
 *  repair cannot make a step come out exactly right: the exact test has already run
 *  and passed or failed before `classify` is called, and no repair touches the
 *  strings it compared. It also cannot make a step unwritable, since that needs a
 *  cause naming a missing option and a successful repair names a presentation rule
 *  instead.
 *
 *  What it CAN do, now that one of the owner's rulings is keyed on the cause, is
 *  decide between "still different" and "settled by his ruling": a step whose
 *  repairs succeed is filed under the presentation rule and so cannot reach the
 *  accepted bucket.
 *
 *  **WHAT IS GUARANTEED AND WHAT IS MEASURED, kept apart, because the measurement went
 *  stale in the one file whose purpose is that measurements are current.** The guarantee is
 *  the direction: a repair can only move a step INTO the reviewed set, never out of it and
 *  never into the accepted bucket.
 *
 *  **THE LIST IS EMPTY, AND THAT IS THE POINT IT REACHED RATHER THAN A GAP.** It held one
 *  repair, `emptyOptionSlot`, whose claim was "FileMaker prints an empty slot for an option
 *  it has no value for". It was put to the owner as exactly that question and he answered:
 *
 *    > "FM is inconsistent here but often does print an option with no value set. So we
 *    > should."
 *
 *  A confirmed hypothesis is a catalog fact, not a repair, so it moved into the catalog as
 *  `whenAbsent` on eleven segments plus five more the same ruling reached. Keeping the
 *  repair after that was not neutral: measured by ablation, it filed the two steps where
 *  FileMaker prints NO slot and we now print one as `presentationRule` mismatches, when the
 *  whole of their difference is an option we print and FileMaker does not — which is the
 *  family his ruling R1 settles. So retiring it MOVES TWO ROWS from `mismatch` to
 *  `accepted`, and nothing else:
 *
 *      repair still in   exact 930  accepted 51  mismatch 114  unrenderable 108
 *      repair retired    exact 930  accepted 53  mismatch 112  unrenderable 108
 *
 *  The machinery stays because the next hypothesis about a render rule belongs here rather
 *  than in the renderer, and because a repair states its claim as a question about
 *  FileMaker, which is what the report exists to ask.
 *
 *  Each is stated as a claim about FileMaker so the owner can confirm or deny it,
 *  which is the whole point of the report. */
const REPAIRS = [];

/** Which repairs are NECESSARY to make the two lines agree, or null when no
 *  combination of them does. Necessity is tested by leave-one-out, so a repair
 *  that happened to touch the string without mattering is not reported. */
function repairsNeeded(row) {
  const runAll = (skip) => {
    let state = { fm: row.fmCompared, ours: row.ours, row };
    for (const repair of REPAIRS) {
      if (repair.name === skip) continue;
      state = { ...repair.apply(state), row };
    }
    return state.fm === state.ours;
  };
  if (!runAll(null)) return null;
  return REPAIRS.filter((repair) => !runAll(repair.name)).map((repair) => repair.name);
}

/** The options of a rendered line, for a set comparison.
 *
 *  This DOES cut on `;`, which shreds a calculation containing one. It names a cause,
 *  and a cause can send a step to the accepted bucket, so "no verdict depends on it"
 *  is too strong: what holds is that it cannot turn a difference into a match, and it
 *  can only ever keep a step in the reviewed set. Measured: an independent review's
 *  paren-and-quote-aware splitter, a genuinely different rule, produces the same 40
 *  accepted extra-option steps. */
function optionsOf(line) {
  const open = line.indexOf('[');
  const close = line.lastIndexOf(']');
  if (open === -1 || close < open) return [];
  return line
    .slice(open + 1, close)
    .split(';')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');
}

/** An option's label, or `(unlabelled)` — a stable name for the option that does
 *  not vary with the owner's own values, so identical failures collapse. A `::` is
 *  a field reference, not a label, so a table name never becomes a group name.
 *
 *  It read `<bare>` until the owner answered ruling 2 with "I don't know what you
 *  mean that FM prints 'bare'". That was our own word for an option with no label,
 *  and it cost him a question he could not answer, so the jargon is gone from
 *  everything he reads. */
function optionName(option) {
  const labelled = /^([A-Za-z][A-Za-z0-9 '/&.()-]{0,38}):(?!:)/.exec(option);
  return labelled ? labelled[1].trim() : '(unlabelled)';
}

function multisetDifference(left, right) {
  const pool = [...right];
  const only = [];
  for (const item of left) {
    const at = pool.indexOf(item);
    if (at === -1) only.push(item);
    else pool.splice(at, 1);
  }
  return only;
}

/** How one option's text differs when both sides show that option.
 *
 *  Named generically so a shape collapses across step types: three step types
 *  disagreeing about a repetition is ONE thing to decide, not three. */
function textDiffKind(fmOption, ourOption) {
  if (fmOption.replace(/\s+/g, '') === ourOption.replace(/\s+/g, '')) {
    return 'whitespace only, such as the spacing round the colon';
  }
  const bracketed = /^(.*)\[[^[\]]*\]$/;
  if (bracketed.exec(fmOption)?.[1] === ourOption) return 'a bracket FileMaker adds and we do not';
  if (bracketed.exec(ourOption)?.[1] === fmOption) return 'a bracket we add and FileMaker does not';
  const unquoted = (text) => text.replaceAll('“', '').replaceAll('”', '').replaceAll('"', '');
  if (unquoted(fmOption) === unquoted(ourOption)) return 'quoting round the value';
  if (optionName(fmOption) !== optionName(ourOption)) return 'a different label on the same value';
  return 'different value text under the same label';
}

/** The one cause this mismatch is filed under, and the detail that makes the
 *  question specific.
 *
 *  THE COLLAPSE IS THE DELIVERABLE. Ordered from "the catalog says it cannot"
 *  through "the catalog lacks a presentation rule" to "the catalog is wrong about
 *  which options there are" — and at every level the detail names the GENERIC
 *  thing to decide (a key, a rule, a kind of textual difference), never the
 *  owner's own values, which would split one shape into dozens. */
const GAP_ORDER = ['catalogMarkedMismatch', 'structuredValue', 'noDisplayForm', 'suffixHostMissing', 'noValue'];

/** How each way of printing an option is DESCRIBED to him. The internal names are
 *  ours; he should never have to learn them, and one of them was leaking into a
 *  folded shape name. */
const RENDER_WORDS = {
  labelled: 'label and value',
  bare: 'value with no label',
  bareWhenTrue: 'its own name when it is on',
  bareState: 'on or off, with no label',
  labelledState: 'label and on/off',
  masked: 'label and a masked value',
  enum: "FileMaker's word for the value, with no label",
  labelledEnum: "label and FileMaker's word for the value",
  labelledMismatch: "text we cannot produce from the CLI's value",
  setMember: 'label and the name of one flag inside the value',
  suffix: 'printed in brackets on another option',
  keyPresence: 'text that depends on which values the CLI sends',
  inline: 'printed inside another option',
};

/** Is the WHOLE of this row's difference confined to options the catalog itself marks
 *  `labelledMismatch` — the segments whose text it says cannot be produced from the CLI's
 *  value?
 *
 *  His ruling R8 in one predicate, and NOT a normalisation: no string is rewritten, nothing
 *  is compared case-insensitively, and no match is claimed. It compares option SETS, exactly
 *  as `classify` does for the extra-option family, and asks whether every option that
 *  differs on either side is one of those segments — ours by the text it produced, and
 *  FileMaker's by the label it carries, since the text is the thing the catalog says it
 *  cannot reproduce.
 *
 *  A case fold here would be the forbidden fifth normalisation and would also rescue rows he
 *  has not seen. This rescues only the rows the CATALOG already flags. */
function catalogMismatchOnly(row) {
  const keys = row.gaps.filter((gap) => gap.gap === 'catalogMarkedMismatch').map((gap) => gap.key);
  if (keys.length === 0 || row.ours === null) return false;
  const texts = keys.map((key) => row.optionTexts[key]).filter((text) => text !== undefined);
  if (texts.length !== keys.length) return false;
  const fmOptions = optionsOf(row.fmCompared);
  const ourOptions = optionsOf(row.ours);
  const ourOnly = multisetDifference(ourOptions, fmOptions);
  const fmOnly = multisetDifference(fmOptions, ourOptions);
  if (ourOnly.length !== texts.length || fmOnly.length !== texts.length) return false;
  const labels = new Set(texts.map(optionName));
  return (
    ourOnly.every((option) => texts.includes(option)) &&
    fmOnly.every((option) => labels.has(optionName(option)))
  );
}

function classify(row) {
  // The FIRST gap in this order names the shape. Listing every gap key instead
  // splits one decision three ways: a step whose examples gap on {a,b,c}, {a,b}
  // and {a} is one question about a, not three about subsets.
  const gap = GAP_ORDER.flatMap((name) => row.gaps.filter((item) => item.gap === name))[0] ?? row.gaps[0] ?? null;
  const gapNote = gap ? `; the catalog also renders nothing for ${gap.key}` : '';

  const repairs = repairsNeeded(row);
  if (repairs) {
    return {
      cause: 'presentationRule',
      detail: repairs.map((name) => REPAIRS.find((item) => item.name === name)?.words ?? name).join(' + '),
    };
  }

  const fmOptions = optionsOf(row.fmCompared);
  const ourOptions = optionsOf(row.ours);
  const fmOnly = multisetDifference(fmOptions, ourOptions);
  const ourOnly = multisetDifference(ourOptions, fmOptions);

  // Pair up by label first: an option both sides print with different text is a
  // different question from one only one side prints at all.
  const paired = [];
  for (const fmOption of [...fmOnly]) {
    const at = ourOnly.findIndex((option) => optionName(option) === optionName(fmOption));
    if (at === -1) continue;
    paired.push(textDiffKind(fmOption, ourOnly[at]));
    ourOnly.splice(at, 1);
    fmOnly.splice(fmOnly.indexOf(fmOption), 1);
  }

  const names = (list) => [...new Set(list.map(optionName))].sort().join(', ');
  // A count here would split one shape per arity; the fact that there is ALSO an
  // unmatched option is the part worth grouping on.
  const unmatched = fmOnly.length + ourOnly.length === 0 ? '' : ', plus options only one side prints';

  if (paired.length > 0) {
    return {
      cause: 'sameOptionDifferentText',
      detail: [...new Set(paired)].sort().join(' + ') + unmatched + gapNote,
    };
  }
  if (fmOnly.length === 0 && ourOnly.length === 0) {
    return { cause: 'optionOrder', detail: `${fmOptions.length} options, different order` };
  }
  // A gap claims the row ONLY when the whole difference is options FileMaker
  // prints and we do not: that is what a gap causes. Filing a row under its gap
  // when we ALSO print options FileMaker does not understates the difference, and
  // it made a step whose real problem was five wrong options read as one missing
  // display form.
  if (ourOnly.length === 0) {
    return gap
      ? { cause: gap.gap, detail: `${gap.key} (${RENDER_WORDS[gap.render] ?? gap.render})` }
      : { cause: 'weOmitAnOption', detail: names(fmOnly) };
  }
  if (fmOnly.length === 0) return { cause: 'weAddAnOption', detail: names(ourOnly) + gapNote };
  return {
    cause: 'differentOptionSets',
    detail: `FileMaker: ${names(fmOnly)} / ours: ${names(ourOnly)}${gapNote}`,
  };
}

/** What the owner is being asked, per cause. Deliberately a question about
 *  FileMaker rather than about our code: his knowledge is the deciding evidence
 *  and nothing else in this pipeline can settle these.
 *
 *  There is deliberately NO entry for an option we print and FileMaker does not. He
 *  has ruled on the whole family — "FM does not always show all configured options so
 *  if we do then that is fine" — so those rows never reach a question, and leaving a
 *  question here for them would be keeping a form of words we have been told not to
 *  use. */
const QUESTIONS = {
  catalogMarkedMismatch: (detail) =>
    `The derivation could not derive FileMaker's text for ${detail} from what the CLI reports, so the catalog renders nothing. Looking at the two lines: is FileMaker's option here derivable from the CLI's value, and by what rule?`,
  structuredValue: (detail) =>
    `The CLI reports ${detail} as a nested object, and the catalog has no render kind for one. Which part of it is FileMaker printing, and is the rule the same for every step that reports this shape?`,
  noDisplayForm: (detail) =>
    `FileMaker prints a display name for this value of ${detail} that these two scripts never showed, so the catalog has no mapping for it. What does FileMaker print for the value shown in the FileMaker line, and is the full set of that option's display names something you can list?`,
  suffixHostMissing: (detail) =>
    `${detail} prints inside another option, and in these examples the option it belongs to rendered nothing. Which option does FileMaker attach it to when that happens?`,
  noValue: (detail) =>
    `The CLI reports ${detail} with no value while FileMaker prints something. Is FileMaker showing a default here, and what is it?`,
  optionOrder: () =>
    "We print exactly the options FileMaker prints, in a different order. Which order is FileMaker's, and is it fixed for the step or does it follow whichever option is set?",
  weOmitAnOption: (detail) =>
    `FileMaker prints ${detail} and we print nothing for it. Is that option always shown for this step, or only when another option is set?`,
  sameOptionDifferentText: (detail) =>
    `Both sides print the option; the text differs by ${detail}. Which is FileMaker's rule?`,
  differentOptionSets: (detail) =>
    `The option sets do not correspond at all — ${detail}. Does FileMaker choose a different set of options for this step depending on one of them?`,
  presentationRule: (detail) => {
    const claims = detail
      .split(' + ')
      .map((words) => REPAIRS.find((repair) => repair.words === words)?.claim ?? words);
    return `These lines agree once we assume: ${claims.join('; and ')}. Is each of those FileMaker's actual behaviour?`;
  },
};

/** A tail row has swallowed several shapes, so the per-shape question would be a
 *  paragraph. It gets the cause's question asked of the example instead, with the
 *  swallowed shapes named in the row's detail. */
const TAIL_QUESTIONS = {
  catalogMarkedMismatch: 'Is FileMaker’s option derivable from the CLI’s value in these cases, and by what rule?',
  structuredValue: 'Which part of the nested value is FileMaker printing in these cases?',
  noDisplayForm: 'Can you list what FileMaker prints for each value of these options?',
  presentationRule: 'Are these presentation rules FileMaker’s actual behaviour?',
  sameOptionDifferentText: 'Which text is FileMaker’s, and by what rule?',
  weOmitAnOption: 'Are these options always shown for their step, or only when another option is set?',
  differentOptionSets: 'Does FileMaker choose a different set of options for these steps depending on one of them?',
  optionOrder: 'Which order is FileMaker’s for these steps?',
};

function questionFor(group) {
  if (group.folded.size > 0) {
    return (
      TAIL_QUESTIONS[group.cause] ?? "What is FileMaker's rule in each of these?"
    );
  }
  return (QUESTIONS[group.cause] ?? ((text) => `What is FileMaker's rule here? (${text})`))(group.detail);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function readSources() {
  const missing = SOURCES.filter((source) => !fs.existsSync(source.body));
  if (missing.length > 0) {
    console.error(
      `Missing script bodies: ${missing.map((source) => path.relative(ROOT, source.body)).join(', ')}`,
    );
    console.error(
      'These are COMMITTED data (fm_scripts/*.adt.json), so a missing one is an incomplete checkout:\n' +
        '  git checkout fm_scripts\n' +
        'Nothing here regenerates them, and no run of this script invokes the fm CLI.',
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

/** How many rendered lines a step occupies — the rule `alignSteps` applies,
 *  restated for ONE purpose: recovering the CONTINUATION lines of a multi-line
 *  comment, which the aligner does not return. Guarded rather than trusted: the
 *  walk below asserts that the line it computes is the line the aligner paired,
 *  so any drift between the two is a loud failure rather than a wrong pairing. */
function lineSpan(step) {
  if (step.step !== '#' || typeof step.text !== 'string') return 1;
  return 1 + (step.text.match(/[\r\n]/g) ?? []).length;
}

/** A rendered line without the tabs FileMaker uses to draw block depth.
 *
 *  NOT A FIFTH NORMALISATION, and it is named here because a reader auditing "exactly four"
 *  would otherwise have to satisfy themselves of that alone. `alignSteps` returns `line`
 *  and `indent` separately as its own documented contract, so the indent is not part of the
 *  line either side of the comparison; the app draws depth from the block extents the CLI
 *  reports rather than from the text. Removing it does not move a count — it trips the
 *  line-walk guard, loudly, because the walk then compares a stripped line with an
 *  unstripped one. */
function stripIndent(line) {
  return line.slice(line.match(/^\t*/)[0].length);
}

function run() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const sources = readSources();
  assertNoMaskedSlots(catalog);
  const conventions = stepConventions(catalog);

  const rows = [];
  const alignFailures = [];
  const applied = {
    marker: 0,
    truncationFinal: 0,
    truncationNonFinal: 0,
    truncationBlocked: 0,
    colonTouched: 0,
    colonDecided: 0,
    colonFromAccepted: 0,
  };
  const accepted = { extraOption: 0, whitespace: 0, functionMissing: 0, catalogMismatch: 0 };
  // WHAT THE EXACT COUNT IS MADE OF, measured here rather than asserted anywhere.
  // Two things a reader steering by one number cannot see: how much of it needed no
  // normalisation at all, and how much of it is a step FileMaker printed with no
  // options, where reproducing it means reproducing a name.
  const ladder = { byteIdentical: 0, afterSpec: 0, noOptions: 0, noOptionsExact: 0, emptyComment: 0 };

  for (const source of sources) {
    const aligned = alignSteps(source.body, source.lines, (name) => DISPLAY_NAME_OVERRIDES[name] ?? name);
    for (const failure of aligned.failures) alignFailures.push({ ...failure, script: source.id });

    let cursor = 0;
    for (const pair of aligned.pairs) {
      const here = stripIndent(source.lines[cursor]);
      if (here !== pair.line) {
        throw new Error(
          `line walk desynchronised at script ${source.id} step ${pair.index + 1}: ` +
            `the aligner paired ${JSON.stringify(pair.line)}, this walk is at ${JSON.stringify(here)}`,
        );
      }
      const span = lineSpan(pair.step);
      const fmRaw = source.lines.slice(cursor, cursor + span).map(stripIndent).join('\n');
      const textLine = cursor + 1;
      cursor += span;

      const entry = catalogEntry(catalog, pair.step.step) ?? null;
      const rendered = renderFor(pair.step, entry, conventions);
      const fmCompared = stripMarker(fmRaw);
      const ourRaw = rendered.line ?? null;
      if (ourRaw !== null && ourRaw === fmRaw) ladder.byteIdentical += 1;
      if (
        ourRaw !== null &&
        (ourRaw === fmCompared || (fmCompared.includes(ELLIPSIS) && truncationMatches(fmCompared, ourRaw)))
      ) {
        ladder.afterSpec += 1;
      }
      // FileMaker printed no option at all: a comment, a block ender, a step with
      // empty brackets. Reproducing one means reproducing a name.
      if ((splitForMarking(fmRaw).options ?? []).length === 0) ladder.noOptions += 1;
      if (fmRaw.trim() === '#') ladder.emptyComment += 1;
      if (fmCompared !== fmRaw) applied.marker += 1;
      // Counted before the normalisation is applied, so its effect is reported as a
      // number rather than absorbed silently: how many rows it touched at all, and
      // how many it DECIDED — rows that differ only in the spacing round a colon.
      const ourLine = rendered.line ?? '';
      if (normaliseColons(fmCompared) !== fmCompared || normaliseColons(ourLine) !== ourLine) {
        applied.colonTouched += 1;
      }
      if (fmCompared !== ourLine && normaliseColons(fmCompared) === normaliseColons(ourLine)) {
        applied.colonDecided += 1;
        // WHERE THAT ROW COMES FROM, which is the thing the ladder cannot show. The
        // spacing round a colon IS spacing, so his whitespace ruling (R6) settles every
        // row this normalisation decides: it moves them from `accepted` to `exact` and
        // rescues nothing from the list of differences. Counted rather than argued, and
        // confirmed by ablation — with the colon normalisation off, `mismatch` is
        // unchanged at 122 and `accepted` absorbs all 22.
        if (ignoringSpaces(fmCompared) === ignoringSpaces(ourLine)) applied.colonFromAccepted += 1;
      }

      const row = {
        script: source.id,
        file: path.relative(ROOT, source.text),
        index: pair.index + 1,
        textLine,
        step: pair.step.step,
        fm: fmRaw,
        fmCompared: normaliseColons(fmCompared),
        ours: rendered.line === undefined ? null : normaliseColons(rendered.line),
        gaps: rendered.gaps ?? [],
        contributed: rendered.contributed ?? [],
        lists: rendered.lists ?? [],
        optionTexts: rendered.optionTexts ?? {},
        keys: displayKeys(pair.step),
        // The step as the CLI reported it, so the report can show its own output
        // beside FileMaker's rather than asking him to take our word for what the CLI
        // does and does not send. He asked for it; he should not have had to.
        //
        // MASKED VALUES ARE REPLACED HERE, at the only point where the step enters the
        // report's own data. Everything else is verbatim. A review found the raw step
        // printed into the HTML for 12 rows, masked keys included: no secret in this
        // corpus, since every one is a `$variable`, but the mechanism was
        // unconditional and a step written with a literal password would have had it
        // printed. The redaction is at the boundary rather than at each print site so
        // there is one place to be right about.
        json: redactMasked(pair.step, conventions),
      };

      if (rendered.blocked) {
        rows.push({ ...row, verdict: 'unrenderable', cause: rendered.blocked, detail: BLOCKED[rendered.blocked] });
        continue;
      }
      // Compared on `row.fmCompared` and `row.ours`, which are the NORMALISED
      // forms — the ones the report shows, so what is compared and what is read are
      // the same strings.
      if (row.ours === row.fmCompared) {
        rows.push({ ...row, verdict: 'exact' });
        continue;
      }
      if (row.fmCompared.includes(ELLIPSIS) && truncationMatches(row.fmCompared, row.ours)) {
        const finalCut = /…\s*\]?\s*$/.test(row.fmCompared);
        applied[finalCut ? 'truncationFinal' : 'truncationNonFinal'] += 1;
        rows.push({ ...row, verdict: 'exact', normalised: 'truncation', finalCut });
        continue;
      }

      // A truncated line that fails for some OTHER reason never reaches the check
      // above, so the truncation counts would read 0 and imply the corpus has no
      // truncation. Counted separately rather than left as a misleading zero.
      if (row.fmCompared.includes(ELLIPSIS)) applied.truncationBlocked += 1;

      // HIS RULING ON WHITESPACE, before anything else is decided: "we don't care
      // about whitespace differences." A row whose two sides are the same once every
      // space and tab is ignored is settled by him, not by us. Line breaks are NOT
      // ignored — a comment's own line breaks are content.
      if (ignoringSpaces(row.fmCompared) === ignoringSpaces(row.ours)) {
        accepted.whitespace += 1;
        rows.push({ ...row, verdict: 'accepted', cause: 'ownerAcceptedWhitespace', detail: ACCEPTED.ownerAcceptedWhitespace });
        continue;
      }
      // HIS RULING ON THE PLUGIN PLACEHOLDER: "that's ok, we just render as we see
      // it. This is a CLI defect because it currently cannot use FM plugins." So a
      // row where we print the CLI's placeholder and FileMaker prints the real
      // function name is settled too.
      if ((row.ours ?? '').includes(FUNCTION_MISSING) && !row.fmCompared.includes(FUNCTION_MISSING)) {
        accepted.functionMissing += 1;
        rows.push({ ...row, verdict: 'accepted', cause: 'ownerAcceptedFunctionMissing', detail: ACCEPTED.ownerAcceptedFunctionMissing });
        continue;
      }

      const residual = residualCause(pair.step, pair.line, entry.displayName ?? pair.step.step);
      const { cause, detail } = classify(row);
      // HIS GENERAL RULING ON AN OPTION WE PRINT AND FILEMAKER DOES NOT: "In general
      // any 'weAddAnOption' is not a problem, FM does not always show all configured
      // options so if we do then that is fine." It supersedes the per-shape treatment
      // of two such rows in the previous round, so the whole family moves out of the
      // mismatch list and keeps its own count.
      if (cause === 'weAddAnOption') {
        accepted.extraOption += 1;
        rows.push({ ...row, verdict: 'accepted', cause: 'ownerAcceptedExtraOption', detail });
        continue;
      }
      // HIS RULING ON A TEXT THE CATALOG CANNOT PRODUCE FROM THE CLI'S VALUE. Shown the
      // one such row — FileMaker writes `Get ( CurrentHostTimestamp )` and the CLI reports
      // the same calculation with a capital S in `TimeStamp`, so the derivation refused to
      // attribute the option and the catalog holds it as `labelledMismatch` — he answered:
      //
      //   > "I don't understand why this is an issue; we're just reading so who cares what
      //   > the case format is. There's no reason to normalize and make things more
      //   > complex."
      //
      // So it is ACCEPTED, not normalised and not exact. Case-folding anywhere in this
      // comparison would be a FIFTH normalisation — exactly four are permitted (the spec's
      // truncation and marker, his colon spacing and his whitespace) — and he declined the
      // one that would buy this row. We are not claiming the line matches; we are recording
      // that he ruled the difference immaterial.
      //
      // SCOPE, measured rather than assumed. It fires on ONE row of the 1203,
      // `Set Error Logging | custom debug info`. A second such segment appearing later would
      // be accepted by this rule without his having seen it, which is wider than his answer —
      // so the count is printed beside the bucket.
      //
      // TWO WAYS IN, because the renderer changed under it and the ruling did not. The catalog
      // still marks the segment `labelledMismatch`; what changed is that the renderer now
      // PRINTS the value it holds instead of nothing, so this row's difference moved from
      // "FileMaker prints an option we do not" to "both print it and the text differs" — the
      // same one letter's case, under his ruling either way. Anchoring the bucket only on the
      // classifier's cause would have moved the row into the difference list for getting
      // better, so it is anchored on the catalog's own `labelledMismatch` verdict as well.
      if (cause === 'catalogMarkedMismatch' || catalogMismatchOnly(row)) {
        accepted.catalogMismatch += 1;
        rows.push({ ...row, verdict: 'accepted', cause: 'ownerAcceptedCatalogMismatch', detail });
        continue;
      }
      // BOTH conditions, not one: the leftover content must be unattributable AND the
      // difference must be that FileMaker prints an option we do not. See
      // `DATA_GAP_CAUSES`.
      const unwritable = residual === 'unreported' && DATA_GAP_CAUSES.has(cause);
      rows.push({
        ...row,
        verdict: unwritable ? 'unrenderable' : 'mismatch',
        residual: residual ?? 'none',
        cause: unwritable ? 'unreported' : cause,
        detail: unwritable ? detail || 'FileMaker shows options the CLI never reports' : detail,
      });
    }
  }

  assertNoMaskedValues(rows, conventions);
  // Counted after the verdicts, because it is a statement ABOUT them: of the steps
  // FileMaker printed with no options at all, how many came out exactly right.
  ladder.noOptionsExact = rows.filter(
    (row) => row.verdict === 'exact' && (splitForMarking(row.fm).options ?? []).length === 0,
  ).length;
  return { catalog, rows, alignFailures, applied, accepted, ladder, maskedKeys: conventions.maskedKeys };
}

// ---------------------------------------------------------------------------
// `verified` — the one field only this run can fill in
// ---------------------------------------------------------------------------

/** Which entries every contributing example round-trips EXACTLY.
 *
 *  `verified` is the catalog's own definition: "true when every contributing example
 *  round-trips exactly". So it is read strictly — a step type with one accepted row is
 *  NOT verified, however the owner ruled on that row, because his ruling settles whether
 *  a difference matters and not whether the catalog reproduced the line. Reading
 *  `accepted` as passing would make the field mean something else and inflate it by 20
 *  step types.
 *
 *  A step type with no measured example cannot be verified at all. That cannot happen
 *  for a catalog this corpus produced — every entry came from at least one of these
 *  rows — so it is asserted rather than handled. */
function verifiedEntries(catalog, rows) {
  const byStep = new Map();
  for (const row of rows) {
    if (!byStep.has(row.step)) byStep.set(row.step, []);
    byStep.get(row.step).push(row);
  }
  const verdicts = new Map();
  for (const name of Object.keys(catalog)) {
    const measured = byStep.get(name) ?? [];
    if (measured.length === 0) {
      throw new Error(
        `${name}: the catalog has an entry and this run measured no example of it, so ` +
          '`verified` cannot be set either way — the catalog and the corpus have parted company',
      );
    }
    verdicts.set(name, measured.every((row) => row.verdict === 'exact'));
  }
  return verdicts;
}

/** Write `verified` into the committed catalog, and say what moved.
 *
 *  The derivation emits `verified: false` everywhere and asserts it stays false, so a
 *  re-derivation cannot claim a verification it did not perform; THIS is the run that
 *  performs it, so this is where the field is filled in. Running the two in order —
 *  derive, then round-trip — is therefore idempotent, and a `true` in the committed file
 *  always means "this measurement said so", never "someone edited it".
 *
 *  It also corrects a stale `true`: an entry the catalog claims is verified and this run
 *  does not is reset, loudly. That is the same protection in the direction that matters
 *  more. */
function writeVerified(catalog, verdicts) {
  const changed = [];
  const withdrawn = [];
  for (const [name, entry] of Object.entries(catalog)) {
    const verified = verdicts.get(name) === true;
    if (entry.verified === verified) continue;
    (verified ? changed : withdrawn).push(name);
    entry.verified = verified;
  }
  if (changed.length > 0 || withdrawn.length > 0) {
    fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  }
  return { changed, withdrawn, verified: [...verdicts.values()].filter(Boolean).length };
}

// ---------------------------------------------------------------------------
// Grouping — the owner's attention is the scarce resource
// ---------------------------------------------------------------------------

/** A shape affecting fewer steps than this does not earn a row of its own: it is
 *  folded into its cause's tail row, which NAMES every shape it swallowed. The
 *  point is to de-emphasise, never to hide. */
const OWN_ROW_THRESHOLD = 3;

/** Collapse the steps with one verdict into one row per (cause, detail), then name
 *  the step types inside. One row saying "affects 27 steps" is worth 27 rows; the step
 *  types and the folded shapes stay visible inside the row, so nothing is hidden
 *  by the collapse. */
function groupRows(rows, verdict) {
  const make = (cause, detail) => ({ cause, detail, rows: [], steps: new Map(), folded: new Set() });
  const add = (group, row) => {
    group.rows.push(row);
    group.steps.set(row.step, (group.steps.get(row.step) ?? 0) + 1);
  };

  const fine = new Map();
  for (const row of rows) {
    if (row.verdict !== verdict) continue;
    const key = `${row.cause} | ${row.detail}`;
    if (!fine.has(key)) fine.set(key, make(row.cause, row.detail));
    add(fine.get(key), row);
  }

  const groups = new Map();
  for (const group of [...fine.values()].sort((a, b) => b.rows.length - a.rows.length)) {
    if (group.rows.length >= OWN_ROW_THRESHOLD) {
      groups.set(`${group.cause} | ${group.detail}`, group);
      continue;
    }
    const key = `${group.cause} | tail`;
    if (!groups.has(key)) groups.set(key, make(group.cause, ''));
    const tail = groups.get(key);
    tail.folded.add(group.detail);
    for (const row of group.rows) add(tail, row);
  }
  for (const group of groups.values()) {
    if (group.folded.size === 0) continue;
    group.detail = `${group.folded.size} shape(s), each under ${OWN_ROW_THRESHOLD} steps`;
  }

  return [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.cause.localeCompare(b.cause) || a.detail.localeCompare(b.detail),
  );
}

/** The facts the derivation demoted for want of corroboration rather than for
 *  evidence against them, which is precisely what this round-trip can supply.
 *
 *  `thinMapping` and `singleValueOnly` are the derivation's own
 *  inference-STRENGTH tests: they fire when a fact rests on one observation
 *  repeated, not when anything contradicts it. `labelCollision` rides along
 *  because two of the facts the derivation named in its own concerns carry it as
 *  a second doubt. Everything else (`mismatch`, `valueNotFunctional`,
 *  `rejectedMapping`, `renderDisagreement`, `singleExample`) is either evidence
 *  AGAINST the fact or the one-example rule the plan settled deliberately, and is
 *  not a promotion candidate. */
const PROMOTION_DOUBTS = new Set(['thinMapping', 'singleValueOnly', 'labelCollision']);
const PROMOTION_REQUIRED = new Set(['thinMapping', 'singleValueOnly']);

/** Does FileMaker's line carry exactly this option, as an option of its own?
 *
 *  Boundary-checked rather than a bare substring test, so `Off` cannot be found
 *  inside a calculation. Deliberately conservative in the direction that matters:
 *  a calculation containing `;` can make this answer no when the option really is
 *  there, which withholds a promotion — it can never grant one. */
function showsOption(fmLine, optionText) {
  if (!optionText) return false;
  const open = fmLine.indexOf('[');
  const close = fmLine.lastIndexOf(']');
  if (open === -1 || close < open) return false;
  const inner = fmLine.slice(open + 1, close);
  for (let at = inner.indexOf(optionText); at !== -1; at = inner.indexOf(optionText, at + 1)) {
    const before = inner.slice(0, at).trimEnd();
    const after = inner.slice(at + optionText.length).trimStart();
    if ((before === '' || before.endsWith(';')) && (after === '' || after.startsWith(';'))) return true;
  }
  return false;
}

/** Does FileMaker START an option with this text and then add more?
 *
 *  Separated from `showsOption` because it is a materially weaker reading and
 *  must not be mistaken for the stronger one: it says the label and the value are
 *  where we put them and FileMaker appended something we did not print — a
 *  repetition it does not report, a layout's table in parentheses. That is a
 *  finding in section 2, not a refutation of this segment, and counting it as one
 *  would manufacture evidence against a fact from a rule that has nothing to do
 *  with it. */
function startsOption(fmLine, optionText) {
  if (!optionText) return false;
  const open = fmLine.indexOf('[');
  const close = fmLine.lastIndexOf(']');
  if (open === -1 || close < open) return false;
  const inner = fmLine.slice(open + 1, close);
  for (let at = inner.indexOf(optionText); at !== -1; at = inner.indexOf(optionText, at + 1)) {
    const before = inner.slice(0, at).trimEnd();
    if (before === '' || before.endsWith(';')) return true;
  }
  return false;
}

function promotionCandidates(catalog, rows) {
  const byStep = new Map();
  for (const row of rows) {
    if (!byStep.has(row.step)) byStep.set(row.step, []);
    byStep.get(row.step).push(row);
  }

  const candidates = [];
  for (const [name, entry] of Object.entries(catalog)) {
    for (const segment of entry.segments) {
      const doubts = segment.doubts ?? [];
      if (segment.confidence !== 'low') continue;
      if (!doubts.every((doubt) => PROMOTION_DOUBTS.has(doubt))) continue;
      if (!doubts.some((doubt) => PROMOTION_REQUIRED.has(doubt))) continue;

      // Only a row where this segment actually PRINTED an option can testify.
      const testifying = (byStep.get(name) ?? []).filter((row) => row.contributed.includes(segment.key));
      const exact = testifying.filter((row) => row.verdict === 'exact');

      // A LINE that fails does not disprove a SEGMENT: several rows here fail on
      // a different key entirely, and counting those as evidence against would
      // manufacture a refutation out of an unrelated gap. So each row is asked
      // the narrower question — does FileMaker's line carry this option's exact
      // text as an option of its own? — and only a row that answers no is
      // evidence against the fact.
      const inexact = testifying.filter((row) => row.verdict !== 'exact');
      const optionOnly = inexact.filter((row) => showsOption(row.fmCompared, row.optionTexts[segment.key]));
      const rest = inexact.filter((row) => !showsOption(row.fmCompared, row.optionTexts[segment.key]));
      const appended = rest.filter((row) => startsOption(row.fmCompared, row.optionTexts[segment.key]));
      const against = rest.filter((row) => !startsOption(row.fmCompared, row.optionTexts[segment.key]));
      const verdict =
        testifying.length === 0
          ? 'untested'
          : against.length > 0
            ? 'unconfirmed'
            : exact.length > 0
              ? 'passes'
              : appended.length > 0
                ? 'optionPrefix'
                : 'optionExact';
      candidates.push({
        step: name,
        segment,
        doubts,
        testifying: testifying.length,
        exact: exact.length,
        optionOnly: optionOnly.length,
        appended: appended.length,
        against: against.length,
        verdict,
        example: (against[0] ?? appended[0] ?? exact[0] ?? testifying[0]) ?? null,
      });
    }
  }
  return candidates.sort(
    (a, b) => a.verdict.localeCompare(b.verdict) || b.exact - a.exact || a.step.localeCompare(b.step),
  );
}

// ---------------------------------------------------------------------------
// His rulings, and where each one landed. Two rounds, two tables, two ID prefixes
// ---------------------------------------------------------------------------

/** WHY EVERY ROW IN THIS REPORT CARRIES A LETTER.
 *
 *  The previous report numbered his twelve answers from 1 and the mismatch shapes
 *  from 1 as well, so "item 6" named two different things and he said so: "Some of
 *  the examples given are in the section 1 table so that's confusing." Every list
 *  here now has a prefix of its own — `A` for his first twelve answers, `R` for his
 *  eight new rulings, `D` for the four defects he found in the report itself, `S` for
 *  a difference his ruling settles, `M` for one still open, `U` for something that
 *  cannot be rendered, `C` for a fact this run confirms — and nothing refers to a row
 *  by a bare number.
 *
 *  `M` NUMBERS ARE NOT STABLE BETWEEN ROUNDS. They are ordered by how many steps a
 *  shape affects, and this round moved shapes in and out, so his round-2 item numbers
 *  are mapped to their new homes in the `R` table rather than left to be guessed.
 *
 *  The repo owner's answers to rows 1-12 of the previous report, with what was
 *  done about each. He is the deciding evidence — he knows FileMaker directly and
 *  wrote both scripts — so these are rulings, not opinions to weigh against the
 *  corpus.
 *
 *  Here rather than only in a document so the round-trip he re-reads states the
 *  disposition of his own answers, and so a later pass cannot quietly reopen one
 *  he has accepted. Every shape is described generically: no field, table, layout,
 *  script or file name of his appears in this file. */
const RULINGS = [
  {
    n: 1,
    shape: 'an option slot FileMaker prints with nothing in it, and empty brackets for a step with no options',
    answer: "FM is very inconsistent with this so I'm ok with whatever we do here.",
    disposition: 'implemented',
    landed:
      'by his INDIFFERENCE, not his confirmation. The catalog carries <code>whenAbsent</code> for a labelled slot ' +
      'and <code>emptyBrackets</code> for a step with none, both measured. Six of the 27 rows still differ: two pad ' +
      'the empty brackets with spaces, two print an unlabelled empty slot first (no label, so nothing can say which ' +
      'key it belongs to), and two show the slot on only 2 of the 3 examples that omit the key, so the rule ' +
      'declines rather than inventing a default.',
  },
  {
    n: 2,
    shape: 'FileMaker prints its placeholder for a broken field reference and we print nothing',
    answer: "I don't know what you mean that FM prints 'bare'. But clearly what we do is not correct.",
    disposition: 'partly implemented',
    landed:
      'the report\'s "&lt;bare&gt;" was our own jargon for an unlabelled option and it is gone from this report. ' +
      'On the substance he is right that what we printed was wrong, and for the placeholder itself we cannot fix it: the ' +
      'CLI reports NO key for a reference whose table is gone — the JSON is identical to a step with no field at ' +
      'all — so there is nothing to render from. The one signal that does distinguish them is a bit in `flags`, ' +
      'which this catalog treats as step structure. The other shapes this row collapsed are listed separately now, ' +
      'because they are different questions.',
    updated:
      '<b>Superseded by R2.</b> The placeholder IS written out now. The signal really is one bit of ' +
      '<code>flags</code>, and section 5 shows the CLI&rsquo;s own output for a broken reference and an intact one ' +
      'side by side so you can check that claim rather than accept it.',
  },
  {
    n: 3,
    shape: 'FileMaker prints the mode a script is specified by; we printed a stale script name instead',
    answer: "item 3 is clearly completely wrong and I don't understand your reasoning for it.",
    disposition: 'implemented',
    landed:
      'the report asked the wrong question. Two new facts: `keyPresence`, an option whose text is a function of ' +
      'which keys the CLI reports, and `hiddenWhen`, which stops the stale name being printed. The parameter slot ' +
      'comes from ruling 1. The callback variant still fails, and for a reason worth having: its parameter lives in ' +
      "the CLI's `slots` object, which nothing in the catalog could reach.",
    updated:
      '<b>Superseded by R3.</b> That parameter is now written out: the values the CLI does not name are no longer ' +
      'out of reach.',
  },
  {
    n: 4,
    shape: 'a file option prints the file name only',
    answer: 'FM does not print the prefix.',
    disposition: 'implemented',
    landed:
      '`pathForm` on every file option, asserted on his ruling and verified against every placement rather than ' +
      'measured key by key — the corpus can only tell the two rules apart on two keys. Nothing contradicts it.',
  },
  {
    n: 5,
    shape: "FileMaker's own colon spacing varies; ours does not",
    answer: "I have never noticed but it is cosmetic, just always use 'label: value' with no space after label.",
    disposition: 'implemented',
    landed:
      'we emit one form and do not reproduce his Workspace\'s variants, so the comparison normalises colon spacing ' +
      'on BOTH sides. This is the one normalisation here that the design spec does not name: it is applied on his ' +
      'authority and the count moves because of it, which is why it is stated with his words rather than folded in.',
  },
  {
    n: 6,
    shape: 'a repetition of 1',
    answer: 'FM does not print the rep number if it is 1.',
    disposition: 'implemented',
    landed: '`omittedValues` on the repetition. The rule was in the derivation\'s code and reached no consumer.',
  },
  {
    n: 7,
    shape: 'the animation option, which we printed twice',
    answer: 'this conclusion is wrong, clearly FM does print the animation option.',
    disposition: 'withdrawn',
    landed:
      'he is right and the report was wrong: FileMaker prints it once, we printed it twice. The false fact is ' +
      'WITHDRAWN on two step types, and what its examples really showed is the animation option in its ' +
      'absent-key form, which is now `whenAbsent`. The real animation key is untouched and still renders.',
  },
  {
    n: 8,
    shape: 'an empty repetition bracket on a variable target, and a repetition FileMaker appends that we do not',
    answer: 'item 8 is clearly wrong, there is no rep # 0 and ours is missing the [100].',
    disposition: 'partly implemented',
    landed:
      'the empty bracket now renders, and it is described as an empty slot rather than as a repetition number — ' +
      'there is no repetition zero anywhere in the catalog or the code. The appended repetition on the OTHER ' +
      'option we cannot render: the CLI reports one repetition for the step and it belongs to the response target, ' +
      'so the number FileMaker shows on the second option is never sent to us.',
    updated:
      '<b>Re-examined under R4 and confirmed as a CLI gap.</b> Section 4 now shows the CLI&rsquo;s own output for the ' +
      'step beside your line, which is the evidence that was missing from this answer.',
  },
  {
    n: 9,
    shape: 'two options we print and FileMaker does not',
    answer: "item 9 and 10: I'm ok with how we do it.",
    disposition: 'accepted as is',
    landed:
      'deliberately unchanged, and protected: the rule that would have suppressed them is hand-stated and confined ' +
      'to ruling 3 rather than derived, because a derived rule would have reached into these rows against his answer.',
  },
  {
    n: 10,
    shape: 'a dialog option we print and FileMaker does not',
    answer: "item 9 and 10: I'm ok with how we do it.",
    disposition: 'accepted as is',
    landed: 'deliberately unchanged, for the same reason as ruling 9.',
  },
  {
    n: 11,
    shape: 'options FileMaker prints and we omit',
    answer: "item 11: that's the opposite and not ok, we should not omit options.",
    disposition: 'partly implemented',
    landed:
      'taken as the general principle it is: where we must choose, print. One of the seven shapes is now rendered ' +
      "(a table's absent-key placeholder). The rest are options the CLI never sends at all — a literal SQL text, a " +
      'privilege set name, an action — or content inside its <code>slots</code> object, which is the largest single ' +
      'structural gap left and is named as such. On one step what we print got SHORTER: an option two keys had claimed by ' +
      'sharing a word with it is withdrawn, and no reported key holds that value, so nothing replaces it.',
    updated:
      '<b>Partly superseded by R3.</b> The unnamed-value object is no longer a structural gap, so several of the ' +
      'options this row covered are now written out &mdash; see section 5 for how many. The ones the CLI genuinely ' +
      'never sends are in section 4 with its output beside them.',
  },
  {
    n: 12,
    shape: "a window style option we omitted, which the CLI does report under a name we were not looking for",
    answer:
      "that's an impossible question for me, I don't know the cli output by heart. Either that option is there and " +
      "you're looking for it by the wrong name, or the option is not there and it is a CLI defect.",
    disposition: 'implemented',
    landed:
      'his first branch was right, and this question should never have been put to him — it was answerable from the ' +
      "CLI's own JSON. The value is a set of flags, and the name FileMaker displays follows from one flag inside it. " +
      'The catalog now names that flag for each style.',
  },
];

/** His EIGHT NEW RULINGS on the second reading, each with the round-2 item number he
 *  used, so he can find what he wrote about. Same standard as the table above: his
 *  words verbatim, every shape described generically, no name of his anywhere. */
const ROUND_TWO = [
  {
    n: 1,
    was: 'the whole cause family "we print an option FileMaker does not"',
    answer:
      "In general any 'weAddAnOption' is not a problem, FM does not always show all configured options so if we do then that is fine.",
    disposition: 'implemented',
    landed:
      'taken as the GENERAL ruling it is, so it supersedes the two shapes accepted one at a time in round 1 ' +
      '(<b>A9</b> and <b>A10</b>). Every such row leaves the list of differences worth your judgement and goes into ' +
      'section 3 with a count of its own. The information is kept and the question stops being asked.',
  },
  {
    n: 2,
    was: 'items 1 and 10 — an external reference we drop',
    answer: 'item 1, 10: what we are missing is that this is an external reference, not ok to skip.',
    disposition: 'implemented',
    landed:
      'you were right on both, and they were two different failures. The file a script lives in ' +
      '(<code>from file: …</code>) IS sent — inside the object the CLI uses for values it does not name — and it is ' +
      'now rendered, on four step types, including the form where FileMaker prints it INSIDE the script option with ' +
      'no separator. The broken-reference placeholder is now rendered too: see <b>R3</b> and <b>U1</b>.',
  },
  {
    n: 3,
    was: 'the values the CLI reports without naming them',
    // Not a quotation, and not presented as one: this follows from R2 and from your
    // own reading of the CLI's output, where the parameter and the file name are
    // both plainly there.
    answer: null,
    disposition: 'implemented',
    landed:
      'the CLI puts values it does not name in one object, and 146 of the 1203 steps carry one. Nothing reached them, ' +
      'so we silently dropped content FileMaker prints. Each is now treated as an option like any other and works out ' +
      'the same way — by matching what FileMaker printed — rather than being mapped by hand. Section 5 counts how ' +
      'many now render.',
  },
  {
    n: 4,
    was: 'item 2 — the repetition number FileMaker appends and we do not',
    answer: 'item 2: not ok to skip the rep.',
    disposition: 'not implementable — reported as a CLI gap with the evidence',
    landed:
      'two separate things, and you are right about one of them. The EMPTY brackets on the target are the ' +
      'unspecified repetition and now render (there is no repetition 0 anywhere in this work, exactly as you said). ' +
      'The <code>[100]</code> on the other option is not in the CLI\'s output in any form — not as a value, not ' +
      'inside the unnamed values. <b>U2</b> shows the CLI\'s own output beside your line so the claim is checkable.',
  },
  {
    n: 5,
    was: 'items 6, 12, 13, 20 and 22 — "that doesn\'t look like we are comparing the same script step"',
    answer: "that doesn't look like we are comparing the same script step.",
    disposition: 'implemented — two real causes, both addressed',
    landed:
      'the pairing was right in every one of them, and two things made it look wrong. First the highlighting was ' +
      'broken (<b>D2</b>) and scrambled the words. Second FileMaker really does show a DIFFERENT SET of options ' +
      'depending on another option, which we did not express at all. One step type is the clean case: the account ' +
      'type decides an <code>Authenticate via</code> option, whether the next option is labelled ' +
      '<code>Account Name</code> or <code>Group Name</code>, and whether the password option appears at all. All ' +
      'three are now derived from the values the CLI reports. Any row whose two sides still look unrelated now says ' +
      'why in words, with the file, the text line and the step number on both sides.',
  },
  {
    n: 6,
    was: 'item 25 — spacing',
    answer: "item 25: we don't care about whitespace differences.",
    disposition: 'implemented',
    landed:
      'a row whose two sides are the same once every space is ignored is now SETTLED BY YOU, in section 3 with its ' +
      'own count — kept separate from the rows better rendering fixed, exactly as your colon ruling (<b>A5</b>) ' +
      'already is.',
  },
  {
    n: 7,
    was: "the CLI's placeholder for a function it cannot resolve",
    answer: "that's ok, we just render as we see it. This is a CLI defect because it currently cannot use FM plugins.",
    disposition: 'implemented',
    landed:
      'it stops being a category of its own and becomes ordinary output: we print the placeholder the CLI sends. The ' +
      'one row where FileMaker prints the real function name instead is settled by you and counted in section 3, ' +
      'with your explanation recorded as the cause.',
  },
  {
    n: 8,
    was: 'your question about the steps the CLI cannot read',
    answer: 'I don\'t understand the opaque - does the CLI not include that script step at all??',
    disposition: 'answered, at the top of section 4',
    landed:
      'the step IS included. It is stripped of every option and carries the CLI\'s own explanation of why. The whole ' +
      'thing, verbatim, is the first item in section 4, with the line FileMaker writes for the same step beside it.',
  },
];

/** The four defects he hit in the REPORT rather than in the rendering. One of them
 *  caused another, and that is the important one: unusable highlighting is why five
 *  rows looked mis-paired. */
const DEFECTS = [
  {
    n: 1,
    was: 'two lists both numbered from 1, so "item 6" named two things',
    quote: "Some of the examples given are in the section 1 table so that's confusing.",
    fixed:
      'every list now has a letter of its own and nothing is referred to by a bare number. Your round-2 item numbers ' +
      'are mapped to their new homes in the table above.',
  },
  {
    n: 2,
    was: 'the highlighting marked runs of characters, so it opened mid-word',
    quote: "everything is highlighted so I'm not sure exactly what you are referring to.",
    fixed:
      'the comparison is now made at OPTION boundaries, and inside an option at whole words. A row highlights which ' +
      'option differs, never a fragment of a word. Where the two have no option in common there is no highlighting ' +
      'at all — it says so in a sentence instead. <b>This was not cosmetic:</b> it is why five rows looked like they ' +
      'were comparing different steps (<b>R5</b>).',
  },
  {
    n: 3,
    was: 'section 4 was written in our vocabulary, not yours',
    quote: 'the whole preamble is not understandable. The concept of Line and Segment are foreign.',
    fixed:
      'rewritten in terms of a script step and the options inside its brackets. The words "line" and "segment" are ' +
      'gone from everything you read, as "bare" already was, and no example is repeated from an earlier section — ' +
      'they are cross-referenced by their letters instead.',
  },
  {
    n: 4,
    was: 'you had to ask for the CLI\'s own output',
    quote: 'Give me a raw ndjson output for some of these script steps.',
    fixed:
      'every claim of the form "the CLI does not send this" now shows the CLI\'s own output for the step, verbatim, ' +
      'beside your line. Section 4 does it for each category. You should not have had to ask.',
  },
];

/** Every place in the CLI's unnamed-value bag, and the DISPOSITION of each.
 *
 *  **A PARTITION, ASSERTED — and "unaccounted for" is not one of its parts.** Every
 *  place the CLI sends must be exactly one of: written out as an option, recorded as
 *  never shown, or named in `unresolved` with the reason the data could not settle it.
 *  Nothing may fall outside those three.
 *
 *  It used to report an `unaccounted` count, and 11 places sat in it for two rounds. That
 *  is the same hole as the bare `ignored` list before it carried evidence: content we
 *  neither show nor explain, with nowhere for the doubt to live. Two things were wrong,
 *  and only one of them was in the data:
 *
 *   - 9 places really were unexplained, and they turned out to be a repetition that is a
 *     CALCULATION rather than a number: the CLI has no name for one, so it arrives here,
 *     and FileMaker prints it inside the field it belongs to. `addRepetitionSuffix` in
 *     scripts/fm-segment-parse.mjs now credits them, on the same bracket evidence it
 *     already used for a named repetition key.
 *   - the other 2 were explained all along, in `unresolved` with a cause and an
 *     observation count, and THIS FUNCTION was not reading that list. A disposition the
 *     tally cannot see is a disposition nobody can be held to.
 *
 *  So the count cannot drift back: `assertSlotPartition` throws rather than printing a
 *  number nobody acts on, and `tests/step-display-catalog.test.ts` asserts the same
 *  partition in `npm test`. */
function countSlots(catalog, rows) {
  const withSlots = rows.filter((row) => row.json && Object.hasOwn(row.json, 'slots'));
  const segments = Object.values(catalog).flatMap((entry) => entry.segments.filter((item) => item.slot));
  const refs = (list) =>
    new Set((list ?? []).filter((item) => item.slot).map((item) => segmentID(item)));
  const tally = { instances: 0, addressed: 0, neverShown: 0, unsettled: 0, settled: 0 };
  const outside = [];
  for (const row of withSlots) {
    const entry = catalog[row.step] ?? { segments: [], ignored: [] };
    const placed = refs(entry.segments);
    const hidden = refs(entry.ignored);
    const unsettled = refs(entry.unresolved);
    let all = true;
    for (const [member, held] of Object.entries(row.json.slots)) {
      const here =
        held !== null && typeof held === 'object' && !Array.isArray(held)
          ? Object.keys(held).map((number) => segmentID({ key: 'slots', slot: { member, number } }))
          : [segmentID({ key: 'slots', slot: { member } })];
      for (const ref of here) {
        tally.instances += 1;
        if (placed.has(ref)) tally.addressed += 1;
        else if (hidden.has(ref)) tally.neverShown += 1;
        else if (unsettled.has(ref)) {
          tally.unsettled += 1;
          all = false;
        } else {
          outside.push({ step: row.step, ref, script: row.script, index: row.index });
          all = false;
        }
      }
    }
    if (all) tally.settled += 1;
  }
  // The places whose disposition is `unresolved`, named with their reason, so the report
  // can print each one rather than a count. One entry per distinct (step type, slot).
  const named = [];
  for (const [name, entry] of Object.entries(catalog)) {
    for (const item of entry.unresolved ?? []) {
      if (!item.slot) continue;
      const places = withSlots.filter(
        (row) => row.step === name && slotReported(row.json, item.slot),
      ).length;
      named.push({ step: name, ref: segmentID(item), cause: item.cause, observations: item.observations ?? 0, places });
    }
  }
  return {
    ...tally,
    outside,
    named: named.sort((a, b) => b.places - a.places || a.step.localeCompare(b.step)),
    steps: withSlots.length,
    written: withSlots.filter((row) => row.contributed.some((key) => key.startsWith('slots.'))).length,
    segments: segments.length,
    types: Object.values(catalog).filter((entry) => entry.segments.some((item) => item.slot)).length,
    claimed: Object.values(catalog).reduce(
      (sum, entry) => sum + entry.ignored.filter((item) => item.slot).length,
      0,
    ),
  };
}

/** Does this step report the value at this slot address? */
function slotReported(json, slot) {
  const held = json?.slots?.[slot.member];
  if (held === undefined) return false;
  if (slot.number === undefined) return true;
  return held !== null && typeof held === 'object' && Object.hasOwn(held, slot.number);
}

/** THE INVARIANT, made unshippable rather than commented. Every place the CLI sends is
 *  rendered, recorded as never shown, or unresolved with a reason — and the three add up
 *  to the total with nothing left over. */
function assertSlotPartition(slots) {
  const parts = slots.addressed + slots.neverShown + slots.unsettled;
  if (slots.outside.length > 0) {
    const first = slots.outside
      .slice(0, 5)
      .map((item) => `${item.step} ${item.ref} (script ${item.script} step ${item.index})`)
      .join('; ');
    throw new Error(
      `${slots.outside.length} of the CLI's ${slots.instances} unnamed values have no disposition at ` +
        `all — neither rendered, nor recorded as never shown, nor unresolved with a reason: ${first}. ` +
        'Give each one a disposition in the derivation; "unaccounted for" is not a category.',
    );
  }
  if (parts !== slots.instances) {
    throw new Error(
      `the unnamed-value partition does not add up: ${slots.addressed} rendered + ${slots.neverShown} ` +
        `never shown + ${slots.unsettled} unresolved = ${parts}, not ${slots.instances}`,
    );
  }
}

/** The named claims that the CLI does not send something, each with the step it was
 *  measured on. These are the three he asked about by number, and each is stated as a
 *  CLI gap with the CLI's own output rather than as something we might yet fix.
 *
 *  Every step here is FOUND in the data, never hard-coded: this file may contain no
 *  content of his, and a hand-written example would be exactly that. */
function cliGaps(rows) {
  const gaps = [];
  const first = (predicate) => rows.find(predicate) ?? null;

  // R4, his item 2: "not ok to skip the rep."
  const appendedRows = rows.filter(
    (row) => row.verdict === 'mismatch' && String(row.detail ?? '').startsWith('a bracket FileMaker adds'),
  );
  // Prefer the step he actually pointed at: the one that carries BOTH halves of his
  // item 2 — the unspecified repetition on one option and the appended number on
  // another. Chosen by the data (`repetition` reported as 0), never hard-coded.
  const appended =
    appendedRows.find((row) => oneLine(row.json?.repetition) === '0') ?? appendedRows[0] ?? null;
  if (appended) {
    gaps.push({
      title: 'The repetition FileMaker appends to an option — your item 2, ruling R4',
      note:
        'You are right that skipping it is not ok, and right that there is no repetition 0. Both halves of that are ' +
        'now settled, and they turned out to be two different things. The step reports ONE repetition, it is ' +
        '<code>0</code>, and <code>0</code> means "not specified" — so FileMaker prints it as EMPTY brackets, which ' +
        'we now do, and the words "repetition 0" appear nowhere in this work. The number FileMaker appends to the ' +
        'OTHER option is not in the CLI\'s output in any form: not as a value of its own, not inside the bag of ' +
        'unnamed values, nowhere. Compare the two yourself below. <b>This is a CLI gap, not something our writing-out ' +
        'can fix.</b>',
      rows: [appended],
    });
  }

  // R2, his item 1: the broken reference. Now rendered — the evidence is what makes
  // the claim checkable, so both states are shown side by side.
  const broken = first((row) => row.fmCompared.includes('<Table Missing>'));
  const intact = broken
    ? first(
        (row) =>
          row.step === broken.step &&
          row !== broken &&
          !row.fmCompared.includes('<Table Missing>') &&
          !Object.hasOwn(row.json ?? {}, 'field'),
      )
    : null;
  if (broken && intact) {
    gaps.push({
      solved: true,
      title: 'A reference whose table is gone — your item 1, ruling R2',
      note:
        'You said skipping this is not ok. It is not skipped any more. Here is why it was hard and why the fix is ' +
        'checkable rather than a guess: <b>the CLI sends no key at all for the reference</b>, so a step with a broken ' +
        'reference and a step with no reference are the same object apart from one thing. Compare the two below — the ' +
        'only difference is the <code>flags</code> number, and the low bit is set in the broken one and clear in the ' +
        'other. That one bit is the only signal there is, and it is now read for exactly this: it separates the two ' +
        'states in ELEVEN different keys on eleven unrelated step types, always the same bit, which is why it is ' +
        'treated as a fact rather than as a number fitted to one step. Two step types still cannot say which option ' +
        'the placeholder belongs to, and they are reported rather than guessed.',
      rows: [broken, intact],
    });
  }

  // R5's separate CLI gap: the privilege set. Found by the option FileMaker prints
  // and no reported key could own.
  const privilege = first(
    (row) => row.verdict === 'mismatch' && String(row.detail ?? '').includes('Privilege Set'),
  );
  if (privilege) {
    gaps.push({
      title: 'A privilege set name — the part of ruling R5 that is a CLI gap',
      note:
        'The rest of this step type is now right: the authentication method, the switch between the two names for the ' +
        'account option, and the password option disappearing for an external account are all worked out from the ' +
        'values the CLI sends. The privilege set is not among them. It is in no key, and not in the bag of unnamed ' +
        'values either &mdash; see for yourself below.',
      rows: [privilege],
    });
  }
  return gaps;
}

/** Why a value in the CLI's bag could not be settled either way, in his vocabulary. The
 *  internal names are the derivation's `StepUnresolvedCause`; he should not have to learn
 *  them, and each of these is a real statement about the evidence rather than a shrug. */
const SLOT_UNSETTLED = {
  withdrawn: 'we found a rendering for it and hand review established that the rendering was false',
  refuted: 'we could not claim FileMaker never shows it, because its value appears in the line under ' +
    'another option — so it IS shown, and nothing says which option owns it',
  opaqueMetadata: "its only appearances were on steps the CLI could not read, so there is no clean observation",
  labelOwnedElsewhere: 'the only evidence was that nothing else was left over, and the label it would have ' +
    'claimed is one FileMaker printed for another key',
};

/** Every internal cause name, in HIS vocabulary — a script step and the options
 *  inside its brackets. He read the previous report's own words back at us: "the
 *  whole preamble is not understandable. The concept of Line and Segment are
 *  foreign." Those two words are gone from everything he reads, as `<bare>` already
 *  was, and this is where the translation lives so nothing can print the internal
 *  name by accident. */
const CAUSE_WORDS = {
  weOmitAnOption: 'FileMaker prints an option and we print nothing for it',
  weAddAnOption: 'we print an option FileMaker does not',
  sameOptionDifferentText: 'both print the option, with different text in it',
  differentOptionSets: 'a different set of options altogether',
  optionOrder: 'the same options, in a different order',
  presentationRule: 'a rule about how something is printed',
  catalogMarkedMismatch: "FileMaker's text cannot be produced from the value the CLI sends",
  structuredValue: 'the CLI sends a nested object here and we cannot tell which part is printed',
  noDisplayForm: 'FileMaker has a word for this value that your scripts never showed us',
  suffixHostMissing: 'this prints inside another option, and that option printed nothing',
  noValue: 'the CLI sends the option with no value and FileMaker prints something',
  unreported: 'FileMaker shows something the CLI never sends',
};

/** The causes that are CLAIMS ABOUT WHAT THE CLI DOES NOT SEND. Each one gets the
 *  CLI's own output for the step beside it, because that is the only thing the claim
 *  can be checked against — and he had to ask for it: "Give me a raw ndjson output
 *  for some of these script steps." */
const CLI_CLAIM_CAUSES = new Set([
  'weOmitAnOption',
  'differentOptionSets',
  'sameOptionDifferentText',
  'unreported',
  'noValue',
  'structuredValue',
]);

/** Which ruling settles each accepted difference, named with its ID so he can go
 *  straight to his own words for it. */
const SETTLED_BY = {
  ownerAcceptedExtraOption: 'R1 &mdash; an option we print and FileMaker does not',
  ownerAcceptedWhitespace: 'R6 &mdash; spacing only',
  ownerAcceptedFunctionMissing: 'R7 &mdash; the CLI cannot resolve a plugin function',
  ownerAcceptedCatalogMismatch: 'R8 &mdash; the case format of a value is not worth normalising',
};

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** MARK WHICH OPTION DIFFERS, and inside it which words.
 *
 *  The previous version compared the two texts character by character and marked the
 *  run between the first and last difference. On a real pair that opens the highlight
 *  in the middle of a word: extracting the HTML gave `A uthenticate via` and
 *  `A ccount Name`. The owner's verdict on it was "everything is highlighted so I'm
 *  not sure exactly what you are referring to" — and worse, five rows looked to him
 *  like they were comparing different steps, because the words on screen were
 *  scrambled.
 *
 *  So the comparison happens at the boundaries FileMaker itself writes:
 *
 *   1. the step name and the options inside its brackets are separated first;
 *   2. an option present on both sides is left alone;
 *   3. an option only one side prints is marked whole;
 *   4. two options sharing a label are compared WORD BY WORD, and only whole words
 *      are marked.
 *
 *  Where the two have no option in common — or one of them has no brackets at all —
 *  nothing is highlighted and the caller is given a sentence to print instead.
 *  Highlighting everything says nothing, which is exactly what he reported.
 *
 *  Splitting the options on `;` shreds a calculation that contains one. That makes
 *  the marks finer than they should be on such a row and can never make a difference
 *  invisible, and no verdict depends on it: this is presentation only. */
function markPair(left, right) {
  const a = splitForMarking(left);
  const b = splitForMarking(right);
  if (a.options === null || b.options === null || a.head !== b.head) {
    return { left: escapeHtml(left), right: escapeHtml(right), whole: true };
  }
  const shared = sharedOptions(a.options, b.options);
  if (shared.count === 0 && a.options.length + b.options.length > 2) {
    return { left: escapeHtml(left), right: escapeHtml(right), whole: true };
  }
  const marked = markByLabel(a.options, b.options, shared);
  const render = (head, parts) =>
    `${escapeHtml(head)}${head === '' ? '' : ' '}[ ${parts.join(' ; ')} ]`;
  return { left: render(a.head, marked.left), right: render(b.head, marked.right) };
}

/** The step name, and the options inside the outer brackets. `options` is null when
 *  the step renders with no brackets at all. */
function splitForMarking(line) {
  const open = line.indexOf('[');
  const close = line.lastIndexOf(']');
  if (open === -1 || close < open) return { head: line, options: null };
  return {
    head: line.slice(0, open).trimEnd(),
    options: line
      .slice(open + 1, close)
      .split(';')
      .map((piece) => piece.trim())
      .filter((piece) => piece !== ''),
  };
}

/** Which options both sides print, as a multiset: two copies on one side and one on
 *  the other leaves one copy marked. */
function sharedOptions(left, right) {
  const pool = [...right];
  const same = new Set();
  let count = 0;
  left.forEach((text, at) => {
    const found = pool.indexOf(text);
    if (found === -1) return;
    pool.splice(found, 1);
    same.add(`L${at}`);
    count += 1;
  });
  const poolLeft = [...left];
  right.forEach((text, at) => {
    const found = poolLeft.indexOf(text);
    if (found === -1) return;
    poolLeft.splice(found, 1);
    same.add(`R${at}`);
  });
  return { same, count };
}

/** Mark what is left, pairing a differing option with the one that carries the same
 *  label so the mark lands on the words that actually differ. */
function markByLabel(left, right, shared) {
  const out = { left: left.map((text) => escapeHtml(text)), right: right.map((text) => escapeHtml(text)) };
  const openRight = right.map((text, at) => ({ text, at })).filter((item) => !shared.same.has(`R${item.at}`));
  left.forEach((text, at) => {
    if (shared.same.has(`L${at}`)) return;
    const found = openRight.findIndex((item) => optionName(item.text) === optionName(text));
    if (found === -1) {
      out.left[at] = `<mark>${escapeHtml(text)}</mark>`;
      return;
    }
    const partner = openRight.splice(found, 1)[0];
    const [markedLeft, markedRight] = markWords(text, partner.text);
    out.left[at] = markedLeft;
    out.right[partner.at] = markedRight;
  });
  for (const item of openRight) out.right[item.at] = `<mark>${escapeHtml(item.text)}</mark>`;
  return out;
}

/** Two versions of one option, marked at WORD boundaries. A mark never opens inside
 *  a word — that was the whole defect. */
function markWords(left, right) {
  const a = left.split(' ');
  const b = right.split(' ');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  const limit = Math.min(a.length, b.length) - head;
  while (tail < limit && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const cut = (words) => {
    const middle = words.slice(head, words.length - tail);
    return [
      escapeHtml(words.slice(0, head).join(' ')),
      middle.length === 0 ? '<mark class="empty"></mark>' : `<mark>${escapeHtml(middle.join(' '))}</mark>`,
      escapeHtml(words.slice(words.length - tail).join(' ')),
    ]
      .filter((piece) => piece !== '')
      .join(' ');
  };
  return [cut(a), cut(b)];
}

/** Why the two sides of a row can look like different steps when they are not.
 *
 *  Stated on any row whose two sides share no option, because the owner read five
 *  such rows as a pairing error — reasonably, since the highlighting was scrambling
 *  the words at the time. The pairing is verifiable from the row itself, so the note
 *  gives him both halves of it. */
function whyItLooksWrong(row) {
  const fmName = splitForMarking(row.fm).head.trim() || row.fm.trim();
  const sameName = fmName.toLowerCase() === String(row.step).toLowerCase();
  return (
    `Not a pairing error, and here are both halves of it: ${row.file} line ${row.textLine} begins ` +
    `“${fmName}”, and step ${row.index} of the same script is “${row.step}”. ` +
    (sameName
      ? 'One step, seen twice — FileMaker is simply showing a different SET of options here, which is a fact about ' +
        'the step rather than about the pairing.'
      : 'The two names differ because FileMaker prints a name that comes from outside the script and the CLI prints ' +
        'its own; the pairing is by position and it is right.')
  );
}

const STYLE = `
:root { color-scheme: light dark; }
body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
       margin: 0 auto; max-width: 1500px; padding: 24px 20px 80px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 34px 0 6px; border-bottom: 2px solid currentColor; padding-bottom: 4px; }
h3 { font-size: 13px; margin: 22px 0 4px; }
p, li { max-width: 100ch; }
.sub { opacity: .7; margin: 0 0 18px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 18px; }
th, td { border: 1px solid rgba(128,128,128,.45); padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: rgba(128,128,128,.16); font-weight: 600; white-space: nowrap; }
td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pair { display: grid; grid-template-columns: 3.6em 1fr; gap: 2px 8px; margin: 2px 0; }
.pair b { opacity: .65; font-weight: 600; }
.pair span { white-space: pre-wrap; word-break: break-word; }
mark { background: rgba(255, 196, 0, .45); color: inherit; border-radius: 2px; padding: 0 1px; }
mark.empty { outline: 2px solid rgba(255, 196, 0, .8); padding: 0 2px; }
.q { margin: 6px 0 0; padding: 5px 8px; border-left: 3px solid rgba(128,128,128,.6);
     background: rgba(128,128,128,.09); }
.cite { opacity: .7; }
.tag { display: inline-block; border: 1px solid rgba(128,128,128,.6); border-radius: 3px;
       padding: 0 4px; margin-right: 4px; font-size: 11px; }
.pass { font-weight: 700; }
details { margin: 10px 0; border: 1px solid rgba(128,128,128,.45); border-radius: 4px; padding: 8px 12px; }
summary { cursor: pointer; font-weight: 600; }
h4 { font-size: 13px; margin: 18px 0 4px; }
pre { white-space: pre-wrap; word-break: break-word; background: rgba(128,128,128,.1);
      padding: 8px 10px; border-radius: 3px; margin: 6px 0; max-height: 34em; overflow: auto; }
.warn { border-left: 3px solid rgba(220, 80, 0, .9); padding-left: 10px; }
`;

function pairBlock(fm, ours) {
  if (ours === null) {
    return (
      `<div class="pair"><b>FM</b><span>${escapeHtml(fm)}</span>` +
      '<b>ours</b><span><em>(nothing rendered)</em></span></div>'
    );
  }
  const marked = markPair(fm, ours);
  const note = marked.whole
    ? '<div class="cite">No highlighting here: the two have no option in common, so marking them would mark ' +
      'everything. Read them side by side.</div>'
    : '';
  return (
    `<div class="pair"><b>FM</b><span>${marked.left}</span>` +
    `<b>ours</b><span>${marked.right}</span></div>${note}`
  );
}

/** A row's two sides, plus the sentence that says why they may look unrelated. */
function pairWithReason(row) {
  const marked = row.ours === null ? { whole: true } : markPair(row.fmCompared, row.ours);
  return pairBlock(row.fmCompared, row.ours) + (marked.whole ? `<p class="q">${escapeHtml(whyItLooksWrong(row))}</p>` : '');
}

/** The step exactly as the Claris ADT CLI reports it.
 *
 *  He asked for this — "Give me a raw ndjson output for some of these script steps" —
 *  and should not have had to: every claim that the CLI does not send something is
 *  only checkable against the CLI's own output. One object per step, printed with line
 *  breaks added for reading; nothing is edited, reordered or left out. */
function cliOutput(row, caption) {
  return (
    '<details><summary>' +
    escapeHtml(caption ?? "the CLI's own output for this step, verbatim") +
    `</summary><p class="cite">One element of the <code>body</code> array in the CLI's <code>read:script</code> ` +
    'result, printed with line breaks added. Nothing edited or omitted, with one exception: a password value is ' +
    'replaced by the mask FileMaker itself shows. The CLI sends it and FileMaker does not, and this report will not ' +
    'be the thing that prints it.</p>' +
    `<pre>${escapeHtml(JSON.stringify(row.json, null, 2))}</pre></details>`
  );
}

function cite(row) {
  return `<span class="cite">${escapeHtml(row.file)}:${row.textLine} &middot; script ${row.script} step ${row.index}</span>`;
}

function buildHtml(state) {
  const { rows, groups, settled, candidates, applied, accepted, catalog, alignFailures, slots, ladder } = state;
  const total = rows.length;
  const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
  const causeCount = (cause) => rows.filter((row) => row.cause === cause).length;
  const out = [];
  const say = (text) => out.push(text);

  say('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  say('<title>fm-step-display round-trip</title>');
  say(`<style>${STYLE}</style></head><body>`);
  say('<h1>Step display catalog — round-trip against FileMaker&rsquo;s own text</h1>');
  say(
    `<p class="sub">Every one of the ${total} script steps in your two scripts, written out from ` +
      '<code>src/catalogs/fm-step-display.json</code> alone and compared with what your Script Workspace wrote for the ' +
      'same step. Generated by <code>scripts/roundtrip-step-display.mjs</code>; this file is not committed.</p>',
  );
  say(
    '<p class="warn"><b>Every row in this report has a letter now, and nothing is referred to by a bare number.</b> ' +
      'Last time two different lists both started at 1 and you said so: &ldquo;Some of the examples given are in the ' +
      'section 1 table so that&rsquo;s confusing.&rdquo; <b>A</b>1&ndash;12 are your first twelve answers, ' +
      '<b>R</b>1&ndash;8 your eight new rulings, <b>D</b>1&ndash;4 the four things wrong with the report itself, ' +
      '<b>S</b> a difference your ruling settles, <b>M</b> one still open, <b>U</b> something that cannot be written ' +
      'out at all, <b>C</b> a fact this run confirms. The <b>M</b> numbers are ordered by how many steps a shape ' +
      'affects, so they are NOT the same numbers as last time &mdash; your round-2 item numbers are mapped to their ' +
      'new homes in section 1c.</p>',
  );

  // -- 1 ---------------------------------------------------------------
  say('<h2>1 &middot; Summary</h2>');
  say('<table><tr><th>Outcome</th><th>Steps</th><th>What it means</th></tr>');
  say(
    `<tr><td>Written out exactly</td><td class="n">${count('exact')} / ${total}</td>` +
      '<td>character for character what FileMaker wrote, after the normalisations below</td></tr>',
  );
  say(
    `<tr><td>Settled by your rulings</td><td class="n">${count('accepted')} / ${total}</td>` +
      '<td>a difference you have already ruled does not matter &mdash; section 3</td></tr>',
  );
  say(
    `<tr><td>Still different</td><td class="n">${count('mismatch')} / ${total}</td>` +
      '<td>we write something and it is not what FileMaker wrote &mdash; section 2</td></tr>',
  );
  say(
    `<tr><td>Cannot be written out</td><td class="n">${count('unrenderable')} / ${total}</td>` +
      '<td>nothing to write from, or FileMaker shows something no value the CLI sends could produce &mdash; ' +
      'section 4</td></tr>',
  );
  say('</table>');
  say(
    `<p class="warn"><b>What the ${count('exact')} is made of, because one number hides two things.</b></p><ul>` +
      `<li><b>${ladder.byteIdentical}</b> are character for character what FileMaker wrote with NO normalisation at ` +
      `all. ${ladder.afterSpec} after the two the design spec allows, ${count('exact')} after your colon ruling. ` +
      'So the normalisations decide ' +
      `${count('exact') - ladder.byteIdentical} of them, and the rest need nothing forgiven.</li>` +
      `<li><b>${ladder.noOptionsExact} of them are steps you wrote with no options at all</b> &mdash; a comment, a ` +
      `block ender, a step with empty brackets. ${ladder.emptyComment} are an empty comment. There are ` +
      `${ladder.noOptions} such steps in the two scripts, and reproducing one means reproducing a step name. The real ` +
      `work is the ${total - ladder.noOptions} steps where you set at least one option, and ` +
      `${count('exact') - ladder.noOptionsExact} of those come out exactly right.</li></ul>`,
  );
  say(
    '<p><b>The two kinds of movement are reported separately, and that is deliberate.</b> The previous report ' +
      'ended at 890 exact, 155 different and 158 unwritable. Of the change since:</p><ul>' +
      `<li><b>${count('exact') - 890} more steps come out exactly right because the catalog can now say things it ` +
      'could not.</b> That is the only number that measures the work.</li>' +
      `<li><b>${count('accepted')} steps moved into &ldquo;settled by your rulings&rdquo;</b> &mdash; ` +
      `${accepted.extraOption} by <b>R1</b>, ${accepted.whitespace} by <b>R6</b>, ${accepted.functionMissing} by ` +
      `<b>R7</b>, ${accepted.catalogMismatch} by <b>R8</b>. Nothing about those rows changed; you ruled that the ` +
      'difference does not matter, so they stop ' +
      'being presented as defects and keep a count of their own.</li>' +
      `<li><b>${158 - count('unrenderable')} steps left &ldquo;cannot be written out&rdquo;</b>, for two reasons. ` +
      'The values the CLI reports without naming them are no longer invisible (<b>R3</b>), and 22 steps were in that ' +
      'group for reasons that did not survive a review of how it was decided &mdash; see the paragraph below. Some ' +
      'now come out exactly right and some are merely different, but we are no longer claiming they are ' +
      'impossible.</li></ul>',
  );
  say(
    '<p>Four counts, one denominator, deliberately never averaged into a percentage: the last group is not work our ' +
      'side can do, so folding it in would read as a score for the writing-out and would be wrong. <b>That group used ' +
      'to be bigger, and wrongly.</b> A step went into it whenever the matcher had no key left over to hang the ' +
      'missing text on &mdash; which is a question about attribution, not about whether anything could be written. ' +
      '22 steps have moved out of it into section 2, where they belong: 11 were a plain defect of ours (a value the ' +
      'CLI DOES send, inside the bag it does not name, read as a value it never sends) and 11 differ for a reason our ' +
      'own classification already names. A step is only in the last group now if the missing text is in no key and in ' +
      `no slot AND the whole difference is an option FileMaker prints and we do not. Steps whose two views could not ` +
      `be paired at all: ${alignFailures.length}.</p>`,
  );
  say('<p><b>Normalisations applied</b> &mdash; two from the design spec, two from you:</p><ul>');
  say(
    `<li><code>&#10145;&#127757;</code> stripped &mdash; <b>${applied.marker} steps</b>. ` +
      'Recorded in the spec as meaningless for our purposes.</li>',
  );
  say(
    `<li>A truncated option compared by the fragments that survive &mdash; <b>${applied.truncationFinal + applied.truncationNonFinal} steps</b> ` +
      `(${applied.truncationFinal} cut on the last option, ${applied.truncationNonFinal} on an earlier one), with ` +
      `<b>${applied.truncationBlocked} further truncated steps</b> that never reach the check because they also differ for a ` +
      'reason in section 2. So your scripts do contain truncation and this normalisation currently decides nothing &mdash; ' +
      'reported that way rather than as a bare zero. The spec words the rule as &ldquo;it ends in &hellip;&rdquo;, and one of ' +
      'your steps is cut on a NON-FINAL option and carries text after it, so the rule had to widen to &ldquo;the surviving ' +
      'fragments appear in order&rdquo;.</li>',
  );
  say(
    `<li><b>Colon spacing, on both sides &mdash; ${applied.colonTouched} steps touched, ${applied.colonDecided} decided by it` +
      `, and all ${applied.colonFromAccepted} of those differ ONLY in spacing, so your whitespace ruling would settle ` +
      'them anyway: this rung moves steps out of section 3 and into the exact count, and takes none off the list of ' +
      'differences.</b> ' +
      'Your ruling (<b>A5</b>): &ldquo;I have never noticed but it is cosmetic, just always use &lsquo;label: value&rsquo; with no ' +
      'space after label.&rdquo; So we write one form and do not reproduce your Workspace&rsquo;s variants ' +
      '(<code>Object Name : &hellip;</code>, <code>Group Name:&hellip;</code>). A colon inside a URL is left alone.</li>',
  );
  say(
    `<li><b>Spacing generally &mdash; ${accepted.whitespace} steps settled by it.</b> Your ruling (<b>R6</b>): ` +
      '&ldquo;we don&rsquo;t care about whitespace differences.&rdquo; A step whose two versions are the same once ' +
      'every space is ignored is counted in section 3 under your ruling rather than folded into the exact count, so ' +
      'the headline stays honest. Line breaks are NOT ignored &mdash; a comment&rsquo;s line breaks are content.</li>',
  );
  say(
    `<li><b>The case format of a value &mdash; NOT normalised, ${accepted.catalogMismatch} step accepted instead.</b> ` +
      'Your ruling (<b>R8</b>): &ldquo;I don&rsquo;t understand why this is an issue; we&rsquo;re just reading so who ' +
      'cares what the case format is. There&rsquo;s no reason to normalize and make things more complex.&rdquo; So no ' +
      'fifth normalisation was added: the step is counted in section 3 under your ruling, not in the exact count.</li>',
  );
  say('</ul>');
  say('<details><summary>The five rules an earlier round wanted the comparison to forgive, and why none is</summary>');
  say(
    '<p>An earlier report listed five presentation rules it wanted to normalise away and would not, totalling 67 ' +
      'steps at the time. Four have since been settled &mdash; three by your rulings, one by a fact in the catalog ' +
      '&mdash; and an independent review re-measured what each would buy <b>today</b> if the comparison simply ' +
      'forgave it. It would grant none of them, and the reasons are worth having:</p><ul>' +
      '<li><b>the empty option slot &mdash; 10 steps.</b> Belongs in the catalog, not in the comparison. 17 of the ' +
      'original 27 already became a fact (<b>A1</b>); the 10 left are an empty slot with NO label, which the catalog ' +
      'structurally cannot express yet. Dropping empty options from both sides would stop measuring whether we ' +
      'reproduce a slot you demonstrably print.</li>' +
      '<li><b>the file-name rule &mdash; 0 steps.</b> Your ruling <b>A4</b> put it in the catalog, and a blanket fold ' +
      'now buys nothing. This is the model for the other four.</li>' +
      '<li><b>colon spacing &mdash; applied</b>, on your ruling <b>A5</b>, to both sides, counted above.</li>' +
      '<li><b>the repetition &mdash; 16 steps, and they must not be bought.</b> Ignoring the contents of inner ' +
      'brackets on both sides is the largest single block of matches available anywhere in this work. Every one of ' +
      'those 16 is FileMaker showing a repetition number the CLI never sends &mdash; which is the thing you ruled ' +
      '&ldquo;not ok to skip&rdquo; (<b>R4</b>). Buying them would mean redefining the comparison to hide a gap you ' +
      'asked to see.</li>' +
      '<li><b>a run of spaces &mdash; 0 steps, and it was never a rule about FileMaker.</b> It was a defect of ours: ' +
      'our value text was collapsing runs of spaces, including inside a quoted string, where two spaces are a ' +
      'different value and not different spacing. Fixed rather than forgiven, and 3 of those steps now come out ' +
      'exactly right.</li></ul>',
  );
  say('</details>');

  // -- 1b --------------------------------------------------------------
  say('<h2>1b &middot; Your first twelve answers (A1&ndash;A12)</h2>');
  say(
    '<p class="sub">Unchanged from the previous report except for the letters. Kept here so a later pass cannot ' +
      'quietly reopen one you settled &mdash; and because <b>R1</b> supersedes two of them, which is only readable ' +
      'against the originals.</p>',
  );
  say('<table><tr><th>ID</th><th>Disposition</th><th>The shape, and your answer</th><th>What was done</th></tr>');
  for (const ruling of RULINGS) {
    const badge =
      ruling.disposition === 'implemented'
        ? '<span class="pass">implemented</span>'
        : ruling.disposition === 'withdrawn'
          ? '<b>withdrawn</b>'
          : escapeHtml(ruling.disposition);
    const superseded = ruling.updated
      ? `<p class="q">${ruling.updated}</p>`
      : ruling.n === 9 || ruling.n === 10
        ? '<p class="q"><b>Superseded by R1</b>, which rules the whole family fine rather than these two shapes ' +
          'one at a time.</p>'
        : '';
    say(
      `<tr><td class="n"><b>A${ruling.n}</b></td><td>${badge}</td>` +
        `<td>${escapeHtml(ruling.shape)}<p class="q">&ldquo;${escapeHtml(ruling.answer)}&rdquo;</p></td>` +
        `<td>${ruling.landed}${superseded}</td></tr>`,
    );
  }
  say('</table>');

  // -- 1c --------------------------------------------------------------
  say('<h2>1c &middot; Your eight new rulings (R1&ndash;R8), and the four report defects (D1&ndash;D4)</h2>');
  say(
    '<p class="sub">Your second reading, with the round-2 item number you used, so you can find what you wrote ' +
      'about. Where a ruling could not be carried out the reason is stated and the CLI&rsquo;s own output is shown ' +
      'for it, rather than the row being quietly dropped.</p>',
  );
  say('<table><tr><th>ID</th><th>Disposition</th><th>What you were looking at, and your words</th><th>What was done</th></tr>');
  for (const ruling of ROUND_TWO) {
    const badge = ruling.disposition.startsWith('implemented')
      ? `<span class="pass">${escapeHtml(ruling.disposition)}</span>`
      : ruling.disposition.startsWith('not')
        ? `<b>${escapeHtml(ruling.disposition)}</b>`
        : escapeHtml(ruling.disposition);
    say(
      `<tr><td class="n"><b>R${ruling.n}</b></td><td>${badge}</td>` +
        `<td>${escapeHtml(ruling.was)}${
          ruling.answer === null
            ? '<p class="cite">Not a quotation: this one follows from <b>R2</b> and from your own reading of the ' +
              'CLI&rsquo;s output, where the parameter and the file name are both plainly there.</p>'
            : `<p class="q">&ldquo;${escapeHtml(ruling.answer)}&rdquo;</p>`
        }</td>` +
        `<td>${ruling.landed}</td></tr>`,
    );
  }
  say('</table>');
  say('<table><tr><th>ID</th><th>What was wrong with the report</th><th>Your words</th><th>What was done</th></tr>');
  for (const defect of DEFECTS) {
    say(
      `<tr><td class="n"><b>D${defect.n}</b></td><td>${escapeHtml(defect.was)}</td>` +
        `<td class="q">&ldquo;${escapeHtml(defect.quote)}&rdquo;</td><td>${defect.fixed}</td></tr>`,
    );
  }
  say('</table>');

  // -- 2 ---------------------------------------------------------------
  const affected = groups.reduce((sum, group) => sum + group.rows.length, 0);
  say('<h2>2 &middot; Still different, and worth your judgement (M1&ndash;M' + groups.length + ')</h2>');
  say(
    `<p class="sub">${groups.length} shapes covering all ${affected} steps that still come out differently. Steps that ` +
      'differ in the same way are collapsed into one shape, with the step types inside it named, so nothing is hidden ' +
      `by the collapse; a shape covering fewer than ${OWN_ROW_THRESHOLD} steps has no row of its own and is folded ` +
      'into the last row for its cause, which lists everything it swallowed. The highlight marks WHICH OPTION differs, ' +
      'and inside an option only whole words. Each shape ends in the one question your FileMaker knowledge can settle ' +
      'and the data cannot.</p>',
  );
  say('<table><tr><th>ID</th><th>Steps</th><th>What differs</th><th>FileMaker vs ours, and the question</th></tr>');
  groups.forEach((group, at) => {
    const example = group.rows[0];
    const steps = [...group.steps.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => `<span class="tag">${escapeHtml(name)} &times;${n}</span>`)
      .join(' ');
    const folded =
      group.folded.size === 0
        ? ''
        : `<div style="margin-top:4px">folded in: ${[...group.folded]
            .sort()
            .map((detail) => `<span class="tag">${escapeHtml(detail)}</span>`)
            .join(' ')}</div>`;
    // The CLI's own output goes on any shape whose cause is a claim about what the
    // CLI does not send. That claim is only checkable against it.
    const evidence = CLI_CLAIM_CAUSES.has(group.cause) ? cliOutput(example) : '';
    say(
      `<tr><td class="n"><b>M${at + 1}</b></td><td class="n">${group.rows.length}</td>` +
        `<td><b>${escapeHtml(CAUSE_WORDS[group.cause] ?? group.cause)}</b><br>${escapeHtml(group.detail)}</td><td>` +
        pairWithReason(example) +
        `<div>${cite(example)}</div><div style="margin-top:4px">${steps}</div>${folded}${evidence}` +
        `<p class="q">${escapeHtml(questionFor(group))}</p></td></tr>`,
    );
  });
  say('</table>');

  // -- 3 ---------------------------------------------------------------
  say('<h2>3 &middot; Settled by your rulings (S1&ndash;S' + settled.length + ')</h2>');
  say(
    `<p class="sub">${count('accepted')} steps, in ${settled.length} shapes. These are differences you have already ` +
      'ruled on, so they are not questions any more and they are not counted as defects &mdash; but the count stays ' +
      'visible, because &ldquo;we do this and FileMaker does not&rdquo; is worth knowing even when it is fine.</p>',
  );
  say('<table><tr><th>ID</th><th>Steps</th><th>Your ruling</th><th>FileMaker vs ours</th></tr>');
  settled.forEach((group, at) => {
    const example = group.rows[0];
    const steps = [...group.steps.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => `<span class="tag">${escapeHtml(name)} &times;${n}</span>`)
      .join(' ');
    say(
      `<tr><td class="n"><b>S${at + 1}</b></td><td class="n">${group.rows.length}</td>` +
        `<td><b>${SETTLED_BY[group.cause] ?? escapeHtml(group.cause)}</b><br>${escapeHtml(group.detail)}</td><td>` +
        pairWithReason(example) +
        `<div>${cite(example)}</div><div style="margin-top:4px">${steps}</div></td></tr>`,
    );
  });
  say('</table>');

  // -- 4 ---------------------------------------------------------------
  say('<h2>4 &middot; Cannot be written out at all (U1&ndash;U4)</h2>');
  say(
    `<p class="sub">${count('unrenderable')} steps. Each category below shows the CLI&rsquo;s own output for the ` +
      'step, because each one is a claim about what the CLI does not send and that output is the only thing such a ' +
      'claim can be checked against.</p>',
  );

  const opaque = rows.filter((row) => row.cause === 'opaque');
  say('<h3>U1 &middot; The steps the CLI cannot read &mdash; ' + opaque.length + ' steps</h3>');
  say(
    '<p class="q"><b>Your question:</b> &ldquo;I don&rsquo;t understand the opaque - does the CLI not include that ' +
      'script step at all??&rdquo;</p>',
  );
  if (opaque.length > 0) {
    const example = opaque[0];
    const reason = typeof example.json?.reason === 'string' ? example.json.reason : null;
    say(
      '<p><b>The step IS included.</b> It is included and stripped of every option, and it says why in its own ' +
        `words${reason ? `: &ldquo;${escapeHtml(reason)}&rdquo;` : ''}. Here is one, exactly as the CLI sends it, ` +
        'beside the step FileMaker writes for it. Everything after the step name in FileMaker&rsquo;s version is ' +
        'simply absent from the CLI&rsquo;s, so there is nothing to write from &mdash; not a gap in our knowledge, ' +
        'an absence in the data.</p>',
    );
    say(pairWithReason(example) + `<div>${cite(example)}</div>`);
    say(`<pre>${escapeHtml(JSON.stringify(example.json, null, 2))}</pre>`);
    say(
      `<p class="cite">One element of the <code>body</code> array in the CLI&rsquo;s <code>read:script</code> result, ` +
        'printed with line breaks added. Nothing edited or omitted, except that a password value is replaced by the ' +
        'mask FileMaker itself shows.</p>',
    );
  }

  const unreported = rows.filter((row) => row.cause === 'unreported' && row.verdict === 'unrenderable');
  say(`<h3>U2 &middot; FileMaker shows what the CLI never sends &mdash; ${unreported.length} steps</h3>`);
  say(
    '<p>FileMaker prints an option, no value the CLI sends could produce it, and the whole difference is that ' +
      'option: a privilege set name, a table name it resolves from an internal number, a repetition it never ' +
      'reports.</p>',
  );
  say(
    '<p class="warn"><b>Read this bucket with one rider, because it used to overstate itself.</b> "No value the CLI ' +
      'sends" means no key and no slot that this work reads. It deliberately does not read the packed ' +
      '<code>flags</code> number as a source of options &mdash; that is a design choice, not a measurement &mdash; ' +
      'and for a handful of these steps the option FileMaker shows is a boolean whose state is plausibly in there. ' +
      'Those are honestly unresolved rather than impossible. The 22 steps that were in here for worse reasons have ' +
      'moved to section 2.</p>',
  );
  for (const item of state.gaps.filter((item) => !item.solved)) {
    say(`<h4>${escapeHtml(item.title)}</h4><p>${item.note}</p>`);
    for (const row of item.rows) {
      say(pairWithReason(row) + `<div>${cite(row)}</div>`);
      say(`<pre>${escapeHtml(JSON.stringify(row.json, null, 2))}</pre>`);
    }
  }
  if (unreported.length > 0) {
    say('<details><summary>two more of the same kind</summary>');
    for (const row of unreported.slice(0, 2)) {
      say(pairWithReason(row) + `<div>${cite(row)}</div>` + cliOutput(row));
    }
    say('</details>');
  }

  const plugin = rows.filter((row) => row.cause === 'nameUnverifiable');
  say(`<h3>U3 &middot; The step&rsquo;s own name comes from an installed plugin &mdash; ${plugin.length} step</h3>`);
  say(
    '<p>FileMaker prints the registered name of the plugin that is installed; the CLI sends only the four-byte ' +
      'plugin code, so no name can be worked out from the script.</p>',
  );
  for (const row of plugin) say(pairWithReason(row) + `<div>${cite(row)}</div>` + cliOutput(row));

  const placeholder = rows.filter((row) => (row.ours ?? '').includes(FUNCTION_MISSING));
  const alsoFm = placeholder.filter((row) => row.fmCompared.includes(FUNCTION_MISSING));
  say(`<h3>U4 &middot; A function the CLI cannot resolve &mdash; ${placeholder.length} steps, none of them unwritable any more</h3>`);
  say(
    '<p>Your ruling (<b>R7</b>): &ldquo;that&rsquo;s ok, we just render as we see it. This is a CLI defect because it ' +
      'currently cannot use FM plugins.&rdquo; So this is no longer a category of its own: we write the placeholder ' +
      `the CLI sends. In ${alsoFm.length} of these ${placeholder.length} steps FileMaker cannot resolve the function ` +
      `either and writes the same placeholder, so the step comes out exactly right. In the other ` +
      `${placeholder.length - alsoFm.length} FileMaker writes the real function name, because the plugin is ` +
      'installed &mdash; and that step is now counted in section 3 under your ruling, with the cause recorded as ' +
      'yours: the CLI cannot call FileMaker plugins.</p>',
  );
  for (const row of placeholder) say(pairWithReason(row) + `<div>${cite(row)}</div>`);

  // -- 5 ---------------------------------------------------------------
  say('<h2>5 &middot; The two things the CLI does not say out loud (R2, R3)</h2>');
  say(
    '<p class="sub">Both of your &ldquo;not ok to skip&rdquo; rulings turned on the same difficulty: FileMaker was ' +
      'printing something the CLI does report, but not under a name. Both are now written out, and both are stated ' +
      'here with the CLI&rsquo;s own output so the claim is checkable rather than something to take on trust.</p>',
  );
  for (const item of state.gaps.filter((gap) => gap.solved)) {
    say(`<h3>${escapeHtml(item.title)}</h3><p>${item.note}</p>`);
    for (const row of item.rows) {
      say(pairWithReason(row) + `<div>${cite(row)}</div>`);
      say(`<pre>${escapeHtml(JSON.stringify(row.json, null, 2))}</pre>`);
    }
    say(
      '<p class="cite">Two elements of the <code>body</code> array in the CLI&rsquo;s <code>read:script</code> ' +
        'result, printed with line breaks added. Nothing edited or omitted, except that a password value is replaced ' +
        'by the mask FileMaker itself shows.</p>',
    );
  }
  say('<h3>The bag of values the CLI does not name — your ruling R3</h3>');
  say(
    `<p>The CLI puts some values in one bag instead of giving them names of their own: a script parameter, a ` +
      `calculated title, the file a script lives in, the field a barcode is scanned into. <b>${slots.steps} of the ` +
      `${total} steps carry that bag</b>, and nothing in the catalog could reach inside it, so we were dropping ` +
      'content FileMaker prints and, worse, claiming FileMaker never shows it.</p>',
  );
  say(
    `<p><b>Each value in the bag is now treated as an option like any other</b> &mdash; found by matching what ` +
      'FileMaker printed, not by a hand-written map. Counted at the level that matters, one place in the bag at a ' +
      `time, those ${slots.steps} steps hold <b>${slots.instances}</b> of them:</p><ul>` +
      `<li><b>${slots.addressed}</b> are an option we now write out, described by ${slots.segments} facts on ` +
      `${slots.types} step types. ${slots.written} steps write out at least one.</li>` +
      `<li><b>${slots.neverShown}</b> are recorded as places FileMaker does not show, in ${slots.claimed} claims. ` +
      'The commonest is an internal number FileMaker turns into a name it looks up elsewhere &mdash; a table, a menu ' +
      'set, a script &mdash; which is not in the CLI&rsquo;s output at all (<b>U2</b>).</li>' +
      `<li><b>${slots.unsettled}</b> are ones the data could not settle, and each one now SAYS SO with its reason ` +
      `rather than sitting in a bucket called unaccounted for. They are why ${slots.steps - slots.settled} of the ` +
      `${slots.steps} steps are not fully explained:</li></ul>`,
  );
  if (slots.named.length > 0) {
    say('<table><tr><th>Step type</th><th>Where in the bag</th><th class="n">places</th><th>Why it is unsettled</th></tr>');
    for (const item of slots.named) {
      say(
        `<tr><td>${escapeHtml(item.step)}</td><td><code>${escapeHtml(item.ref)}</code></td>` +
          `<td class="n">${item.places}</td><td>${escapeHtml(SLOT_UNSETTLED[item.cause] ?? item.cause)} ` +
          `(${item.observations} observation(s))</td></tr>`,
      );
    }
    say('</table>');
  }
  say(
    `<p>The three add up to ${slots.instances} with nothing outside them, and the run FAILS if they ever do not ` +
      '&mdash; so a value the CLI sends can be shown, or known not to be shown, or admitted to be unsettled, but ' +
      'never quietly ignored. Nine of the eleven that were unaccounted for in the last round turned out to be a ' +
      'repetition written as a CALCULATION: the CLI has no name for one, and FileMaker prints it inside the field it ' +
      `belongs to, which we now do. <p>Before any of this, none of the ${slots.instances} was reachable and all ` +
      `${slots.steps} steps carried the claim that FileMaker never shows the bag, which was false in every one.</p>`,
  );

  // -- 6 ---------------------------------------------------------------
  const verdicts = (name) => candidates.filter((item) => item.verdict === name);
  say(`<h2>6 &middot; Facts this run confirms (C1&ndash;C${candidates.length})</h2>`);
  say(
    '<p><b>What this section is.</b> The catalog holds one fact per option of each script step: the words FileMaker ' +
      'puts before it, the way it shows the value, and where it sits between the brackets. Some of those facts were ' +
      'marked uncertain when they were worked out &mdash; not because anything contradicted them, but because they ' +
      'rested on one step each, and one step can agree by luck. Writing out all ' +
      `${total} steps and comparing them is the check they were waiting for. There are ${candidates.length} such ` +
      'facts, and this says which ones survived it.</p>',
  );
  say(
    '<p><b>Why four answers and not two.</b> A step can come out wrong because of a DIFFERENT option than the one ' +
      'being checked, and counting that against this option would condemn it for someone else&rsquo;s problem. So ' +
      'each step is asked the narrow question instead: does FileMaker&rsquo;s version of this step contain exactly ' +
      'this option, on its own, as we wrote it?</p><ul>' +
      '<li><b>confirmed</b> &mdash; at least one whole step came out character for character right and nothing ' +
      'contradicts the option.</li>' +
      '<li><b>the option is right, the step is not</b> &mdash; every step contains this option exactly as we wrote ' +
      'it, but no whole step survived a different option&rsquo;s problem. Confirmed as soon as that is fixed.</li>' +
      '<li><b>right as far as it goes</b> &mdash; FileMaker writes our option and then adds something to it that we ' +
      'do not write. The words and the value are right; what it adds is a question in section 2.</li>' +
      '<li><b>not confirmed</b> &mdash; at least one step does not contain the option at all. That is evidence ' +
      'against the fact, and the reason it should stay marked uncertain.</li></ul>' +
      `<p><b>confirmed ${verdicts('passes').length} &middot; option right, step not ${verdicts('optionExact').length} ` +
      `&middot; right as far as it goes ${verdicts('optionPrefix').length} &middot; not confirmed ` +
      `${verdicts('unconfirmed').length} &middot; nothing to test it with ${verdicts('untested').length}</b></p>`,
  );
  say(
    '<table><tr><th>ID</th><th>Answer</th><th>Step type</th><th>The option</th>' +
      '<th class="n">exact / option only / FM&nbsp;adds / against</th><th>Example</th></tr>',
  );
  candidates.forEach((item, at) => {
    const badge =
      item.verdict === 'passes'
        ? '<span class="pass">confirmed</span>'
        : item.verdict === 'optionExact'
          ? 'option right, step not'
          : item.verdict === 'optionPrefix'
            ? 'right as far as it goes'
            : item.verdict === 'unconfirmed'
              ? '<b>not confirmed</b>'
              : 'nothing to test it with';
    const where = item.segment.slot
      ? `one of the values the CLI does not name (${escapeHtml(item.segment.slot.member)}${item.segment.slot.number === undefined ? '' : ` ${escapeHtml(item.segment.slot.number)}`})`
      : escapeHtml(item.segment.key);
    say(
      `<tr><td class="n"><b>C${at + 1}</b></td><td>${badge}</td><td>${escapeHtml(item.step)}</td>` +
        `<td>${item.segment.label ? `<b>${escapeHtml(item.segment.label)}:</b> ` : ''}${where}</td>` +
        `<td class="n">${item.exact} / ${item.optionOnly} / ${item.appended} / ${item.against}</td>` +
        `<td>${item.example ? pairBlock(item.example.fmCompared, item.example.ours) + cite(item.example) : '&mdash;'}</td></tr>`,
    );
  });
  say('</table>');
  say(
    '<p>Comparing a whole step at once checks the words, the way the value is shown and the position together, which ' +
      'is more than working the fact out from one option could. It does not widen the limit that matters most: an ' +
      'option FileMaker only reveals when some OTHER option is set is still invisible from inside these two scripts, ' +
      'however many times it agrees here.</p>',
  );

  // -- appendix --------------------------------------------------------
  say('<h2>Appendix &middot; per step type</h2>');
  say('<details><summary>Every step type with at least one step that is not exact</summary>');
  say(
    '<table><tr><th>Step type</th><th class="n">steps</th><th class="n">exact</th>' +
      '<th class="n">settled by you</th><th class="n">different</th><th class="n">unwritable</th></tr>',
  );
  const byStep = new Map();
  for (const row of rows) {
    // Every verdict has a counter. Without `accepted` here the tally read NaN for a
    // step type his rulings settle, and its steps went missing from the total.
    if (!byStep.has(row.step)) byStep.set(row.step, { exact: 0, accepted: 0, mismatch: 0, unrenderable: 0 });
    byStep.get(row.step)[row.verdict] += 1;
  }
  const open = (tally) => tally.mismatch + tally.unrenderable;
  for (const [name, tally] of [...byStep.entries()].sort(
    (a, b) => open(b[1]) - open(a[1]) || b[1].accepted - a[1].accepted || a[0].localeCompare(b[0]),
  )) {
    if (open(tally) + tally.accepted === 0) continue;
    const seen = tally.exact + tally.accepted + open(tally);
    say(
      `<tr><td>${escapeHtml(name)}</td><td class="n">${seen}</td><td class="n">${tally.exact}</td>` +
        `<td class="n">${tally.accepted}</td><td class="n">${tally.mismatch}</td>` +
        `<td class="n">${tally.unrenderable}</td></tr>`,
    );
  }
  say('</table>');
  say(
    `<p>Step types with an entry in the catalog: ${Object.keys(catalog).length}. Step types every step of which came ` +
      `out exactly right: ${[...byStep.values()].filter((tally) => open(tally) + tally.accepted === 0).length}. ` +
      'A step type whose only differences are ones you settled is listed above with its count in that column, not ' +
      'silently folded in with the exact ones.</p>',
  );
  say('</details>');

  say('</body></html>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------

function summarise(state) {
  const { rows, groups, settled, candidates, applied, accepted, alignFailures, slots, ladder } = state;
  const total = rows.length;
  const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
  const causeCount = (cause) => rows.filter((row) => row.cause === cause).length;
  const say = (text = '') => console.log(text);

  say(`== round-trip: ${total} paired examples, ${alignFailures.length} alignment failures ==`);
  for (const failure of alignFailures) {
    say(`  FAILED script ${failure.script} step ${failure.index + 1} ${failure.step}: ${failure.reason}`);
  }
  say(`  exact         ${count('exact')} / ${total}`);
  say(`     byte-identical, with no normalisation at all:   ${ladder.byteIdentical}`);
  say(`     + the spec's two (the marker, truncation):      ${ladder.afterSpec}`);
  say(`     + his colon ruling:                             ${count('exact')}`);
  say(
    `     THE LAST RUNG RESCUES NO FAILURE: ${applied.colonFromAccepted} of the ${applied.colonDecided} rows it` +
      ' decides differ only in the spacing round a colon,',
  );
  say(
    "     so his whitespace ruling would settle them anyway — it moves them from ACCEPTED to exact and leaves",
  );
  say('     mismatch alone (measured: colon normalisation off gives exact 891, accepted 110, mismatch 94).');
  say(`     of which steps FileMaker printed with NO options: ${ladder.noOptionsExact} of ${ladder.noOptions}` +
    `  (${ladder.emptyComment} of them an empty comment)`);
  say(`  accepted      ${count('accepted')} / ${total}` +
    `  (his ruling R1 ${accepted.extraOption} | R6 ${accepted.whitespace} | R7 ${accepted.functionMissing}` +
    ` | R8 ${accepted.catalogMismatch})`);
  say(`  mismatch      ${count('mismatch')} / ${total}`);
  say(`  unrenderable  ${count('unrenderable')} / ${total}` +
    `  (opaque ${causeCount('opaque')} | CLI never reports ${causeCount('unreported')} | plugin name ${causeCount('nameUnverifiable')})`);
  say('  no blended accuracy figure is reported, and no 100% match is claimed.');
  say();
  say('== normalisations applied (the two the spec names, and the one the owner ruled) ==');
  say(`  marker stripped:            ${applied.marker} rows`);
  say(`  truncation, final option:   ${applied.truncationFinal} rows`);
  say(`  truncation, earlier option: ${applied.truncationNonFinal} rows  <- wider than the spec's wording; see the report`);
  say(`  truncated rows that fail for another reason and never reach the check: ${applied.truncationBlocked}`);
  say(`  colon spacing, BOTH sides:  ${applied.colonTouched} rows touched, ${applied.colonDecided} decided by it`);
  say("     his ruling: \"just always use 'label: value' with no space after label\"");
  say(`  spacing generally:          ${accepted.whitespace} rows settled by it, counted as accepted, not as exact`);
  say('     his ruling: "we don\'t care about whitespace differences"');
  say();
  say(`== settled by his rulings (${settled.length} shapes) ==`);
  for (const group of settled) {
    say(`  ${String(group.rows.length).padStart(3)}  ${group.cause} | ${group.detail}`);
    say(`       ${[...group.steps.keys()].sort().join(', ')}`);
  }
  say();
  say('== the CLI\'s unnamed values (his ruling R3) ==');
  say(`  steps carrying one: ${slots.steps}    places in the bag: ${slots.instances}`);
  say(
    `  rendered: ${slots.addressed}    recorded as never shown: ${slots.neverShown}` +
      `    unresolved with a reason: ${slots.unsettled}    outside the partition: ${slots.outside.length}`,
  );
  for (const item of slots.named) {
    say(`     ${item.step} | ${item.ref} | ${item.cause} (${item.observations} observation(s), ${item.places} place(s))`);
  }
  say(`  facts describing them: ${slots.segments} on ${slots.types} step types    steps writing out at least one: ${slots.written}`);
  say();
  say(`== mismatch shapes (M1-M${groups.length}) ==`);
  groups.forEach((group, at) => {
    say(`  M${String(at + 1).padEnd(3)} ${String(group.rows.length).padStart(3)}  ${group.cause} | ${group.detail}`);
    say(`       ${[...group.steps.keys()].sort().join(', ')}`);
  });
  say();
  const verdicts = (name) => candidates.filter((item) => item.verdict === name);
  say(`== promotion candidates (${candidates.length}) ==`);
  say(
    `  promote ${verdicts('passes').length} | option exact ${verdicts('optionExact').length}` +
      ` | option prefix ${verdicts('optionPrefix').length} | not confirmed ${verdicts('unconfirmed').length}` +
      ` | untested ${verdicts('untested').length}`,
  );
  for (const item of candidates) {
    say(`  [${item.verdict}] ${item.step} | ${item.segment.key} (${item.segment.render}, ${item.doubts.join('+')}) ${item.exact} exact / ${item.optionOnly} option-only / ${item.appended} FM-appends / ${item.against} against, of ${item.testifying}`);
  }
}

const state = run();
state.groups = groupRows(state.rows, 'mismatch');
state.settled = groupRows(state.rows, 'accepted');
state.slots = countSlots(state.catalog, state.rows);
// Before the report is written, so a partition with a hole cannot produce a document that
// looks complete.
assertSlotPartition(state.slots);
state.gaps = cliGaps(state.rows);
state.candidates = promotionCandidates(state.catalog, state.rows);
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, `${buildHtml(state)}\n`, 'utf8');
// After the report, because it changes the catalog on disk and the report is a
// statement about the catalog as this run read it.
const verified = writeVerified(state.catalog, verifiedEntries(state.catalog, state.rows));
summarise(state);
console.log();
sayVerified(verified, Object.keys(state.catalog).length);
console.log(`wrote ${path.relative(ROOT, REPORT_PATH)}`);

// A machine-readable copy of every row, on request only, so a later measurement can
// reason about THESE verdicts rather than forking the classification that produced the
// four counts. Nothing is written unless the variable is set.
//
// The rows quote the owner's own script text, so the path should be outside the repo.
// Masked values are already substituted: `json` is the redacted step (see `row.json`).
if (process.env.FMAI_ROUNDTRIP_ROWS) {
  fs.writeFileSync(process.env.FMAI_ROUNDTRIP_ROWS, `${JSON.stringify(state.rows)}\n`, 'utf8');
  console.log(`wrote ${process.env.FMAI_ROUNDTRIP_ROWS} (rows, on request)`);
}

function sayVerified(result, entries) {
  console.log(`== verified (written into ${path.relative(ROOT, CATALOG_PATH)}) ==`);
  console.log(
    `  ${result.verified} of ${entries} entries: every example of that step type came out exactly right`,
  );
  console.log(`  newly verified this run: ${result.changed.length}`);
  if (result.withdrawn.length > 0) {
    console.log(
      `  VERIFICATION WITHDRAWN from ${result.withdrawn.length}: ${result.withdrawn.join(', ')}`,
    );
  }
  if (result.changed.length === 0 && result.withdrawn.length === 0) {
    console.log('  the committed catalog already said exactly this, so it was not rewritten');
  }
  console.log();
}
