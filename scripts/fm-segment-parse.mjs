/** Work out which part of a rendered FileMaker step line corresponds to which
 *  key of the step's JSON, so a later task can aggregate the answers into a
 *  committed step-display catalog.
 *
 *  Data provenance: the owner's `fmnet://localhost/Ooe`, read only — script
 *  bodies via `read:script`, rendered lines exported from the Script Workspace
 *  into fm_scripts/. Every rule below was measured against those 1203 pairs.
 *
 *  WHY THIS DOES NOT FIND OPTIONS BY SPLITTING ON " ; "
 *  ----------------------------------------------------
 *  FileMaker separates a step's options with "; ", but a calculation is one
 *  option and may contain that separator itself. One Set Variable in the
 *  owner's data contains " ; " five times inside a single Let(), plus a nested
 *  "[ ... ]". Splitting shreds it. So options are LOCATED by anchoring: a
 *  labelled option renders as `Label: value`, so the positions of the labels a
 *  step's keys imply give the key order with no delimiter split at all, and a
 *  labelled value ends at the NEXT ANCHOR rather than at the next separator.
 *  Everywhere else the separator is only a boundary TEST (is this position the
 *  start or end of an option?).
 *
 *  Two places do cut on `;`, both documented at their site, and neither can
 *  shred a calculation that classified:
 *    - `resolveLabelledValue` cuts a span back to its first option, but only
 *      after the whole span and every prefix of it failed to classify.
 *    - `splitLeftover` cuts a stretch NO key claimed, and only when every piece
 *      looks like an option rather than like calculation.
 */

import { normaliseCalc } from './fm-script-align.mjs';

/** Keys the CLI reports that are step structure, not displayed options.
 *  Documented in CLAUDE.md: block extents come free on every block step, a
 *  step's disabled state is a top-level key, and `flags` is the packed option
 *  word. `collapsed` is deliberately NOT here — it is the editor's fold state
 *  and looks like an option, so let the data report it as never rendered. */
export const NON_DISPLAY_KEYS = new Set(['stepID', 'step', 'uuid', 'flags', 'block', 'disabled']);

/** FileMaker masks a password in its step display; the CLI reports the value.
 *  Eight U+2022 bullets in the owner's data, but match any run so a different
 *  build's mask width still classifies. */
export const MASK_PATTERN = /^•+$/;

/** How a segment relates to its key. The first six are the designed kinds;
 *  `labelledEnum` and `labelledMismatch` were forced by the data and are
 *  explained at `classifyLabelled`, `suffix` by the way a field repetition
 *  renders onto the option it belongs to, and `bareState` by steps that print a
 *  boolean's state with no label at all (`Allow User Abort [ Off ]`,
 *  `Set AI Call Logging [ On ]`) — see `spellsState`. */
export const RENDER_KINDS = [
  'labelled',
  'bare',
  'bareWhenTrue',
  'bareState',
  'labelledState',
  'masked',
  'enum',
  'labelledEnum',
  'labelledMismatch',
  'setMember',
  'suffix',
  'keyPresence',
];

/** THE CLI'S UNNAMED VALUES. `slots` is one object holding values the CLI does not
 *  give a key of their own — a script parameter, a calculated title, a file
 *  reference, a scanned field — under a member name for the value's KIND and, for
 *  most members, a slot NUMBER inside that kind:
 *
 *      "slots": { "calc": { "0": "1" }, "fileReference": "<a file name>" }
 *
 *  FileMaker prints them (`… ; Script: “X” from file: “Y” ; Parameter: 1 …`),
 *  so every one of the 146 examples carrying a `slots` used to read as a key
 *  FileMaker never shows — a false universal negative in `ignored`, 146 times over.
 *
 *  The fix is to make each slot a KEY like any other, so it goes through the same
 *  four anchoring passes, the same attribution ladder and the same corroboration
 *  tests as a named key, and nothing about which slot feeds which option is
 *  hand-mapped. The pseudo-key is a synthetic id, never a name the CLI uses, so it
 *  is prefixed to make that impossible to miss. */
const SLOT_PREFIX = '@slot:';

/** The pseudo-key for one slot. `number` is absent for a member that holds its
 *  value directly (`fileReference`, `memberKey`). */
export function slotID(member, number) {
  return number === undefined ? `${SLOT_PREFIX}${member}` : `${SLOT_PREFIX}${member}:${number}`;
}

/** `{ member, number? }` for a slot pseudo-key, or null for a real key. */
export function parseSlotID(key) {
  const text = String(key ?? '');
  if (!text.startsWith(SLOT_PREFIX)) return null;
  const rest = text.slice(SLOT_PREFIX.length);
  const at = rest.indexOf(':');
  return at === -1 ? { member: rest } : { member: rest.slice(0, at), number: rest.slice(at + 1) };
}

/** The step as the matcher sees it: `slots` replaced, IN PLACE in the key order,
 *  by one pseudo-key per slot. Everything downstream then reads `view[key]`
 *  without knowing whether the key was the CLI's or synthesised.
 *
 *  A member whose value is an object of numbered entries expands to one key per
 *  entry; a member holding a scalar expands to one key. Nothing else is touched,
 *  so a step with no `slots` expands to an identical view. */
export function expandSlots(step) {
  if (!step || typeof step !== 'object' || !Object.hasOwn(step, 'slots')) return step ?? {};
  const slots = step.slots;
  const view = {};
  for (const [key, value] of Object.entries(step)) {
    if (key !== 'slots') {
      view[key] = value;
      continue;
    }
    if (slots === null || typeof slots !== 'object' || Array.isArray(slots)) continue;
    for (const [member, held] of Object.entries(slots)) {
      if (held !== null && typeof held === 'object' && !Array.isArray(held)) {
        for (const [number, entry] of Object.entries(held)) view[slotID(member, number)] = entry;
      } else {
        view[slotID(member)] = held;
      }
    }
  }
  return view;
}

/** Keys that carry a displayed option, in the order the CLI reports them, with
 *  `slots` expanded into one key per slot. */
export function displayKeys(step) {
  if (!step || typeof step !== 'object') return [];
  return Object.keys(expandSlots(step)).filter((key) => !NON_DISPLAY_KEYS.has(key));
}

function upperFirst(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Upper-case each word's first letter, leaving a word that already carries a
 *  capital alone so `SSL` and `cURL` survive. */
function startCase(text) {
  return text
    .split(' ')
    .map((word) => (/[A-Z]/.test(word) ? word : upperFirst(word)))
    .join(' ');
}

/** The spellings of a key observed as a label: verbatim (`cURL options`),
 *  leading capital (`With dialog`), start case (`Verify SSL Certificates`).
 *  No per-key table here — generating candidates and letting the data pick is
 *  what keeps the catalog measured. Labels FileMaker does not derive from the
 *  key at all (`account` -> `Account Name`) are found by value instead. */
export function labelCandidates(key) {
  const text = String(key ?? '');
  if (!text) return [];
  const cased = startCase(text);
  return [...new Set([text, upperFirst(text), cased, upperFirst(cased)])];
}

/** Is `index` the start of an option? Position 0, or just past a `;` and any
 *  spaces. FileMaker usually writes " ; " but sometimes "; " (`Add; Mac Roman`). */
function isSegmentStart(content, index) {
  let at = index;
  while (at > 0 && content[at - 1] === ' ') at -= 1;
  return at === 0 || content[at - 1] === ';';
}

/** Is `index` (one past a match) the end of an option? */
function isSegmentEnd(content, index) {
  let at = index;
  while (at < content.length && content[at] === ' ') at += 1;
  return at >= content.length || content[at] === ';';
}

/** Every index where `needle` occurs at an option boundary. */
function segmentStarts(content, needle) {
  const found = [];
  if (!needle) return found;
  for (let at = content.indexOf(needle); at !== -1; at = content.indexOf(needle, at + 1)) {
    if (isSegmentStart(content, at)) found.push(at);
  }
  return found;
}

/** The forms a JSON value can take on screen.
 *
 *  A scalar shows as itself, or wrapped in the curly quotes FileMaker puts
 *  around a named object (`“noop”`).
 *
 *  A list of file paths shows only its FIRST entry, with the scheme dropped and
 *  sometimes only the file name kept — measured: `["file:file.txt"]` renders
 *  `“file.txt”`, `["$Path1","$Path2"]` renders `“$Path1”`, and
 *  `["file:../../SnipMaker/fmxmlsnippet.xml"]` renders `“fmxmlsnippet.xml”`.
 *  Each variant reports which transform produced it so a renderer knows. */
function renderVariants(value, step) {
  const plain = plainVariants(value);
  const repetition = repetitionBracket(step?.repetition);
  if (repetition === null) return plain;
  // A field's repetition is not an option of its own: FileMaker appends it to
  // the field it belongs to (`Source Field: Table::Field[10]`).
  return plain.flatMap((variant) => [
    variant,
    { ...variant, text: `${variant.text}${repetition}`, withRepetition: true },
  ]);
}

function plainVariants(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return listVariants(value);
  if (typeof value === 'boolean' || typeof value === 'object') return [];
  const text = normaliseCalc(value);
  if (!text) return [];
  return [
    { text, quoted: false },
    { text: `“${text}”`, quoted: true },
  ];
}

/** A key that carries a repetition: the plain `repetition`, or a second one named
 *  after the option it belongs to.
 *
 *  It CANNOT be the literal string, because one step can report two of them —
 *  measured on `Generate Response from Model`, where `repetition` is the response
 *  target's and `sliding window variable repetition` is the history variable's.
 *  Hard-coding the first left the second with no route to a `suffix` segment, so
 *  it read as never displayed while FileMaker was displaying it in 5 of its 6
 *  examples (`Save Message History To: $history[<calc>]`). */
export function isRepetitionKey(key) {
  return key === 'repetition' || / repetition$/.test(String(key));
}

/** Does this key only ever render as a suffix on another option?
 *
 *  Measured: a field's `repetition` is shown inside the field it belongs to
 *  (`Source Field: Table::Field[10]`), never as an unlabelled option of its own.
 *  It is named here because that render form is a measured fact, the same fact
 *  `addRepetitionSuffix` encodes — without it, a step whose repetition is a
 *  calculation lets the repetition claim another key's option, because they report
 *  the same text (`Insert Embedding [ … ; Input: <calc> ]`, and
 *  `Generate Response from Model`'s `sliding window variable repetition` claiming
 *  `Web Viewer:`).
 *
 *  Only passes 2–4 consult this, which is deliberate: where FileMaker gives the
 *  repetition a LABEL of its own it still anchors in pass 1, and it does —
 *  `Go to Object [ … ; Repetition: 1 ]`, `AVPlayer Play [ … ; Repetition: 2 ]`,
 *  `Refresh Object`. What is refused is claiming an option by value or by
 *  standing alone, never a label FileMaker actually printed. */
function rendersAsSuffixOnly(key) {
  return isRepetitionKey(key);
}

/** The bracket FileMaker appends to a repeating option for this repetition
 *  value, or `null` when it appends nothing at all.
 *
 *  Two values are measured to render as something other than themselves, and
 *  BOTH are the same fact — the repetition was never chosen:
 *
 *   - `1` is the default and prints nothing (`Set Variable [ $var ; Value: … ]`,
 *     11 examples). The repo owner confirms it: "FM does not print the rep
 *     number if it is 1."
 *   - `0` prints the EMPTY bracket (`Generate Response from Model [ … ;
 *     Response: $target[] ; … ]`). There is no repetition zero — the owner is
 *     explicit — so this is the empty option slot of ruling 1 appearing inside a
 *     repetition, and it is deliberately not described as a repetition number
 *     anywhere.
 *
 *  Returned as the whole bracket rather than as its content so `null` (nothing
 *  appended) stays distinct from `''` (an empty bracket IS appended). */
export function repetitionBracket(value) {
  const text = normaliseCalc(value);
  if (text === '' || text === '1') return null;
  return text === '0' ? '[]' : `[${text}]`;
}

function listVariants(list) {
  const first = list.find((entry) => entry !== null && entry !== undefined && typeof entry !== 'object');
  if (first === undefined) return [];
  const base = normaliseCalc(first);
  if (!base) return [];
  const forms = [{ text: base }];
  const noScheme = base.replace(/^[A-Za-z][A-Za-z0-9+.-]*:/, '');
  if (noScheme && noScheme !== base) forms.push({ text: noScheme, derivedFrom: 'schemeStripped' });
  const tail = noScheme.split('/').pop();
  if (tail && tail !== noScheme) forms.push({ text: tail, derivedFrom: 'fileName' });
  return forms.flatMap((form) => [
    { ...form, quoted: false, listFirst: true },
    { ...form, text: `“${form.text}”`, quoted: true, listFirst: true },
  ]);
}

/** The optional presentation fields of a segment, present only when true. */
function presentationOf(meta) {
  return {
    ...(meta.quoted ? { quoted: true } : {}),
    ...(meta.truncated ? { truncated: true } : {}),
    ...(meta.listFirst ? { listFirst: true } : {}),
    ...(meta.derivedFrom ? { derivedFrom: meta.derivedFrom } : {}),
    ...(meta.withRepetition ? { withRepetition: true } : {}),
    ...(meta.decorated ? { decorated: meta.decorated } : {}),
  };
}

/** Text that could be a label: short, wordlike, no calculation punctuation. */
const LABEL_SHAPE = /^[A-Za-z][A-Za-z0-9 '\/&.()\-]{0,38}$/;
const LABEL_CHARS = /[A-Za-z0-9 '\/&.()\-]/;

/** Read backwards from `at` for a `<Label>:` immediately preceding it.
 *  Returns the label and where it starts, or null. */
function labelBefore(content, at) {
  let cursor = at;
  while (cursor > 0 && content[cursor - 1] === ' ') cursor -= 1;
  if (cursor === 0 || content[cursor - 1] !== ':') return null;
  const colon = cursor - 1;
  // `Table::Field` is a field reference, not a label.
  if (colon > 0 && content[colon - 1] === ':') return null;
  // Walk back over label-shaped text only, so an infix label is found too:
  // `“script” from file: “source”` yields `from file`, not the whole option.
  let start = colon;
  while (start > 0 && content[start - 1] !== ';' && LABEL_CHARS.test(content[start - 1])) start -= 1;
  const label = content.slice(start, colon).trim();
  if (!LABEL_SHAPE.test(label)) return null;
  return { label, labelStart: content.indexOf(label, start), valueStart: at };
}

function strMinusTrailingSeparator(text) {
  let out = text.trim();
  while (out.endsWith(';')) out = out.slice(0, -1).trim();
  return out;
}

function stripSeparators(text) {
  let out = text.trim();
  while (out.startsWith(';')) out = out.slice(1).trim();
  while (out.endsWith(';')) out = out.slice(0, -1).trim();
  return out;
}

/** Does the rendered text show this JSON value? Reports how, because the
 *  presentation detail is what a renderer has to reproduce:
 *   - quoted:    FileMaker added curly quotes around a named object
 *   - truncated: FileMaker cut a long option short with U+2026 */
function valueShownAs(rendered, value, step) {
  const shown = normaliseCalc(rendered);
  for (const variant of renderVariants(value, step)) {
    if (shown === variant.text) {
      const { text, ...meta } = variant;
      return meta;
    }
  }
  if (shown.endsWith('…')) {
    const head = shown.slice(0, -1);
    if (head.length > 0 && normaliseCalc(value).startsWith(head)) return { truncated: true };
  }
  // The value is there but FileMaker appended something the CLI did not report
  // in this key: a repetition it reports for a different field
  // (`Messages: Table::Field[10]`) or a layout's table (`“File Open”
  // (blank)`). Report the value as shown and carry the decoration, rather than
  // calling the whole option a disagreement.
  for (const variant of renderVariants(value, step)) {
    if (!shown.startsWith(variant.text) || shown.length === variant.text.length) continue;
    const rest = shown.slice(variant.text.length).trim();
    // A decoration cannot cross an option boundary: without the `[^;]` a greedy
    // `.*` swallows the options that follow, and their keys then look as if
    // FileMaker never showed them.
    if (/^(\[[^;]*\]|\([^;]*\))$/.test(rest)) {
      const { text, ...meta } = variant;
      return { ...meta, decorated: rest };
    }
  }
  return null;
}

/** FileMaker spells a boolean option two ways, both measured: `With dialog: On`
 *  and `Disable Interaction: No`. The rendered word is kept on the segment so a
 *  renderer knows which pair a given key uses. */
const STATE_WORDS = { On: true, Off: false, Yes: true, No: false };

/** Classify a labelled anchor once its value text is known.
 *
 *  Beyond the brief's kinds, two the data forced:
 *   - `labelledEnum`: the label is right but the text is a display form of the
 *     value, not the value (`flush: "always"` -> `Flush: Always`;
 *     `account type: 1` -> `Authenticate via: External Server`). Calling that
 *     `labelled` would make a renderer print the raw value.
 *   - `labelledMismatch`: the label is right and the text is neither the value
 *     nor a plausible display of it. The one place this fires in the owner's
 *     data is a calc where the CLI reports `<Function Missing>` for a plugin
 *     function the Script Workspace spells out — a genuine disagreement that
 *     must not be dressed up as a match. */
function classifyLabelled(text, value, step) {
  if (MASK_PATTERN.test(text) && normaliseCalc(value) !== text) {
    return { render: 'masked' };
  }
  if (typeof value === 'boolean' && Object.hasOwn(STATE_WORDS, text)) {
    return { render: STATE_WORDS[text] === value ? 'labelledState' : 'labelledMismatch' };
  }
  const shown = valueShownAs(text, value, step);
  if (shown) return { render: 'labelled', ...shown };
  // A STRUCTURED value whose `set` names the state FileMaker displays. Measured
  // on `New Window | style`, which the CLI reports as
  // `{raw:"0x…", set:["documentMode","resize",…]}` while FileMaker prints
  // `Style: Document`. Read as `labelledMismatch` before this existed — a genuine
  // mapping filed as a CLI/Workspace disagreement, purely because the catalog had
  // no kind for a structured value. Which member carries the display name is
  // settled by the derivation, not here: it aggregates over every example and
  // takes the member that predicts the text.
  if (isSetValue(value) && OPTION_PHRASE.test(text)) return { render: 'setMember' };
  // An enum is a CODE with a display name: the CLI reports a bare token
  // (`always`, `resizeToFit`) or a number (`animation: 1`) and FileMaker shows
  // the human form. A calculation is never that, so a calc that does not match
  // is a disagreement rather than an enum.
  if (isEnumCode(value) && text.length > 0 && text.length <= 40 && !text.includes(';')) {
    return { render: 'labelledEnum' };
  }
  return { render: 'labelledMismatch' };
}

/** Is this value a flag word the CLI has already decoded for us — `{raw, set}`
 *  with `set` a list of member names? The one shape in the owner's data is
 *  `New Window | style`; the test is on the SHAPE so a second key reporting the
 *  same shape is read the same way. */
export function isSetValue(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray(value.set) &&
    value.set.every((member) => typeof member === 'string')
  );
}

/** Could this JSON value be an enum code rather than content? */
function isEnumCode(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value.trim());
}

/** The text of a labelled option, given that its span runs to the next anchor.
 *
 *  The span can have swallowed options no key claimed (`Password: •••••••• ;
 *  Privilege Set: [Data Entry Only]` — the CLI reports no privilege-set key).
 *  Only when the whole span fails to classify does this look at `;` at all, and
 *  then only to try shorter prefixes. A calculation's whole span matches, so a
 *  calc is never cut — which is the property the label anchoring exists for.
 *
 *  When nothing classifies, the claim is cut back to the FIRST option in the
 *  span. Keeping the whole span would swallow options that belong to other keys
 *  and make `ignoredKeys` say FileMaker never showed them — measured on
 *  `New Window [ Style: Document ; Using layout: “File Open” (blank) ; … ]`,
 *  where `style` is a structured value nothing can classify and `layout` was
 *  reported as never rendered 8 times out of 8. Cut back, the rest becomes a gap
 *  that `attributeLeftover` can still place. */
function resolveLabelledValue(content, valueStart, limit, value, step) {
  const full = strMinusTrailingSeparator(content.slice(valueStart, limit));
  const verdict = classifyLabelled(full, value, step);
  if (verdict.render !== 'labelledMismatch') return { text: full, ...verdict };
  for (let at = full.indexOf(';'); at !== -1; at = full.indexOf(';', at + 1)) {
    const head = strMinusTrailingSeparator(full.slice(0, at));
    if (!head) continue;
    const attempt = classifyLabelled(head, value, step);
    if (attempt.render !== 'labelledMismatch') return { text: head, ...attempt };
  }
  const firstOption = strMinusTrailingSeparator(full.split(';')[0]);
  return { text: firstOption || full, ...verdict };
}

/** Bracket content -> segments, with everything it cannot place reported.
 *
 *  Returns `{ segments, positions, unmatched, unmatchedAt, ignoredKeys }`:
 *   - segments:    `{ key, render, label, value }` in RENDERED order. `label` is
 *                  the label as observed, since FileMaker does not always derive
 *                  it from the key. Present only when they apply:
 *                  `quoted`, `truncated`, `listFirst`, `derivedFrom`,
 *                  `withRepetition`, `decorated` (presentation the renderer must
 *                  reproduce), `suffixOf` (which option a suffix belongs to) and
 *                  `attributed` (how a segment with no anchor was placed —
 *                  weaker evidence, see `attributeLeftover`).
 *   - positions:   each segment's offset in the bracket content, parallel to
 *                  `segments`; a suffix carries its host's offset
 *   - unmatched:   stretches of the line no key claimed, in rendered order
 *   - unmatchedAt: the same stretches with their offsets
 *   - ignoredKeys: keys the line never showed
 *
 *  `unmatched` and `ignoredKeys` are the point, not an afterthought: they are how
 *  the next task learns what these two views of a step could not settle.
 *
 *  Never throws: unplaceable content and unplaceable keys are the report.
 */
export function matchSegments(step, line, displayName) {
  // Every pass below reads `view[key]`, and a slot pseudo-key only exists here —
  // so the expansion happens once, at the boundary, and no pass has to know that
  // some of its keys were synthesised.
  const view = expandSlots(step);
  const keys = displayKeys(step);
  const empty = { segments: [], positions: [], unmatched: [], unmatchedAt: [], ignoredKeys: keys };
  let content = null;
  try {
    content = bracketContent(line, displayName ?? step?.step);
    if (content === null || content === '') return empty;

    const anchors = findAnchors(content, keys, view);
    const placed = new Set(anchors.map((anchor) => anchor.key));
    const { found, claimed } = readAnchoredOptions(content, anchors, view);

    const leftoverKeys = keys.filter((key) => !placed.has(key));
    const { unmatched, unmatchedAt, extra } = attributeLeftover(
      gapsBetween(content, claimed),
      leftoverKeys,
      view,
    );
    for (const segment of extra) placed.add(segment.key);

    // Each option's OFFSET in the bracket content, returned alongside the segments
    // rather than on them: the aggregation needs it to order an option no key owns
    // (see the presentation pass in the derivation) against the ones keys do, and a
    // parallel array leaves the segment shape every other caller reads unchanged.
    const ordered = [...found, ...extra].sort((a, b) => a.position - b.position);
    resolveInlineHosts(ordered);
    const segments = ordered.map(({ position, ...rest }) => rest);
    const positions = ordered.map((segment) => segment.position);
    for (const key of addRepetitionSuffix(segments, view, positions)) placed.add(key);

    return {
      segments,
      positions,
      unmatched,
      unmatchedAt,
      ignoredKeys: keys.filter((key) => !placed.has(key)),
    };
  } catch {
    // Never throw — but never look clean either: the content goes to `unmatched`
    // so an internal error cannot pass as "this step rendered no options" and be
    // counted among the pairs with nothing left over.
    return {
      segments: [],
      positions: [],
      unmatched: content ? [content] : [],
      unmatchedAt: content ? [{ start: 0, text: content }] : [],
      ignoredKeys: keys,
    };
  }
}

/** Locate every option a key can be shown to own, in four passes from strongest
 *  evidence to weakest. No pass ever cuts the content on `;`. */
function findAnchors(content, keys, step) {
  const anchors = [];
  const placed = new Set();
  const labelClaims = new Set(); // label start positions already taken
  const overlaps = (start, end) =>
    anchors.some((anchor) => start < anchor.claimEnd && end > anchor.start);
  const state = { content, keys, step, anchors, placed, labelClaims, overlaps };

  anchorByKeyLabel(state);
  anchorByWholeOption(state);
  anchorByObservedLabel(state);
  anchorBeforeObservedLabel(state);

  return anchors.sort((a, b) => a.start - b.start);
}

/** Pass 1 — a label that is a spelling of the key (`With dialog:`). */
function anchorByKeyLabel({ content, keys, anchors, placed, labelClaims }) {
  for (const key of keys) {
    let best = null;
    for (const candidate of labelCandidates(key)) {
      for (const at of segmentStarts(content, `${candidate}:`)) {
        if (content[at + candidate.length + 1] === ':') continue; // `Name::Field`
        if (labelClaims.has(at)) continue;
        const better =
          !best || at < best.start || (at === best.start && candidate.length > best.label.length);
        if (better) best = { start: at, label: candidate };
        break;
      }
    }
    if (!best) continue;
    let valueStart = best.start + best.label.length + 1;
    while (content[valueStart] === ' ') valueStart += 1;
    anchors.push({
      key,
      kind: 'labelled',
      start: best.start,
      valueStart,
      claimEnd: valueStart,
      label: best.label,
    });
    placed.add(key);
    labelClaims.add(best.start);
  }
}

/** Pass 2 — a whole option that is the key's value, or a true boolean's own
 *  label standing alone (`Select`). */
function anchorByWholeOption({ content, keys, step, anchors, placed, overlaps }) {
  for (const key of keys) {
    if (placed.has(key) || rendersAsSuffixOnly(key)) continue;
    const value = step[key];
    const attempts =
      value === true
        ? // A key literally NAMED `on` makes these two readings of a bare `On`
          // indistinguishable within one example: the key's own label standing
          // alone, or the boolean's state. The state reading wins, because it is
          // the only one that also explains the SAME step printing `Off` — which
          // `Allow User Abort`, `Set Error Capture` and `Set Use System Formats`
          // all do in this data. Read as `bareWhenTrue`, a renderer prints nothing
          // when the flag is off, which is the visible error this kind exists to
          // remove. The residual risk is a step that really does print its flag
          // name only when true AND whose key is named `on`; no such step is in
          // the data, and the `Off` examples above are the evidence.
          labelCandidates(key).map((text) => ({
            text,
            kind: spellsState({ label: null, value: text }, value) ? 'bareState' : 'bareWhenTrue',
          }))
        : renderVariants(value, step).map((variant) => ({ ...variant, kind: 'bare' }));
    let hit = null;
    for (const attempt of attempts) {
      for (const at of segmentStarts(content, attempt.text)) {
        const end = at + attempt.text.length;
        if (!isSegmentEnd(content, end)) continue;
        if (overlaps(at, end)) continue;
        hit = { ...attempt, start: at, end };
        break;
      }
      if (hit) break;
    }
    if (!hit) continue;
    anchors.push({
      key,
      kind: hit.kind,
      start: hit.start,
      valueStart: hit.start,
      claimEnd: hit.end,
      label: hit.kind === 'bareWhenTrue' ? hit.text : null,
      bareText: hit.text,
      ...presentationOf(hit),
    });
    placed.add(key);
  }
}

/** Pass 3 — a label FileMaker does not derive from the key (`account` ->
 *  `Account Name`, `old` -> `Old Password`). The value is located first and the
 *  label read off the data in front of it, so the label is observed rather than
 *  guessed. Also catches the infix form `“script” from file: “source”`.
 *
 *  Known limit: the value must END its option, so a DECORATED value never
 *  anchors here — `Using layout: “File Open” (blank)` and `Messages:
 *  $history[10]` both carry text after the value. Those reach their key through
 *  `attributeLeftover` instead, which is why cutting a mismatching span back
 *  (see `resolveLabelledValue`) matters: without the gap there is nothing left
 *  for that pass to place. */
function anchorByObservedLabel(state) {
  // Two rounds, because several keys can report the SAME value: measured on
  // Perform Semantic Find, where `account`, `model`, `text` and `count` all
  // report one calculation. Taking the earliest free option per key in JSON
  // order let `count` claim `Account Name:` and left `account` reported as never
  // rendered. So every key with label-word evidence claims first, and only then
  // do the rest take what is left.
  claimObservedLabels(state, true);
  claimObservedLabels(state, false);
}

function claimObservedLabels(
  { content, keys, step, anchors, placed, labelClaims, overlaps },
  requireWordEvidence,
) {
  for (const key of keys) {
    if (placed.has(key)) continue;
    const hits = [];
    for (const variant of renderVariants(step[key], step)) {
      for (let at = content.indexOf(variant.text); at !== -1; at = content.indexOf(variant.text, at + 1)) {
        const end = at + variant.text.length;
        if (!isSegmentEnd(content, end)) continue;
        const label = labelBefore(content, at);
        if (!label || labelClaims.has(label.labelStart)) continue;
        if (overlaps(label.labelStart, end)) continue;
        // A repetition renders inside the option it belongs to, so the only label
        // it may take here is a REPETITION label — which FileMaker does print for
        // some steps, and for a key it does not spell: `AVPlayer Play`'s
        // `object repetition` renders as `Repetition: 1`, so it cannot anchor in
        // pass 1 and must anchor here. Any other label belongs to another option,
        // which is how `sliding window variable repetition` came to claim
        // `Web Viewer:` on a step where its value and that option's are identical.
        if (rendersAsSuffixOnly(key) && !wordsOf(label.label).includes('repetition')) continue;
        hits.push(label);
      }
      if (hits.length > 0) break;
    }
    // Options can also share a value within one step (`Position: 123 ; Start
    // Offset: 123 ; End Offset: 123`), so prefer a label sharing a word.
    const withEvidence = hits.filter(
      (candidate) => sharedWordCount(wordsOf(candidate.label), wordsOf(key)) > 0,
    );
    const hit = requireWordEvidence ? withEvidence[0] : (withEvidence[0] ?? hits[0]);
    if (!hit) continue;
    anchors.push({
      key,
      kind: 'labelled',
      start: hit.labelStart,
      valueStart: hit.valueStart,
      claimEnd: hit.valueStart,
      label: hit.label,
      // A label that does not begin an option is printed INSIDE the option before
      // it, with no separator: `Script: “name” from file: “source”`. Recorded here
      // because this is the only pass that can find such a label — pass 1 searches
      // option starts only — and because it is a render form the catalog has to
      // carry, not a parse detail: without it the option comes out as a separate
      // `; from file: …`, which FileMaker never writes.
      inline: !isSegmentStart(content, hit.labelStart),
    });
    placed.add(key);
    labelClaims.add(hit.labelStart);
  }
}

/** Pass 4 — a bare option that ends where an observed label begins rather than
 *  at a separator: the script name in `“script” from file: “source”`. */
function anchorBeforeObservedLabel({ content, keys, step, anchors, placed, overlaps }) {
  for (const key of keys) {
    if (placed.has(key) || rendersAsSuffixOnly(key)) continue;
    const softEnds = new Set(anchors.map((anchor) => anchor.start));
    let hit = null;
    for (const variant of renderVariants(step[key], step)) {
      for (const at of segmentStarts(content, variant.text)) {
        const end = at + variant.text.length;
        let after = end;
        while (content[after] === ' ') after += 1;
        if (!softEnds.has(after)) continue;
        if (overlaps(at, end)) continue;
        hit = { ...variant, start: at, end };
        break;
      }
      if (hit) break;
    }
    if (!hit) continue;
    anchors.push({
      key,
      kind: 'bare',
      start: hit.start,
      valueStart: hit.start,
      claimEnd: hit.end,
      label: null,
      bareText: hit.text,
      ...presentationOf(hit),
    });
    placed.add(key);
  }
}

/** Read each anchor's option out of the content and classify it.
 *
 *  A labelled value runs to the NEXT ANCHOR, minus the separator — this is where
 *  not splitting pays, since a calc keeps its own " ; ". */
function readAnchoredOptions(content, anchors, step) {
  const found = [];
  const claimed = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const limit = index + 1 < anchors.length ? anchors[index + 1].start : content.length;
    if (anchor.kind === 'labelled') {
      const verdict = resolveLabelledValue(content, anchor.valueStart, limit, step[anchor.key], step);
      found.push({
        position: anchor.start,
        key: anchor.key,
        render: verdict.render,
        label: anchor.label,
        value: verdict.text,
        // Only the FLAG here. Which option this one sits inside cannot be decided
        // yet: the option before it may be one no key anchored, placed by a later
        // pass — measured, and getting it wrong put a script's file reference inside
        // the option for the region name.
        ...(anchor.inline ? { inline: true } : {}),
        ...presentationOf(verdict),
      });
      claimed.push([anchor.start, anchor.valueStart + verdict.text.length]);
    } else {
      found.push({
        position: anchor.start,
        key: anchor.key,
        render: anchor.kind,
        label: anchor.label,
        value: anchor.bareText,
        ...presentationOf(anchor),
      });
      claimed.push([anchor.start, anchor.claimEnd]);
    }
  }
  return { found, claimed };
}

/** An inline option sits inside the option printed immediately before it, so its host
 *  is only known once EVERY option is in place and ordered — including the ones no key
 *  anchored, which a later pass attributes. Resolving it from the anchor list alone
 *  named the wrong host on a step where the option in between was attributed rather
 *  than anchored, and the file reference came out inside the region name. */
function resolveInlineHosts(ordered) {
  for (let index = 0; index < ordered.length; index += 1) {
    if (!ordered[index].inline) continue;
    delete ordered[index].inline;
    if (index > 0) ordered[index].inlineOf = ordered[index - 1].key;
  }
}

/** The stretches of content no anchor claimed. */
function gapsBetween(content, claimed) {
  const gaps = [];
  let cursor = 0;
  for (const [start, end] of claimed) {
    if (start > cursor) gaps.push({ start: cursor, text: content.slice(cursor, start) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < content.length) gaps.push({ start: cursor, text: content.slice(cursor) });
  return gaps;
}

/** The `[X]` a host option carries beyond its own value, or null.
 *
 *  Two routes, both already recorded by the matcher: a variant matched with the
 *  repetition appended (`withRepetition`, so the tail is inside `value`), or
 *  `valueShownAs` found extra text after the value and kept it as `decorated`. */
function bracketedTail(segment) {
  const decorated = /^\[(.*)\]$/.exec(String(segment.decorated ?? ''));
  if (decorated) return decorated[1];
  if (!segment.withRepetition) return null;
  const tail = /\[([^[\]]*)\]$/.exec(String(segment.value ?? ''));
  return tail ? tail[1] : null;
}

/** A repetition renders as a suffix on the option it belongs to rather than as
 *  an option of its own. Report it as such: leaving it out of the segments would
 *  make `ignoredKeys` claim FileMaker never showed it — which is exactly the false
 *  claim that reached the catalog while this function looked only at the key
 *  literally named `repetition`.
 *
 *  The host is found by EVIDENCE, not by name: the host option's rendered text
 *  carries a trailing `[X]`, and X is this key's value. So a step with two
 *  repetitions credits both, and a repetition whose value is nowhere in the line
 *  is credited to nothing — the safe direction. Ambiguity is refused: if two
 *  unplaced repetition keys hold the same value, neither is claimed.
 *
 *  A CANDIDATE IS A KEY NAMED LIKE A REPETITION **OR A VALUE THE CLI DID NOT NAME**,
 *  and the second half is why 11 places in the CLI's `slots` object were neither
 *  rendered nor explained. A repetition that is a CALCULATION rather than a number
 *  arrives in `slots.calc` with no name at all, so the name test could never reach
 *  it: FileMaker prints it inside the field it belongs to
 *  (`Target field: <field>[<calc>]`) on five step types, and the derivation could
 *  only record that it had refused to call it never-shown. The evidence required is
 *  unchanged and it is the strongest kind this matcher has — the host option's own
 *  bracket content IS this value — so widening the candidate set cannot invent a
 *  placement, only credit one FileMaker itself printed. Ambiguity is still refused.
 *
 *  Returns the keys it claimed. */
function addRepetitionSuffix(segments, step, positions) {
  if (!step || typeof step !== 'object') return [];
  const placed = new Set(segments.map((segment) => segment.key));
  const claimed = [];
  for (let index = 0; index < segments.length; index += 1) {
    const shown = bracketedTail(segments[index]);
    if (shown === null) continue;
    // Matched through `repetitionBracket`, not against the raw value, so the two
    // values that render as something other than themselves are credited to the
    // key that holds them rather than left looking like a key FileMaker never
    // shows: an empty bracket is `repetition: 0`.
    const owners = Object.keys(step).filter(
      (key) =>
        (isRepetitionKey(key) || parseSlotID(key) !== null) &&
        !placed.has(key) &&
        repetitionBracket(step[key]) === `[${shown}]`,
    );
    if (owners.length !== 1) continue;
    segments.splice(index + 1, 0, {
      key: owners[0],
      render: 'suffix',
      label: null,
      value: `[${shown}]`,
      suffixOf: segments[index].key,
    });
    // A suffix sits inside its host's option, so it shares the host's offset — and
    // the parallel array has to stay parallel.
    if (positions) positions.splice(index + 1, 0, positions[index]);
    placed.add(owners[0]);
    claimed.push(owners[0]);
    index += 1;
  }
  return claimed;
}

/** An option that is neither a value nor a key-derived label is an ENUM: the CLI
 *  reports a code and FileMaker shows a display name for it (`state:
 *  "resizeToFit"` -> `Resize to Fit`, `target: "currentLayout"` -> `Using
 *  layout: <Current Layout>`), or a boolean whose label the key does not spell
 *  (`hide` -> `Hide Controls: No`). The pair does not say which key owns such an
 *  option, so attributing it is a leap and every attribution here records how it
 *  was reached in `attributed`, so the next task can weigh it:
 *
 *   - `labelWords`: the option's label shares a word with exactly one unplaced
 *     key (`Hide Controls` / `hide`, `Save to` / `save type`). Evidence from the
 *     pair itself.
 *   - `sole`: no word evidence, but exactly one option and exactly one unplaced
 *     key that could render at all remain, so there is nothing else it can be.
 *
 *  Anything less certain stays in `unmatched`, where the next task can see it —
 *  a wrong guess would put an invented fact in the catalog, which is the failure
 *  this exists to remove. Deliberately NOT attempted: matching leftovers by
 *  order. The Insert from URL ground truth shows FileMaker's render order is not
 *  the CLI's key order, so order would be a guess dressed as a measurement. */
function attributeLeftover(gaps, leftoverKeys, step) {
  const openGaps = gaps
    .map((gap) => ({ start: gap.start, text: stripSeparators(gap.text) }))
    .filter((gap) => gap.text !== '')
    .flatMap((gap) => splitLeftover(gap));
  const extra = [];
  const canRender = (key) => {
    const value = step[key];
    if (value === null || value === undefined || rendersAsSuffixOnly(key)) return false;
    return Array.isArray(value) || typeof value !== 'object';
  };
  let openKeys = leftoverKeys.filter(canRender);

  /** Place `gap` on `key` unless the result would be incoherent. A label that
   *  shares a word is not enough on its own: `has error code` shares "error"
   *  with `Error Message:` but does not own it, and `repetition` was the only
   *  key left over next to `Action: Train Model`. If the option cannot be
   *  classified against the key's value, the option and the key stay
   *  unresolved, which is the honest answer. */
  const take = (gap, key, attributed) => {
    const option = describeOption(gap, key, step);
    if (option.render === 'labelledMismatch') return false;
    extra.push({ ...option, position: gap.start, attributed });
    openGaps.splice(openGaps.indexOf(gap), 1);
    openKeys = openKeys.filter((other) => other !== key);
    return true;
  };

  // Evidence first: words the option shares with exactly one unplaced key —
  // either with the key's name (`Hide Controls` / `hide`) or with the code the
  // CLI reports as its value (`First` / `selection: "first"`, `Find Next` /
  // `operation: "findNext"`).
  for (const gap of [...openGaps]) {
    if (gap.text.includes(';')) continue; // more than one option; too coarse to place
    const option = splitOption(gap.text);
    const labelWords = wordsOf(option.label ?? option.value);
    const shownWords = wordsOf(option.value);
    const scored = openKeys
      .map((key) => ({
        key,
        label: sharedWordCount(labelWords, wordsOf(key)),
        // A bare state word IS value evidence: `Off` spells `false` as surely as
        // `First` spells `"first"`. It cannot go through `wordsOf`, which drops
        // words under three letters and would see `On` and `No` as nothing.
        value: sharedWordCount(shownWords, valueWords(step[key])) + (spellsState(option, step[key]) ? 1 : 0),
      }))
      .map((entry) => ({ ...entry, score: entry.label + entry.value }))
      .filter((entry) => entry.score > 0)
      // A key the option cannot be classified against is not a candidate at all,
      // so it must not outrank one that can: `sliding window variable
      // repetition` shares more words with `Save Message History To:
      // $history[…]` than `sliding window variable`, but only the latter's value
      // is in it.
      .filter((entry) => describeOption(gap, entry.key, step).render !== 'labelledMismatch')
      // Most shared words wins; on a tie the key whose own value spells the
      // option beats one whose name merely resembles it (`Last` is
      // `selection: "last"`, not the `exit after last` that shares a word).
      .sort((a, b) => b.score - a.score || b.value - a.value);
    if (scored.length === 0) continue;
    const [best, next] = scored;
    if (next && next.score === best.score && next.value === best.value) continue; // ambiguous
    take(gap, best.key, best.value > 0 ? 'valueWords' : 'labelWords');
  }

  // Then counting: one option left, one key left that could render at all. A
  // boolean false renders nothing once it has no label anchor, so it does not
  // count as that key.
  const soleKeys = openKeys.filter((key) => step[key] !== false);
  // A NAMED key counts before a slot does. `sole` is a COUNT, and expanding `slots`
  // into keys of their own multiplies what is left over to count: measured on a step
  // where the one key left over became four the moment its three unnamed slots joined
  // it, so an attribution that had been right stopped being reachable. A slot can
  // still be claimed by counting — one step's only leftover option is a placeholder
  // for a slot — but only where no named key is competing for the same option.
  const counting = soleKeys.some((key) => parseSlotID(key) === null)
    ? soleKeys.filter((key) => parseSlotID(key) === null)
    : soleKeys;
  if (
    openGaps.length === 1 &&
    counting.length === 1 &&
    !openGaps[0].text.includes(';') &&
    !labelBelongsToAnotherKey(step, counting[0], openGaps[0].text)
  ) {
    take(openGaps[0], counting[0], 'sole');
  }

  return {
    unmatched: openGaps.map((gap) => gap.text),
    // The same stretches WITH their offsets. Two shapes rather than one because
    // three callers only ask "how much was left over"; only the pass that has to
    // order an unowned option against the owned ones needs where it sat.
    unmatchedAt: openGaps.map((gap) => ({ start: gap.start, text: gap.text })),
    extra,
  };
}

/** Is this leftover option's label a spelling of some OTHER key the step reports?
 *
 *  Then the option is that key's, whatever counting says. `sole` is the weakest
 *  attribution there is — "nothing else was left" — and it must not outrank a label
 *  FileMaker printed: measured on a step where the only key left over was a slot and
 *  the option left over was `Animation:`, on a step whose `animation` key was right
 *  there. That is the same false shape the repo owner ruled out on `Go to Layout`
 *  ("clearly FM does print the animation option"), reappearing the moment slots
 *  became candidate keys, and this is the guard that closes the class rather than
 *  the instance.
 *
 *  Confined to the `sole` path deliberately. On the word-evidence path a label can
 *  legitimately belong to one key while the VALUE beside it belongs to another —
 *  measured on the `Return count:` pair, where the label comes from one key and the
 *  text from a second — and refusing that would lose a true fact. */
function labelBelongsToAnotherKey(step, key, text) {
  const option = splitOption(text);
  if (option.label === null) return false;
  const label = option.label.toLowerCase();
  return Object.keys(step).some(
    (other) =>
      other !== key &&
      !NON_DISPLAY_KEYS.has(other) &&
      labelCandidates(other).some((spelling) => spelling.toLowerCase() === label),
  );
}

const OPTION_LABEL = /^([A-Za-z][A-Za-z0-9 '/&.()-]{0,38}):\s*(.*)$/;
/** A display name FileMaker shows for a code: words, not calculation. */
const OPTION_PHRASE = /^[A-Za-z][A-Za-z0-9 '’&./()<>-]{0,39}$/;

/** A leftover stretch may hold more than one option (`Display content ; Never
 *  compress`). Cutting it on `;` is safe ONLY if every piece looks like an
 *  option and not like calculation — an unreported calc must stay in one piece,
 *  or a fragment of it could be attributed to a key and invent a fact.
 *
 *  A piece with unbalanced brackets is the giveaway that the cut fell inside a
 *  function call: `Choose ( n ; one ; two )` passes the wordlike test piece by
 *  piece but is one calculation. No such case is in the owner's data, so this
 *  guards the code rather than the measurement. */
function splitLeftover(gap) {
  if (!gap.text.includes(';')) return [gap];
  const pieces = [];
  let at = 0;
  for (const raw of gap.text.split(';')) {
    const text = raw.trim();
    const start = gap.start + at + (raw.length - raw.trimStart().length);
    at += raw.length + 1;
    if (text === '') continue;
    const labelled = OPTION_LABEL.exec(text);
    if (!labelled && !OPTION_PHRASE.test(text)) return [gap];
    if (!isBracketBalanced(text)) return [gap];
    pieces.push({ start, text });
  }
  return pieces.length > 0 ? pieces : [gap];
}

/** Does every `(` and `[` in this text close inside it? */
function isBracketBalanced(text) {
  const closes = { ')': '(', ']': '[' };
  const open = [];
  for (const character of text) {
    if (character === '(' || character === '[') open.push(character);
    else if (closes[character] && open.pop() !== closes[character]) return false;
  }
  return open.length === 0;
}

/** Turn a leftover option into a segment for `key`. */
function describeOption(gap, key, step) {
  const { label, value } = splitOption(gap.text);
  if (label !== null) {
    const verdict = classifyLabelled(value, step[key], step);
    return { key, render: verdict.render, label, value, ...presentationOf(verdict) };
  }
  if (MASK_PATTERN.test(gap.text)) return { key, render: 'masked', label: null, value: gap.text };
  // A bare STATE word is the boolean's value with no label at all
  // (`Allow User Abort [ Off ]`), which is a different fact from a `true` flag
  // printing its own name (`Select`): the state form renders in BOTH polarities,
  // so reading it as `bareWhenTrue` would make a renderer print nothing when the
  // flag is off. Checked before the `true` case, since `On` is neither this key's
  // name nor a display name for it.
  if (spellsState({ label: null, value: gap.text }, step[key])) {
    return { key, render: 'bareState', label: null, value: gap.text };
  }
  // A bare option for a boolean key IS that option's label (`Select`); for
  // anything else it is the display name of the value.
  if (step[key] === true) return { key, render: 'bareWhenTrue', label: gap.text, value: gap.text };
  return { key, render: 'enum', label: null, value: gap.text };
}

/** Does this bare option spell exactly this key's boolean value?
 *
 *  Both directions matter and only the matching one counts: `On` cannot be
 *  `false`. Getting the polarity wrong is worse than not placing the option,
 *  because the renderer would then print the opposite state. */
function spellsState(option, value) {
  if (option.label !== null || typeof value !== 'boolean') return false;
  const word = option.value.trim();
  return Object.hasOwn(STATE_WORDS, word) && STATE_WORDS[word] === value;
}

/** An option split into its label and what it shows; label null when bare. */
function splitOption(text) {
  const labelled = OPTION_LABEL.exec(text);
  return labelled
    ? { label: labelled[1].trim(), value: labelled[2].trim() }
    : { label: null, value: text };
}

/** Words worth comparing: lower case, at least three letters, plural folded. */
function wordsOf(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .map((word) => (word.endsWith('s') ? word.slice(0, -1) : word));
}

/** The words inside an enum code the CLI reports: `findNext` -> find, next. */
function valueWords(value) {
  if (typeof value !== 'string') return [];
  return wordsOf(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

function sharedWordCount(words, against) {
  if (words.length === 0 || against.length === 0) return 0;
  const other = new Set(against);
  return words.filter((word) => other.has(word)).length;
}

/** What is between the outer `[ ` and ` ]` of a rendered step line.
 *
 *  `null` when the step renders without a bracket (`End If`, and a comment,
 *  whose text follows the `#` with no bracket at all); `''` for empty brackets.
 *  The close is taken as the LAST `]` on the line, so a nested `[ ... ]` inside
 *  a calc and a trailing server/mobile marker (`] ➜🌍`) both survive. */
export function bracketContent(line, displayName) {
  if (typeof line !== 'string') return null;
  const name = String(displayName ?? '');
  let from = 0;
  if (name && line.toLowerCase().startsWith(name.toLowerCase())) {
    // A bracket belongs to the step only if it follows the display name.
    let at = name.length;
    while (at < line.length && line[at] === ' ') at += 1;
    if (line[at] !== '[') return null;
    from = at;
  }
  const open = line.indexOf('[', from);
  if (open === -1) return null;
  const close = line.lastIndexOf(']');
  if (close < open) return null;
  return line.slice(open + 1, close).trim();
}
