/** Write one script step out from `src/catalogs/fm-step-display.json`, exactly as
 *  the catalog says FileMaker's Script Workspace writes it.
 *
 *  **THIS IS THE ONLY CATALOG-DRIVEN RENDERER IN THE REPO, AND THAT IS THE POINT.**
 *  It ships (the read sheet's rows come from it, through `step-display.ts`) and
 *  `scripts/roundtrip-step-display.mjs` imports this same file to measure it against
 *  the 1203 lines FileMaker itself wrote. A second copy inside the round-trip would
 *  turn every figure that script reports into a claim about code the app does not
 *  run — and this project has already had the smaller version of that bug, where a
 *  helper's docstring said it mirrored the derivation and it did mirror the function
 *  while being called with the wrong view, mis-filing 11 steps as impossible.
 *
 *  Node strips types from `.ts` on import (22.18+), so the round-trip imports this
 *  source directly rather than a built artifact: there is no build step to forget and
 *  no dist copy to go stale. That constrains this file — erasable syntax only, no
 *  `enum`, and every type-only import written `import type` so nothing is left to
 *  resolve at run time.
 *
 *  **BASELINE FIRST, CATALOG SECOND — and that ordering is the correction this file
 *  carries.** It used to render only what an entry's `segments` named, so the catalog's
 *  authority to CLAIM a fact was also its authority to PRINT one: a key the derivation
 *  could not place, and a value whose display form it never measured, were both answered
 *  with silence. Those are different questions. What FileMaker renders is a measurement;
 *  what a developer is allowed to see is not. So:
 *
 *   - every value the CLI sends is printed SOMEHOW unless the catalog has strong measured
 *     evidence that FileMaker shows nothing for it (`ignored` at `measured` confidence, a
 *     `hiddenWhen`, an `omittedValues`, a flag that is off);
 *   - the catalog is the ENHANCEMENT: it supplies FileMaker's own label, order, display
 *     form and render kind wherever it measured them, and where it did not, the value is
 *     printed under the label we have and the shortfall is still reported in `gaps`. A
 *     `gap` now means "this option is not FileMaker's phrasing", not "this option is
 *     missing".
 *
 *  The owner's two rulings point the same way and are the authority for it: "we should not
 *  omit options", and "any weAddAnOption is not a problem, FM does not always show all
 *  configured options so if we do then that is fine."
 *
 *  WHAT IT DOES NOT DO, deliberately:
 *   - It never decides whether a step is renderable AT ALL. A step type the catalog
 *     has no entry for, an opaque step, a step whose displayed name comes from an
 *     installed plugin: each consumer answers those for itself, because the answers
 *     differ. The round-trip counts them as unwritable; the app falls back to the
 *     convention or shows the CLI's own name, since a blank row helps nobody.
 *   - It does not reclassify the catalog's strong evidence. A key `ignored` at `measured`
 *     confidence still prints nothing, because that is a measurement of FileMaker rather
 *     than a shortfall of ours — and it is the one claim in the catalog whose scope is the
 *     corpus rather than its own count (see `StepDisplayEntry.ignored`).
 */

import type { ScriptDetailStep } from '../types.ts';
import type {
  StepDisplayCatalog,
  StepDisplayEntry,
  StepSegment,
  StepSlotRef,
} from './step-display-types.ts';

/** The mask FileMaker prints instead of a password: eight U+2022, as measured. */
export const STEP_MASK = '••••••••';

/** The JSON carries FileMaker returns as `\r` and the Script Workspace shows a step
 *  on ONE row, so a return becomes a space. Measured, and the single fact about
 *  FileMaker that the comparison path is allowed to apply — see `normaliseCalc` in
 *  scripts/fm-script-align.mjs for the two matching tolerances that must NOT reach it.
 *
 *  `oneLine` in scripts/fm-script-align.mjs is the same two lines, and deliberately a
 *  separate copy: the derivation must not depend on the app's source, since the app
 *  depends on what the derivation produces. The agreement is CHECKED rather than
 *  claimed — `tests/step-display-catalog.test.ts` compares the two implementations
 *  directly, and the round-trip would move if they diverged, because the derivation
 *  matched every value through one of them and this renderer writes it out through the
 *  other. */
export function oneLine(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\r\n]+/g, ' ');
}

/** Every key the catalog says FileMaker masks, from every step type at once.
 *
 *  Collected GLOBALLY rather than per step type on purpose: a key FileMaker hides on
 *  one step is a secret wherever it appears, including on a step type this catalog has
 *  no entry for at all. Derived from the catalog, so a `masked` segment a later
 *  derivation adds is covered without anyone remembering to come back here.
 *
 *  Slot-addressed segments are excluded because a slot is not a key a caller can test
 *  by name; none is masked in this catalog and `assertNoMaskedSlots` in the round-trip
 *  keeps that true. */
export function maskedKeysOf(catalog: StepDisplayCatalog): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const entry of Object.values(catalog)) {
    for (const segment of entry.segments) {
      if (segment.render === 'masked' && !segment.slot) keys.add(segment.key);
    }
  }
  return keys;
}

/** Keys a projected step carries that FileMaker never shows on the step line, and
 *  which no consumer may print as an option.
 *
 *  Each one is an artefact rather than an option a user set:
 *   - `stepID`/`step` are the step's identity, drawn as the name.
 *   - `uuid` is ADT's durable handle for an edit path.
 *   - `flags` and `slots` are the two structural keys `read:script` documents. `slots`
 *     holds the values the CLI does not NAME, addressed one at a time by a segment's
 *     `slot`; printing the object itself would dump JSON into a row and could put a
 *     value the catalog masks on screen through a key nobody tested.
 *   - `block` is the extent the CLI derives on every read, never stored.
 *   - `collapsed` is whether the Script Workspace folded the block up.
 *   - `disabled` is FileMaker's Disable; a step list draws it as a marker on the row
 *     rather than as one of the step's options.
 *   - `opaque`/`editable` are the CLI saying it could not project this step.
 *   - `targetType` is derived from the varTarget string, is never sent, and has no
 *     counterpart on screen. */
export const ARTEFACT_KEYS: ReadonlySet<string> = new Set([
  'stepID',
  'step',
  'uuid',
  'flags',
  'slots',
  'block',
  'collapsed',
  'disabled',
  'opaque',
  'editable',
  'targetType',
]);

/** The catalog-derived tables both rendering paths need, built once per catalog.
 *
 *  A parameter rather than module state because this file imports no JSON: the app
 *  imports the catalog and the round-trip reads it with `fs`, and Node's type-stripping
 *  loader would not agree with either about a JSON import. */
export interface StepDisplayConventions {
  /** Every key any `masked` segment names, from every step type at once, spelled as the
   *  catalog spells it. Use `isMaskedKey` to TEST a key — this set is for a consumer that
   *  needs the names themselves. */
  maskedKeys: ReadonlySet<string>;
  /** Is this key one FileMaker masks? **THE ONE PREDICATE THE MASK GUARANTEE RESTS ON.**
   *
   *  Case-INSENSITIVE, deliberately. The set is derived from one corpus, which spells the
   *  key `password`; a file this catalog was never derived from can spell it `Password`,
   *  and a review got a literal onto the row that way. Matching case-insensitively costs
   *  nothing measured — no key in the corpus differs from a masked key only in case — and
   *  it closes half the spelling gap. The other half is inherent: a key that is not a
   *  case variant of one the corpus contains cannot be recognised at all. */
  isMaskedKey(key: string): boolean;
  /** Is this key one whose value must never be printed, on a path the catalog did not
   *  measure? **A STRICT SUPERSET OF `isMaskedKey`, and the wider one exists because the
   *  baseline prints values the old renderer dropped.**
   *
   *  `isMaskedKey` answers "did the catalog measure FileMaker masking this key", which is a
   *  fact and is what a `masked` segment renders from. This answers a safety question
   *  instead: does the key NAME a secret? It is true when any WORD of the key equals a
   *  masked key name, so `editPassword`, `openPassword` and `smtpPassword` are caught as
   *  well as `password` — and those three are exactly the keys the baseline started
   *  printing. Measured on this corpus: word matching adds nine key names, all of them
   *  password-ish, and `old`/`new` add none, while SUBSTRING matching would swallow
   *  `threshold` and `createFolders`. That is why it is words and not substrings.
   *
   *  It is deliberately NOT used where the catalog measured what FileMaker prints: `Add
   *  Account`'s `expirePassword` is a measured `bareWhenTrue` that prints its own label and
   *  no value at all, and masking it would replace a measured option with a mask for
   *  nothing. The wide test governs the value; the measurement governs the option. */
  isSecretKey(key: string): boolean;
  /** The label FileMaker writes for a key: this step type's measured one, else one
   *  every step type in the catalog agrees on, else the inferred rule. */
  labelFor(key: string, stepName?: string): string;
  /** True when every catalog segment for this key writes the value with no label. */
  writesBare(key: string): boolean;
}

/** The words of a key. fm 0.7.0 spells every multi-word option key in camelCase, so a
 *  key's word boundary is a capital rather than a space and a splitter that only knows
 *  about spaces sees `editPassword` as one word — which silently unmasked the three
 *  password keys the wide secret test exists for. Split at the humps as well, keeping
 *  an acronym run whole (`fileId` -> file, id; `verifySslCertificates` -> verify, ssl,
 *  certificates), then lower case. Also at a digit, because a numbered key spells its
 *  number as one (`input1Password` -> input, 1, password).
 *
 *  DELIBERATELY NOT THE SAME FUNCTION as `keyWords` in scripts/fm-segment-parse.mjs, which
 *  splits the same way and then drops words under three letters and folds a trailing `s`.
 *  That one compares a key against a LABEL, where a short word is noise; this one tests a
 *  key against a masked NAME and builds a label out of the words, where dropping `id` or
 *  folding `options` to `option` would be wrong. The derivation must not depend on the
 *  app's source anyway — see `oneLine` above for the same separation, checked rather
 *  than claimed. */
function keyWords(key: string): string[] {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/** A key spelled the way the CLI spells one: lower-case first letter, then letters and
 *  digits only. Only such a key gets the camel treatment — a key carrying spaces or its
 *  own capitals came from somewhere else (a consumer on an older fm, a plugin step) and
 *  is left as it was. */
const CLI_KEY = /^[a-z][A-Za-z0-9]*$/;

/** FileMaker capitalises a label's first word and lower-cases the rest, and a 0.7.0 key
 *  spells those same words in camelCase — so `withDialog` infers `With dialog`. A key of
 *  one word keeps its own spelling but for that first capital.
 *
 *  THE ONLY GUESS LEFT IN THE LABELS, and it cannot know about a capital inside a label
 *  (`Verify SSL Certificates`, `cURL options`) because fm 0.7.0 no longer spells one in
 *  the key. A TRAILING ACRONYM THEREFORE COMES OUT LOWER CASE: `externalID` infers
 *  `External id`, not `External ID`, because the words are lower-cased before the first
 *  is capitalised and nothing here knows which runs were acronyms. Used only for a key
 *  the catalog never labels. */
function inferredLabel(key: string): string {
  if (CLI_KEY.test(key)) {
    const words = keyWords(key);
    if (words.length > 1) {
      const text = words.join(' ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
  if (/^[a-z][A-Z]/.test(key)) return key;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function stepConventions(catalog: StepDisplayCatalog): StepDisplayConventions {
  const perStep = new Map<string, Map<string, { label: string; examples: number }>>();
  const global = new Map<string, Set<string>>();
  const bare = new Map<string, boolean>();
  const unlabelled = new Set<string>();
  for (const [name, entry] of Object.entries(catalog)) {
    const here = new Map<string, { label: string; examples: number }>();
    for (const segment of entry.segments) {
      // A slot's label belongs to a value the CLI did not name, not to a key a caller
      // can ask about, so it teaches nothing about the key `slots`.
      if (segment.slot) continue;
      bare.set(
        segment.key,
        (bare.get(segment.key) ?? true) && segment.render === 'bare' && segment.label === undefined,
      );
      if (segment.label === undefined) unlabelled.add(segment.key);
      if (segment.label === undefined) continue;
      const best = here.get(segment.key);
      if (best === undefined || segment.examples > best.examples) {
        here.set(segment.key, { label: segment.label, examples: segment.examples });
      }
      const labels = global.get(segment.key) ?? new Set<string>();
      labels.add(segment.label);
      global.set(segment.key, labels);
    }
    perStep.set(name, here);
  }
  // A key several step types label DIFFERENTLY has no global answer — `target` is
  // labelled seven ways — so it falls through to the rule rather than to a favourite.
  //
  // A STEP TYPE THAT RENDERS THE KEY WITH NO LABEL AT ALL COUNTS AGAINST the global answer
  // too, and that half was missing: a key one step type labels and eight render bare is not
  // a key the catalog agrees about, it is a key whose meaning is per step type. The 12 keys
  // this withdraws are all of that shape — `stepValue`, whose one label came from
  // `Set Dictionary` while eight step types render it as an unlabelled enum; `value`,
  // `records`, `repetition`, `scriptName`. Before this, the baseline printed
  // `Configure AI Account [ … ; Spelling Language: 0 ]`, taking a label off an unrelated
  // step type and putting it on the CLI's generic name for a step's single value. A wrong
  // label is worse than an inferred one, which is the whole reason this table is measured.
  const agreed = new Map<string, string>();
  for (const [key, labels] of global) {
    if (labels.size === 1 && !unlabelled.has(key)) agreed.set(key, [...labels][0]);
  }

  const masked = maskedKeysOf(catalog);
  const maskedLower = new Set([...masked].map((key) => key.toLowerCase()));
  return {
    maskedKeys: masked,
    isMaskedKey(key) {
      return maskedLower.has(String(key).toLowerCase());
    },
    isSecretKey(key) {
      const text = String(key).toLowerCase();
      if (maskedLower.has(text)) return true;
      // Word by word, so a masked name INSIDE a compound key is caught and a masked name
      // that merely appears inside a longer word is not: `editPassword` is a secret,
      // `threshold` is not `old`.
      return keyWords(key).some((word) => maskedLower.has(word));
    },
    labelFor(key, stepName) {
      const own = stepName === undefined ? undefined : perStep.get(stepName)?.get(key)?.label;
      return own ?? agreed.get(key) ?? inferredLabel(key);
    },
    writesBare(key) {
      return bare.get(key) === true;
    },
  };
}

/** This step type's entry, or `undefined` — by OWN property only.
 *
 *  A JSON module is an ordinary object, so it inherits `Object.prototype`: a plain
 *  `catalog[name]` lookup answers a truthy non-entry for `constructor`, `toString`,
 *  `valueOf`, `hasOwnProperty` and `__proto__`, and the renderer then died iterating
 *  `entry.segments`. Not reachable from FileMaker's fixed step vocabulary; reachable from
 *  any hand-built or proxied body, and a crash here takes out the whole read sheet. One
 *  helper rather than a rule to remember at each of the three lookup sites. */
export function catalogEntry(
  catalog: StepDisplayCatalog,
  name: unknown,
): StepDisplayEntry | undefined {
  if (typeof name !== 'string') return undefined;
  return Object.hasOwn(catalog, name) ? catalog[name] : undefined;
}

/** One option's identity in a caller's bookkeeping. The key alone is not enough:
 *  `slots` is a single key holding several values, so every slot segment of a step
 *  would otherwise answer to the same name and overwrite the others. */
export function segmentID(segment: { key: string; slot?: StepSlotRef }): string {
  if (!segment.slot) return segment.key;
  const { member, number } = segment.slot;
  return `slots.${member}${number === undefined ? '' : `.${number}`}`;
}

/** What the catalog does not say, named. Not a bucket: each one is one missing fact,
 *  and a gap never stops a line being produced — a line missing one option tells a
 *  reviewer far more than no line at all. */
export type StepRenderGapKind =
  | 'noValue'
  | 'structuredValue'
  | 'noDisplayForm'
  | 'ambiguousSetMember'
  | 'suffixHostMissing'
  | 'catalogMarkedMismatch'
  | 'unknownRenderKind';

export interface StepRenderGap {
  /** `segmentID` of the segment that produced nothing. */
  key: string;
  /** The segment's render kind, or `'suffix'`/`'inline'` for a host that never came. */
  render: string;
  gap: StepRenderGapKind;
}

/** A value the CLI reported as a list, with how many entries it held. FileMaker
 *  prints only the first, so the count is what a reviewer needs to see. */
export interface StepRenderList {
  key: string;
  entries: number;
}

export interface StepRendered {
  /** The whole line, as FileMaker writes it. */
  line: string;
  /** The step's displayed name — the catalog's `displayName` when it differs from
   *  the CLI's. */
  name: string;
  /** Everything after the name: the bracketed options, `[]` for a step type measured
   *  to print empty brackets, a comment's text, or `''` for a step showing none.
   *
   *  `line` is NOT always `name + ' ' + detail`: an empty comment's line carries the
   *  trailing space FileMaker writes and this does not, because a UI row cannot show
   *  one. That is the only case, and `tests/adt-step-display.test.ts` pins it. */
  detail: string;
  gaps: StepRenderGap[];
  /** `segmentID` of every segment that printed something, in order. */
  contributed: string[];
  /** Of those, the ones the BASELINE printed rather than a measured fact: a value the
   *  catalog does not account for strongly, or one whose measured render kind could not
   *  produce FileMaker's own form of it. So a consumer can say how much of a line is
   *  measured and how much is only not-lost. */
  baseline: string[];
  lists: StepRenderList[];
  /** The final text of the option each segment produced, so a fact can be tested on
   *  its OWN option even when the line as a whole fails for another key's sake. A
   *  suffix carries its host's finished text, brackets included. */
  optionTexts: Record<string, string>;
}

/** Render ONE segment: `{ text }` (possibly empty, for a flag that is off), a skip
 *  when the CLI did not report the key, a suffix that prints inside another option,
 *  or a gap naming what the catalog lacks.
 *
 *  A `text` MAY CARRY A GAP, and that pairing is the baseline. It says "this option is
 *  printed, from the value we hold, and it is not FileMaker's own phrasing" — so the
 *  shortfall is still reported to the round-trip while the developer still sees the value.
 *  A bare `gap` is now only for a segment with no value to fall back on. */
type SegmentRender =
  | { kind: 'text'; text: string; list?: number; gap?: StepRenderGapKind }
  | { kind: 'skip' }
  /** AN OPTION SLOT WITH NOTHING IN IT, and the reason it cannot just be
   *  `{kind:'text', text:''}`: an empty text means "print nothing for this key" —
   *  a repetition of 1, a `bareWhenTrue` that is off — and the assembly drops it.
   *  FileMaker's empty slot is the opposite: an option that IS printed, showing
   *  nothing. It only arises for a segment with no label, since a labelled slot
   *  already has `Label:` to print. */
  | { kind: 'emptySlot' }
  | { kind: 'suffix'; suffix: string; suffixOf: string | null }
  | { kind: 'gap'; gap: StepRenderGapKind };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** How much of a file path the catalog says FileMaker prints. */
function pathText(text: string, pathForm: StepSegment['pathForm']): string {
  if (!pathForm) return text;
  const noScheme = text.replace(/^[A-Za-z][A-Za-z0-9+.-]*:/, '');
  if (pathForm === 'schemeStripped') return noScheme;
  return noScheme.includes('/') ? noScheme.slice(noScheme.lastIndexOf('/') + 1) : noScheme;
}

/** The text of a JSON value as the catalog implies it is printed.
 *
 *  A LIST is the interesting case. FileMaker prints only its first entry, and for a
 *  file option only the file name inside it — which the catalog carries as `pathForm`,
 *  on the owner's ruling: "FM does not print the prefix." Everything else about a list
 *  is still unexpressed, so a 2-entry attachment list FileMaker renders as
 *  `2 Attachments` is a mismatch rather than a guess. */
function valueText(
  value: unknown,
  segment: StepSegment,
): { text: string; list?: number } | { gap: StepRenderGapKind } {
  if (value === null || value === undefined) return { gap: 'noValue' };
  if (Array.isArray(value)) {
    const first = value.find(
      (entry) => entry !== null && entry !== undefined && typeof entry !== 'object',
    );
    if (first === undefined) return { gap: 'structuredValue' };
    return { text: pathText(oneLine(first), segment.pathForm), list: value.length };
  }
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false' };
  if (typeof value === 'object') return { gap: 'structuredValue' };
  return { text: oneLine(value) };
}

/** A passthrough option's value as FileMaker prints it: itself, UNLESS the catalog
 *  measured a different display form for that one value.
 *
 *  On `bare` and `labelled`, `values` is an OVERRIDE and not an enumeration — the whole
 *  point of those kinds is that the value IS the text — so an unlisted value prints as
 *  itself rather than becoming a `noDisplayForm` gap. That direction matters for the files
 *  the catalog was never derived from: `Set Zoom Level` prints `zoom` bare in eight
 *  examples, `Zoom In` and `Zoom Out` for two codes, and FileMaker has zoom levels these
 *  two scripts never used. Turning the segment into an `enum` to hold those two would make
 *  every unseen level print nothing, which is the one direction the owner has ruled out. */
function overrideText(segment: StepSegment, value: unknown, text: string): string {
  if (!segment.values) return text;
  const key = typeof value === 'boolean' ? String(value) : oneLine(value);
  return segment.values[key] ?? text;
}

/** Did the CLI report this option's value AT ALL — answered without reading it.
 *
 *  Split out of `segmentValue` for one reason, and it is the security one: a masked
 *  key still has to know whether it is present, and asking for the value bound the
 *  password to a local on the way to finding out. FileMaker hides a password and the
 *  CLI does not, so the one guard whose failure mode is a real secret on screen must
 *  not depend on the order of two lines. */
function segmentReported(step: ScriptDetailStep, segment: StepSegment): boolean {
  return reports(step, segment.key, segment.slot);
}

/** A key folded to letters and digits, lower case: `withDialog`, `with dialog` and
 *  `With Dialog` are one word under it. Exported so a consumer that reads a step's
 *  keys itself (the inspector's analyses) can apply the same rule. */
export function foldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The key on THIS step that answers for a catalog key: the exact spelling when the step
 *  has it, else the one key whose fold matches, else nothing.
 *
 *  fm 0.7.0 respelled every multi-word option key in camelCase (`with dialog` became
 *  `withDialog`; 109 of the 113 keys that changed differ only in case and separators).
 *  The catalog is measured against one build and says exactly what that build spelled;
 *  this fallback keeps a step written by another build rendering in the meantime. Exact
 *  wins first because fm 0.6.0 itself emitted keys that differ only in case (`url` and
 *  `URL`), and folding must never pick the wrong one of a pair the step really carries.
 *  It absorbs case and spacing, not words: `append to existing file` does not fold to
 *  `appendToExistingPdf`, and a key like that reaches the baseline, as before. */
function keyOn(step: ScriptDetailStep, key: string): string | undefined {
  if (Object.hasOwn(step, key)) return key;
  const want = foldKey(key);
  for (const held of Object.keys(step)) if (foldKey(held) === want) return held;
  return undefined;
}

/** Does the CLI report this key — or, for a value it does not name, this slot? The one
 *  presence predicate, shared by a segment's own key and by `hiddenWhen`'s deciding key, so
 *  the two cannot answer the same question differently. */
function reports(step: ScriptDetailStep, key: string, slot: StepSlotRef | undefined): boolean {
  if (!slot) return keyOn(step, key) !== undefined;
  const slots = step.slots;
  if (!isRecord(slots)) return false;
  const held = slots[slot.member];
  if (held === undefined) return false;
  if (slot.number === undefined) return true;
  return isRecord(held) && Object.hasOwn(held, slot.number);
}

/** Where this segment's value lives. Two addresses, because the CLI has two ways of
 *  reporting one: under a key of its own, or inside `slots` — the object holding the
 *  values it does not name, by kind and slot number. A slot is read as a path
 *  (`slots.calc["0"]`), and a missing member or number is the same fact as a missing
 *  key: not reported. */
function segmentValue(step: ScriptDetailStep, segment: StepSegment): unknown {
  if (!segment.slot) {
    const held = keyOn(step, segment.key);
    return held === undefined ? undefined : step[held];
  }
  const slots = step.slots;
  if (!isRecord(slots)) return undefined;
  const held = slots[segment.slot.member];
  if (segment.slot.number === undefined) return held;
  return isRecord(held) ? held[segment.slot.number] : undefined;
}

/** This option's label, which FileMaker may choose according to ANOTHER key's value:
 *  the same key that renders `Add Account`'s `Authenticate via` also decides whether
 *  the account is labelled `Account Name` or `Group Name`. A value the catalog has no
 *  entry for falls back to the fixed label, never to nothing. */
function labelOf(segment: StepSegment, step: ScriptDetailStep): string {
  const fixed = segment.label ?? '';
  if (!segment.labelWhen) return fixed;
  const decider = segment.labelWhen.key;
  const held = keyOn(step, decider);
  const state = held === undefined ? 'absent' : oneLine(step[held]);
  return segment.labelWhen.labels[state] ?? fixed;
}

/** The display form the catalog recorded for this value, or a named gap. */
function displayForm(
  segment: StepSegment,
  value: unknown,
): { text: string } | { gap: StepRenderGapKind } {
  const key = typeof value === 'boolean' ? String(value) : oneLine(value);
  const form = segment.values?.[key];
  return form === undefined ? { gap: 'noDisplayForm' } : { text: form };
}

/** Is this option a secret, whatever the catalog's render kind says?
 *
 *  The kind is the measured answer; the key set is the SAFE one, and it wins. A key
 *  the catalog masks on `Add Account` is a password on any step type, so a segment
 *  that named it under some other kind would still not print its value. */
function isMasked(segment: StepSegment, conventions: StepDisplayConventions): boolean {
  if (segment.render === 'masked') return true;
  return segment.slot === undefined && conventions.isMaskedKey(segment.key);
}

/** THE BASELINE FOR ONE SEGMENT: the value the CLI sent, as text, for a segment whose
 *  measured render kind could not produce FileMaker's own form of it.
 *
 *  `null` means there is genuinely nothing to print — no value at all — which is the only
 *  case where silence is not a choice. Everything else comes out: a scalar as itself, a
 *  list as its first entry (the measured rule, `pathForm` included), and a shape the
 *  catalog has no kind for as redacted JSON rather than as `[object Object]`.
 *
 *  THE SECRET TEST IS HERE AND IT IS THE WIDE ONE. This function exists to print values
 *  nothing printed before, so it is the one new path a password could take out of a file
 *  this catalog was never derived from: `isSecretKey` catches a masked name in any word of
 *  the key, and `conventionValueText` replaces one at any depth inside an object. A slot
 *  addresses a value the CLI does not NAME, so no name-based test can reach it — the same
 *  limitation the 61 slot values the catalog already renders have always had. */
function heldValueText(
  segment: StepSegment,
  step: ScriptDetailStep,
  conventions: StepDisplayConventions,
): string | null {
  const value = segmentValue(step, segment);
  if (value === null || value === undefined) return null;
  if (segment.slot === undefined && conventions.isSecretKey(segment.key)) return STEP_MASK;
  const shown = valueText(value, segment);
  const text = 'gap' in shown ? conventionValueText(value, conventions) : shown.text;
  return text === '' ? null : text;
}

function renderSegment(
  segment: StepSegment,
  step: ScriptDetailStep,
  conventions: StepDisplayConventions,
): SegmentRender {
  const label = labelOf(segment, step);
  const labelled = (text: string): string =>
    label === '' ? text : text === '' ? `${label}:` : `${label}: ${text}`;
  /** What the catalog cannot say, said as plainly as we can say it: the value, under
   *  whatever label the catalog measured, with the shortfall still named in `gaps`. */
  const fallback = (gap: StepRenderGapKind): SegmentRender => {
    const text = heldValueText(segment, step, conventions);
    if (text === null) return { kind: 'gap', gap };
    // A bare mask says nothing about WHAT is hidden, and a segment that prints no label of
    // its own would produce one: `Save Records as PDF [ •••••••• ]`. It borrows the key's
    // label for that one case, which is the only place a mask can reach an unlabelled kind.
    const shown =
      text === STEP_MASK && label === ''
        ? `${conventions.labelFor(segment.key, step.step)}: ${STEP_MASK}`
        : labelled(text);
    return { kind: 'text', text: shown, gap };
  };

  // An option FileMaker stops printing while another key is reported. Before
  // everything else, because it decides that nothing is printed at all.
  //
  // The deciding key may be one the CLI does not NAME, in which case it is addressed as a
  // slot exactly like a segment's own key — so presence is answered by the same predicate
  // rather than by a second one that could disagree with it. `Go to Related Record` is the
  // measured case: its window configuration is five unnamed values, and it is their presence
  // that makes FileMaker drop the animation option.
  if (segment.hiddenWhen && reports(step, segment.hiddenWhen.keyPresent, segment.hiddenWhen.slot)) {
    return { kind: 'skip' };
  }
  // A MASKED KEY, and it comes before any value is read rather than after. FileMaker
  // hides a password; the CLI sends it. Presence is all this needs, and
  // `segmentReported` answers that without binding the value — so no path through this
  // function can put a password in a local variable.
  if (isMasked(segment, conventions)) {
    if (segmentReported(step, segment)) return { kind: 'text', text: labelled(STEP_MASK) };
    return segment.whenAbsent
      ? { kind: 'text', text: labelled(segment.whenAbsent.text) }
      : { kind: 'skip' };
  }
  // An option whose text is a function of WHICH keys the CLI reports rather than of
  // any value, so it renders whether or not its own key is there.
  if (segment.render === 'keyPresence') {
    const form = segment.values?.[segmentReported(step, segment) ? 'present' : 'absent'];
    return form === undefined ? fallback('noDisplayForm') : { kind: 'text', text: labelled(form) };
  }
  if (!segmentReported(step, segment)) {
    // The CLI does not report the key and FileMaker still prints something for it: an
    // empty slot, or its own placeholder for the unset state.
    if (!segment.whenAbsent) return { kind: 'skip' };
    // A placeholder guarded by a bit of `flags`: FileMaker prints it for a reference
    // whose table is gone, and reports nothing else to tell that state from having no
    // reference at all. Without the guard we would print `<Table Missing>` on every
    // step that simply has no field.
    const bit = segment.whenAbsent.flagBit;
    if (bit !== undefined && (Number(step.flags ?? 0) & bit) === 0) return { kind: 'skip' };
    const text = labelled(segment.whenAbsent.text);
    // A slot with no label AND no text is still an option FileMaker prints — the owner:
    // "FM is inconsistent here but often does print an option with no value set. So we
    // should." Without this it would be indistinguishable from "print nothing" and
    // dropped, which is the one direction he has ruled against.
    return text === '' ? { kind: 'emptySlot' } : { kind: 'text', text };
  }
  const value = segmentValue(step, segment);
  const wrap = (text: string): string => (segment.quoted ? `“${text}”` : text);
  // A value FileMaker prints nothing for. Checked before the kind, since it holds
  // whatever the kind would otherwise have done with it.
  if (segment.omittedValues?.includes(oneLine(value))) return { kind: 'text', text: '' };

  switch (segment.render) {
    case 'bareWhenTrue':
      return { kind: 'text', text: value === true ? label : '' };
    case 'bareState':
    case 'enum': {
      const form = displayForm(segment, value);
      return 'gap' in form ? fallback(form.gap) : { kind: 'text', text: form.text };
    }
    case 'labelledState':
    case 'labelledEnum': {
      const form = displayForm(segment, value);
      return 'gap' in form ? fallback(form.gap) : { kind: 'text', text: `${label}: ${form.text}` };
    }
    case 'setMember': {
      // The catalog records ONE member per display form, each occurring only on values
      // that show its own form, so more than one hit would mean the map is not the
      // function it claims to be rather than that this value is unusual.
      const members = isRecord(value) && Array.isArray(value.set) ? value.set : [];
      const hits = members.filter(
        (member): member is string =>
          typeof member === 'string' && segment.values?.[member] !== undefined,
      );
      if (hits.length !== 1) {
        return fallback(hits.length === 0 ? 'noDisplayForm' : 'ambiguousSetMember');
      }
      return { kind: 'text', text: `${label}: ${segment.values?.[hits[0]] ?? ''}` };
    }
    case 'labelled': {
      const shown = valueText(value, segment);
      if ('gap' in shown) return fallback(shown.gap);
      if (shown.text === '') return { kind: 'text', text: '' };
      const text = overrideText(segment, value, shown.text);
      return {
        kind: 'text',
        text: `${label}: ${text === shown.text ? wrap(text) : text}`,
        list: shown.list,
      };
    }
    case 'bare': {
      const shown = valueText(value, segment);
      if ('gap' in shown) return fallback(shown.gap);
      if (shown.text === '') return { kind: 'text', text: '' };
      const text = overrideText(segment, value, shown.text);
      // The quotes belong to the VALUE, not to FileMaker's word for it: the catalog's
      // `quoted` was measured on the passthrough examples, and a display form is
      // FileMaker's own vocabulary rather than a name it is quoting.
      return { kind: 'text', text: text === shown.text ? wrap(text) : text, list: shown.list };
    }
    case 'suffix': {
      // The bracket CONTENT can be a display form of its own: the catalog records
      // `0 -> ""`, FileMaker's empty repetition slot.
      const form = segment.values?.[oneLine(value)];
      if (form !== undefined) {
        return { kind: 'suffix', suffix: `[${form}]`, suffixOf: segment.suffixOf ?? null };
      }
      const shown = valueText(value, segment);
      if ('gap' in shown) return fallback(shown.gap);
      if (shown.text === '') return { kind: 'text', text: '' };
      return { kind: 'suffix', suffix: `[${shown.text}]`, suffixOf: segment.suffixOf ?? null };
    }
    case 'labelledMismatch':
      // The catalog's own verdict: FileMaker's text here is not derivable from the CLI's
      // value, so we cannot write FileMaker's option. THE VALUE IS STILL PRINTED under the
      // label the catalog measured, and the gap still reported.
      //
      // This is the case the whole baseline was built for. `Set Error Logging`'s custom
      // debug info is a calculation FileMaker spells `Get ( CurrentHostTimestamp )` and the
      // CLI spells with a capital S; one letter's case made the derivation decline to
      // attribute the option, and declining to attribute became printing nothing at all for
      // a calculation we were holding in full. The owner on the case difference itself:
      // "we're just reading so who cares what the case format is."
      return fallback('catalogMarkedMismatch');
    default:
      return fallback('unknownRenderKind');
  }
}

/** Squeeze a value onto one row for the CONVENTION path only.
 *
 *  Display-only and unmeasured, which is why it is not `oneLine`: a key the catalog has
 *  nothing to say about could hold anything, and a run of spaces from an unknown shape
 *  is noise rather than content. The catalog path keeps what it was measured to keep. */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A value the convention has to print without knowing anything about it.
 *
 *  Shown as JSON rather than as `[object Object]`: a row that hides a value it cannot read
 *  is worse than an ugly one. `JSON.stringify` is NOT used, for two reasons that are both
 *  promises this module makes elsewhere:
 *
 *   1. **THE MASK, AT EVERY DEPTH.** `conventionOption` tests the top-level key, so a
 *      masked key nested under an unmasked one was serialised verbatim — a review got
 *      `Bag: {"password":"hunter2"}` onto a row, and the module's own doc claimed no key
 *      the catalog fails to list could do that. Every key of every object walked here is
 *      tested, so the value under a masked NAME is replaced wherever it sits.
 *   2. **It never throws.** `JSON.stringify` throws on a circular structure and on a
 *      BigInt, against the promise that a malformed step still renders. Neither can come
 *      out of `JSON.parse`, so neither is reachable from a wire body — but the promise is
 *      unconditional and this is what makes it true.
 *
 *  Not a JSON serialiser and not trying to be: no `toJSON`, and a shape it cannot walk is
 *  named rather than thrown. It matches `JSON.stringify` on the shapes the CLI actually
 *  sends (plain objects, arrays, strings, finite numbers, booleans, null). */
function conventionValueText(value: unknown, conventions: StepDisplayConventions): string {
  if (typeof value === 'string') return squeeze(value);
  if (typeof value === 'number') return String(value);
  try {
    return squeeze(redactedJson(value, conventions, new Set()));
  } catch {
    // A shape that resists even this — a getter that throws, an exotic proxy. The row says
    // so rather than the sheet dying.
    return '(unreadable value)';
  }
}

/** `value` as JSON text, with every masked key's value replaced at any depth, cycles named
 *  and no type able to throw. `seen` carries the objects on the current path. */
function redactedJson(
  value: unknown,
  conventions: StepDisplayConventions,
  seen: Set<object>,
): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null';
    case 'boolean':
      return String(value);
    // A BigInt is the case `JSON.stringify` throws on. Printed as its digits.
    case 'bigint':
      return JSON.stringify(String(value));
    case 'undefined':
    case 'function':
    case 'symbol':
      return 'null';
    default:
      break;
  }
  const object = value as object;
  // A cycle. `JSON.stringify` throws here; a row that says so is worth more than no row.
  if (seen.has(object)) return '"(circular)"';
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return `[${object.map((item) => redactedJson(item, conventions, seen)).join(',')}]`;
    }
    const parts: string[] = [];
    for (const [key, held] of Object.entries(object)) {
      // `JSON.stringify` omits a property whose value is undefined, a function or a
      // symbol; matched so the common shapes print identically.
      if (held === undefined || typeof held === 'function' || typeof held === 'symbol') continue;
      const text = conventions.isSecretKey(key)
        ? JSON.stringify(STEP_MASK)
        : redactedJson(held, conventions, seen);
      parts.push(`${JSON.stringify(key)}:${text}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(object);
  }
}

/** One option for a key the catalog does not describe, or `null` for a key that shows
 *  nothing at all.
 *
 *  THE CONVENTION, and the honest name for it is a guess — but a guess taken from 1203
 *  measured lines rather than from the CLI's documentation, which `url` alone disproves.
 *  A boolean that is on prints its label and one that is off prints nothing; a value is
 *  written bare when every step type the catalog measured writes that key bare, and
 *  `Label: value` otherwise.
 *
 *  A SECRET KEY IS MASKED HERE TOO, before the value is read for any purpose, and by the
 *  WIDE test: this is the path a step type the catalog has never seen takes, so it is the
 *  path a literal password would take out of a file this catalog was never derived from,
 *  and the name it arrives under may be a compound (`smtpPassword`) rather than one the
 *  catalog measured.
 *
 *  `label` is given only for a value the CLI does not NAME, where the key is the CLI's word
 *  for the value's kind rather than a key any step reports: the catalog's label table is
 *  about keys, so consulting it for a slot's member would answer about a different thing. */
function conventionOption(
  key: string,
  value: unknown,
  stepName: string,
  conventions: StepDisplayConventions,
  label?: string,
): string | null {
  const labelText = label ?? conventions.labelFor(key, stepName);
  if (conventions.isSecretKey(key)) return `${labelText}: ${STEP_MASK}`;
  if (value === true) return labelText;
  if (value === false || value === null || value === undefined) return null;
  const text = conventionValueText(value, conventions);
  if (text === '') return null;
  return label === undefined && conventions.writesBare(key) ? text : `${labelText}: ${text}`;
}

/** Which of a step's values this entry accounts for STRONGLY — either by rendering it, or
 *  by a measured claim that FileMaker shows nothing for it. Addressed by `segmentID`, so a
 *  value the CLI does not name is accounted for one slot at a time.
 *
 *  **THE SPLIT THIS SET DRAWS IS THE WHOLE ARCHITECTURE, and it used to be drawn in the
 *  wrong place.** One set held every key the entry mentioned at all — segments, `ignored`
 *  at any confidence, and `unresolved` — and everything in it was left unprinted. So the
 *  catalog's own record of its DOUBT (`ignored` resting on one example, a key `refuted` or
 *  `withdrawn` or whose label another key owns) was read as a decision to withhold a value
 *  we were holding. Measured on the corpus behind this catalog, that silenced 106 values.
 *
 *  What stays strong, and why each is a measurement rather than an uncertainty:
 *
 *   - a `segment`, at any confidence: the segment itself renders, and where its measured
 *     form falls short it prints the value anyway (see `fallback` in `renderSegment`), so
 *     nothing is lost by treating it as answered here;
 *   - `ignored` at `measured` confidence: FileMaker was observed showing nothing for this
 *     key, more than once, with no example against it. Note the scope named in
 *     `StepDisplayEntry.ignored` — a universal negative from one corpus — which is why this
 *     line is the one the owner should be asked about rather than moved unilaterally;
 *   - a comment's `text`, which `commentStyle` prints as the whole step.
 *
 *  Everything else — `ignored` at `low` confidence, every `unresolved` cause — is the
 *  catalog saying it does not know, and a value we hold is printed by the baseline. */
function stronglyAccounted(entry: StepDisplayEntry): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const segment of entry.segments) ids.add(segmentID(segment));
  for (const item of entry.ignored) if (item.confidence === 'measured') ids.add(segmentID(item));
  if (entry.commentStyle) ids.add('text');
  return ids;
}

/** Every place the CLI reports a value, as `{ id, key, value }` — the named keys and then
 *  the values it does NOT name, one slot at a time.
 *
 *  One walk, so the catalog path and the convention path cannot disagree about what the CLI
 *  sent. `key` is the name to label the value with: a real key's own name, or, for a slot,
 *  the CLI's word for the value's KIND (`calc`, `text`, `fileReference`). Naming a slot
 *  after its member is the honest form available — the CLI did not name the value, so no
 *  label for it can be FileMaker's — and it beats both silence and a made-up phrase. */
interface ReportedValue {
  id: string;
  key: string;
  value: unknown;
  /** True when the CLI did not NAME this value, so `key` is its member rather than a key. */
  unnamed?: true;
  /** The slot number within the member, for an unnamed value that has one. */
  number?: string;
}

function reportedValues(step: ScriptDetailStep): ReportedValue[] {
  const places: ReportedValue[] = [];
  for (const [key, value] of Object.entries(step)) {
    if (key === 'slots' || ARTEFACT_KEYS.has(key)) continue;
    places.push({ id: key, key, value });
  }
  const slots = step.slots;
  if (isRecord(slots)) {
    for (const [member, held] of Object.entries(slots)) {
      const at = (number?: string, value?: unknown): ReportedValue => ({
        id: segmentID({ key: 'slots', slot: { member, number } }),
        key: member,
        value,
        unnamed: true,
        number,
      });
      if (isRecord(held)) {
        for (const [number, value] of Object.entries(held)) places.push(at(number, value));
      } else {
        places.push(at(undefined, held));
      }
    }
  }
  return places;
}

/** The label the baseline gives one place, or `undefined` for a named key — which takes the
 *  catalog's measured label instead, through `conventionOption`.
 *
 *  A value the CLI does not NAME is labelled after its member, which is the CLI's word for
 *  the value's KIND. The slot NUMBER is added only when the same member appears more than
 *  once in this step, because that is the only case where the member alone does not identify
 *  the value: `MBS [ … ; Calc: $P5 ; Calc: $P6 ]` reads as one option printed twice, while
 *  `Calc 5:` / `Calc 6:` reads as what it is. A single `Text: $FileExists` keeps the shorter
 *  form, since `Text 32:` would put an internal index on screen for nothing. */
function baselineLabel(place: ReportedValue, repeated: ReadonlySet<string>): string | undefined {
  if (!place.unnamed) return undefined;
  const label = inferredLabel(place.key);
  return place.number !== undefined && repeated.has(place.key) ? `${label} ${place.number}` : label;
}

/** Which members hold more than one of the values this baseline is about to print. */
function repeatedMembers(places: readonly ReportedValue[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const place of places) {
    if (!place.unnamed) continue;
    if (seen.has(place.key)) twice.add(place.key);
    seen.add(place.key);
  }
  return twice;
}

/** THE BASELINE: every value the CLI sends that this entry does not account for strongly,
 *  printed by the convention.
 *
 *  Three populations reach it, and only the first was reachable before:
 *
 *   1. a key the catalog has no opinion about at all — 0 on the corpus behind this catalog,
 *      which is what keeps the round-trip's counts figures about the catalog rather than
 *      about the convention, and non-zero on the files the app actually runs on;
 *   2. a key the catalog `ignored` at `low` confidence, or named in `unresolved`. The
 *      catalog recorded its doubt precisely and the renderer answered it with silence;
 *   3. a value the CLI does not NAME that no segment claims. 256 of the 319 such values in
 *      the corpus are `ignored` at `measured` confidence and stay unprinted; the rest are
 *      calculations and variables a developer is looking for.
 *
 *  A masked name is masked here, at any depth, before its value is read — this and
 *  `heldValueText` are the two paths that print a value the catalog did not measure, so
 *  they are the two that use the wide `isSecretKey`. */
function baselineOptions(
  step: ScriptDetailStep,
  entry: StepDisplayEntry,
  conventions: StepDisplayConventions,
  /** The labels the measured options on THIS line already carry. A baseline option that
   *  would repeat one of them is dropped: see `taken` below. */
  taken: ReadonlySet<string> = new Set(),
): Array<{ key: string; text: string }> {
  // A named key a segment consumed under its folded spelling (see `keyOn`) is accounted
  // for too, else the baseline would print `with dialog` a second time. Only the key the
  // segment actually read is added: a step carrying both `url` and `URL` rendered `url`,
  // and `URL` is a value of its own that the baseline still owes the reader.
  const strong = new Set(stronglyAccounted(entry));
  for (const id of [...strong]) {
    const held = keyOn(step, id);
    if (held !== undefined) strong.add(held);
  }
  const places = reportedValues(step).filter((place) => !strong.has(place.id));
  const repeated = repeatedMembers(places);
  const options: Array<{ key: string; text: string }> = [];
  for (const place of places) {
    const text = conventionOption(
      place.key,
      place.value,
      step.step,
      conventions,
      baselineLabel(place, repeated),
    );
    if (text === null) continue;
    // A LABEL A MEASURED OPTION ON THIS LINE ALREADY CARRIES. The value is on screen under
    // that label already, so printing it again is the one shape the owner rejected outright
    // (ruling 7) rather than an extra option he accepted. Measured on `Perform Semantic
    // Find`, where FileMaker prints `Return count: $n` from the key holding the COUNT and
    // the boolean switch is called `returnCount`: the baseline would have written
    // `… ; Return count: $n ; Return count`.
    //
    // It is the same test the derivation applies as `labelOwnedElsewhere`, with two
    // deliberate narrowings. Against the labels this line actually PRINTED, not the ones the
    // entry declares — a segment that rendered nothing has taken no label, so the baseline
    // still prints. And only when this option would carry that label itself, either as
    // `Label: value` or as the label alone: a key the catalog writes BARE prints no label, so
    // a collision with the label it would otherwise have had says nothing about it.
    const label = baselineLabel(place, repeated) ?? conventions.labelFor(place.key, step.step);
    if (label !== '' && taken.has(label) && (text === label || text.startsWith(`${label}: `))) {
      continue;
    }
    options.push({ key: place.id, text });
  }
  return options;
}

/** An option held back until its host option exists. */
interface PendingOption {
  key: string;
  /** Set for a `suffix`: the `[bracket]` appended to the host's text. */
  suffix?: string;
  /** Set for an `inlineOf`: the text printed after the host's value, space-separated. */
  text?: string;
  host: string | null;
}

/** One step, written out from its catalog entry.
 *
 *  Never throws and never refuses: a missing key, a value of the wrong shape and a
 *  render kind this build does not know all produce a line, because this runs on
 *  whatever a live file holds and a crashed row helps nobody. What it cannot say it
 *  reports in `gaps`.
 *
 *  A value the entry does not account for STRONGLY is printed by the baseline, after the
 *  options the catalog describes. The owner's two rulings point the same way — "we
 *  should not omit options", and "any weAddAnOption is not a problem, FM does not always
 *  show all configured options so if we do then that is fine" — so where the catalog is
 *  silent or unsure, printing beats dropping. See `baselineOptions` for the three
 *  populations that reach it and `stronglyAccounted` for the line it draws. */
export function renderStepFromCatalog(
  step: ScriptDetailStep,
  entry: StepDisplayEntry,
  conventions: StepDisplayConventions,
): StepRendered {
  const name = entry.displayName ?? step.step;
  const gaps: StepRenderGap[] = [];
  const contributed: string[] = [];
  const baseline: string[] = [];
  const lists: StepRenderList[] = [];

  if (entry.commentStyle) {
    // FileMaker shows a comment's own text, unbracketed, and a return in it starts a
    // new row — so the return is kept rather than squeezed. `text` is not a masked key
    // in this catalog; the check is here so that no path reads a value the catalog
    // says is a secret, whichever key it lands under.
    const raw = conventions.isMaskedKey('text') ? STEP_MASK : step.text;
    const text = typeof raw === 'string' ? raw.replace(/\r/g, '\n') : '';
    // A comment carries no option in any of the 285 measured examples, so the bracket
    // below never appears in this corpus. It is here so that the rule has no carve-out:
    // NO key the catalog fails to account for is silently dropped, on any step type, and
    // in particular a masked one cannot be dropped-and-hidden on the one path that
    // returns early.
    const extra = baselineOptions(step, entry, conventions);
    const detail = [text, extra.length === 0 ? '' : `[ ${extra.map((option) => option.text).join(' ; ')} ]`]
      .filter((part) => part !== '')
      .join(' ');
    return {
      line: `${name} ${detail === '' ? text : detail}`,
      name,
      detail,
      gaps,
      contributed: ['text', ...extra.map((option) => option.key)],
      baseline: extra.map((option) => option.key),
      lists,
      // A comment's text is the whole step rather than one of its options, and
      // `optionTexts` is read to test ONE option's fact in isolation.
      optionTexts: Object.fromEntries(extra.map((option) => [option.key, option.text])),
    };
  }

  const options: Array<{ key: string; text: string }> = [];
  const pending: PendingOption[] = [];
  const inline: PendingOption[] = [];
  /** The labels the measured options carry, so the baseline cannot print one twice. */
  const taken = new Set<string>();
  for (const segment of entry.segments) {
    const id = segmentID(segment);
    const rendered = renderSegment(segment, step, conventions);
    if (rendered.kind === 'skip') continue;
    // An option FileMaker prints with nothing in it, so it survives the empty-text drop
    // below. It carries no label, and it cannot host a suffix or an inline option — a
    // slot with no value has nothing for one to attach to.
    if (rendered.kind === 'emptySlot') {
      options.push({ key: id, text: '' });
      contributed.push(id);
      continue;
    }
    if (rendered.kind === 'gap') {
      gaps.push({ key: id, render: segment.render, gap: rendered.gap });
      continue;
    }
    if (rendered.kind === 'suffix') {
      pending.push({ key: id, suffix: rendered.suffix, host: rendered.suffixOf });
      continue;
    }
    // A shortfall the baseline covered: the option IS printed, from the value we hold, and
    // the gap is recorded all the same. Reporting both is the point — the round-trip must
    // still ask what FileMaker's own phrasing is, and the developer must still see the value.
    if (rendered.gap !== undefined) {
      gaps.push({ key: id, render: segment.render, gap: rendered.gap });
      baseline.push(id);
    }
    if (rendered.list !== undefined) lists.push({ key: id, entries: rendered.list });
    if (rendered.text === '') continue;
    // An option FileMaker prints INSIDE another one, with no separator. Held back like
    // a suffix, because it too needs its host's option to exist first.
    if (segment.inlineOf) {
      inline.push({ key: id, text: rendered.text, host: segment.inlineOf });
      continue;
    }
    options.push({ key: id, text: rendered.text });
    contributed.push(id);
    const label = labelOf(segment, step);
    if (label !== '') taken.add(label);
  }

  // A suffix prints inside the option it belongs to, so it is applied once the host
  // option exists. A suffix whose host rendered nothing is a gap, not a silent drop.
  // Inline options come after, so a host carrying both gets its bracket before the
  // option printed after its value.
  const held = [...pending, ...inline];
  const hostOf = (item: PendingOption): { key: string; text: string } | undefined =>
    options.find((option) => option.key === item.host);
  for (const item of held) {
    const host = hostOf(item);
    if (!host) {
      // The host option printed nothing, so there is nothing to print this one inside. It
      // becomes an option of its own rather than disappearing — a repetition or an inline
      // file reference is content, and the gap still says the placement is not FileMaker's.
      gaps.push({
        key: item.key,
        render: item.suffix === undefined ? 'inline' : 'suffix',
        gap: 'suffixHostMissing',
      });
      const orphan = item.suffix === undefined ? item.text : item.suffix.slice(1, -1);
      if (orphan !== undefined && orphan !== '') {
        options.push({ key: item.key, text: orphan });
        contributed.push(item.key);
        baseline.push(item.key);
      }
      continue;
    }
    host.text += item.suffix === undefined ? ` ${item.text ?? ''}` : item.suffix;
    contributed.push(item.key);
  }

  // THE BASELINE, last. Last because the catalog's own order is measured and this is not,
  // and because a baseline option must not be able to host a suffix: nothing measured says
  // it could.
  for (const option of baselineOptions(step, entry, conventions, taken)) {
    options.push(option);
    contributed.push(option.key);
    baseline.push(option.key);
  }

  const body = options.map((option) => option.text).join(' ; ');
  const optionTexts: Record<string, string> = {};
  for (const option of options) optionTexts[option.key] = option.text;
  for (const item of held) {
    const host = hostOf(item);
    if (host) optionTexts[item.key] = host.text;
  }
  // A step type measured to print its brackets even with nothing in them. `[]` is what
  // 18 of the 20 such examples show; the two that pad the brackets with spaces are left
  // as mismatches rather than fitted to, since the owner's answer on the empty slot was
  // that FileMaker is inconsistent and either will do.
  // The brackets are padded with one space, EXCEPT against an empty slot at either end,
  // which already contributes the separator's space: FileMaker writes
  // `Get File Exists [ ; Target: ]`, not `[  ; Target: ]`. Measured on the four step
  // types that print a leading empty slot; it is a rendering rule, not a normalisation,
  // and it can only fire once an empty slot exists to fire on.
  const open = body.startsWith(' ') ? '[' : '[ ';
  const close = body.endsWith(' ') ? ']' : ' ]';
  const detail = body === '' ? (entry.emptyBrackets ? '[]' : '') : `${open}${body}${close}`;
  return {
    line: detail === '' ? name : `${name} ${detail}`,
    name,
    detail,
    gaps,
    contributed,
    baseline,
    lists,
    optionTexts,
  };
}

/** A step of a type the catalog has never seen, written out by the convention alone.
 *
 *  The fallback, and it must stay: 209 step types are covered, FileMaker will add more,
 *  and a step read from a file this catalog never saw has to show something. Everything
 *  it prints is a guess — see `conventionOption` — except the labels, which come from the
 *  catalog wherever it measured one, and the mask, which is enforced here as everywhere.
 *
 *  Deliberately NOT reached by the round-trip: a step type with no entry is counted as
 *  unwritable there, because a line this produces cannot be evidence about a catalog that
 *  says nothing.
 *
 *  It walks the same `reportedValues` the catalog path does, so a value the CLI does not
 *  NAME reaches a row here too. `slots` is in `ARTEFACT_KEYS` because printing the object
 *  itself would dump JSON into a row; printing its members one at a time is the opposite of
 *  that, and it is the only way a plugin step on an unknown step type shows its arguments. */
export function renderStepByConvention(
  step: ScriptDetailStep,
  conventions: StepDisplayConventions,
): StepRendered {
  // The CLI always reports `step`, and `stepID` is authoritative when the two disagree —
  // but a body assembled elsewhere could omit the name, and a blank row would say nothing
  // at all about what the step is.
  const name =
    typeof step.step === 'string' && step.step.trim() ? step.step : `Step ${step.stepID}`;
  const places = reportedValues(step);
  const repeated = repeatedMembers(places);
  const options: Array<{ key: string; text: string }> = [];
  for (const place of places) {
    const text = conventionOption(
      place.key,
      place.value,
      name,
      conventions,
      baselineLabel(place, repeated),
    );
    if (text === null) continue;
    options.push({ key: place.id, text });
  }
  const detail = options.length === 0 ? '' : `[ ${options.map((option) => option.text).join(' ; ')} ]`;
  const optionTexts: Record<string, string> = {};
  for (const option of options) optionTexts[option.key] = option.text;
  return {
    line: detail === '' ? name : `${name} ${detail}`,
    name,
    detail,
    gaps: [],
    contributed: options.map((option) => option.key),
    // Every option here is the convention's, so the whole line is baseline by definition.
    baseline: options.map((option) => option.key),
    lists: [],
    optionTexts,
  };
}
