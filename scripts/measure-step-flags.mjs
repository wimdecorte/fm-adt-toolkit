#!/usr/bin/env node
/** Attribute the Claris ADT `fm` CLI's packed `flags` word PER STEP TYPE.
 *
 *  Every figure in `docs/fm-step-flags-reference.md` is printed by this script, and
 *  nothing in that document is stated anywhere else. Two commands reproduce it:
 *
 *      FMAI_ROUNDTRIP_ROWS=/tmp/rows.json npm run roundtrip:step-display
 *      node scripts/measure-step-flags.mjs /tmp/rows.json
 *
 *  The first is the existing round-trip, which pairs all 1203 committed steps with the
 *  line FileMaker's Script Workspace wrote for them and classifies each one; the env var
 *  only asks it to hand over its own rows instead of only summarising them. This script
 *  never re-implements that classification — a second copy of it would make these figures
 *  claims about different steps from the four counts in the backlog. It reads no script
 *  and opens no file; the data is `fm_scripts/`, committed (see fm_scripts/README.md).
 *
 *  **THE ROWS QUOTE THE OWNER'S OWN SCRIPT TEXT**, so write them outside the repo. This
 *  script prints no value of a masked key: the round-trip has already substituted the
 *  mask, and nothing here reads a step's values except through the guards below.
 *
 *  **THE UNIT OF A FACT IS `(step type, bit)`, NEVER A BIT ON ITS OWN.** A bit is a
 *  position in the step's own word. The same position means unrelated things on unrelated
 *  step types — this script prints how many, because a reader's first instinct is to build
 *  one global bit table and that table would be wrong. So a `(step type, bit)` attribution
 *  is NEVER rejected because the same bit means something else elsewhere.
 *
 *  Every other evidence rule is the one the rest of this catalog applies:
 *
 *   - RECURRENCE   — more than one example inside that step type; one example is `low`.
 *   - INJECTIVITY  — inside a step type, no two bits for one option and no two options
 *     for one bit. The two POLARITIES of one option are one fact, not two.
 *   - GUARD (a)    — the text must not be derivable from data the CLI already sends BY
 *     NAME. A bit that mirrors a key we already read is not a new source: it is recorded
 *     as redundant, and a consumer should prefer the key.
 *   - GUARD (b)    — no reported key's presence, and no reported key's value, may predict
 *     the same split.
 *
 *  Both guards exist because an automated bit search finds coincidences: an earlier pass
 *  credited a `Set Error Logging` option to a bit when the whole difference was one
 *  letter's case in a value the CLI does send, and credited `Filters` to a key when none
 *  of the 15 steps carrying that key prints `Filters`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'src', 'catalogs', 'fm-step-display.json');
const ROWS_PATH = process.argv[2] ?? process.env.FMAI_ROUNDTRIP_ROWS;

if (!ROWS_PATH) {
  console.error(
    'usage: node scripts/measure-step-flags.mjs <rows.json>\n\n' +
      'Produce <rows.json> first, outside the repo, because it quotes the owner\'s script text:\n' +
      '  FMAI_ROUNDTRIP_ROWS=/tmp/rows.json npm run roundtrip:step-display',
  );
  process.exit(2);
}
if (!fs.existsSync(ROWS_PATH)) {
  console.error(
    `${ROWS_PATH} does not exist. Produce it with:\n` +
      `  FMAI_ROUNDTRIP_ROWS=${ROWS_PATH} npm run roundtrip:step-display`,
  );
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(ROWS_PATH, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Reading a rendered line
// ---------------------------------------------------------------------------

/** The options of `Name [ a ; b ; c ]`, split at top-level `;` only — a calculation
 *  carries its own semicolons, brackets and quotes. */
function optionsOf(line) {
  if (!line) return [];
  const open = line.indexOf('[');
  const close = line.lastIndexOf(']');
  if (open === -1 || close < open) return [];
  const body = line.slice(open + 1, close);
  const out = [];
  let depth = 0;
  let quote = null;
  let piece = '';
  for (const ch of body) {
    if (quote) { piece += ch; if (ch === quote) quote = null; continue; }
    if (ch === '“') { quote = '”'; piece += ch; continue; }
    if (ch === '"') { quote = '"'; piece += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ';' && depth <= 0) { out.push(piece.trim()); piece = ''; continue; }
    piece += ch;
  }
  out.push(piece.trim());
  return out.filter((item) => item.length > 0);
}

/** `Label` of `Label: value`, or null for an option that carries no label. */
const labelOf = (text) => {
  const at = text.indexOf(': ');
  if (at > 0 && /^[A-Za-z][A-Za-z0-9 '/&.()-]*$/.test(text.slice(0, at))) return text.slice(0, at);
  return null;
};

/** The same boundary `OWNER_CONTENT` draws in scripts/derive-step-display.mjs, applied
 *  here for two purposes at once: a number cannot hold a name, a path, a calculation or
 *  a quoted value, so a text carrying one is not a thing a bit can supply; and this
 *  document is general reference, so none of the owner's content may reach it. */
const OWNER_CONTENT = /[$•“”"]|::|\/\//;
const isFixedWording = (text) => {
  if (OWNER_CONTENT.test(text)) return false;
  if (!/^[A-Za-z<]/.test(text)) return false;
  if (!/^[A-Za-z0-9 ()',/&.:<>_-]+$/.test(text)) return false;
  if (/\d{2,}/.test(text)) return false;
  // `Delay: 1/2` is a value under a label, not wording: the label is FileMaker's and the
  // text after it is the step's own data, which no bit supplies.
  const label = labelOf(text);
  if (label !== null && /^[\d\s/.,:-]+$/.test(text.slice(label.length + 2))) return false;
  return true;
};

const norm = (value) => String(value).replace(/\s+/g, ' ').trim().toLowerCase();
const hex = (bit) => `0x${(bit >>> 0).toString(16).toUpperCase()}`;

/** Every string the CLI reports for a step, at any depth. Values are compared, never
 *  printed. */
function reportedStrings(step) {
  const out = new Set();
  const walk = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') { for (const item of Object.values(value)) walk(item); return; }
    out.add(norm(value));
  };
  for (const [key, value] of Object.entries(step)) {
    if (['stepID', 'step', 'uuid', 'flags'].includes(key)) continue;
    walk(value);
  }
  return out;
}

/** Which catalog segment produced this option text, when the key behind it is one the
 *  CLI actually reports on this step. That is the sharpest form of guard (a): our own
 *  renderer, reading named keys and named slots only, already writes this option. */
const producedFromNamedKey = (row, text) => {
  for (const [id, value] of Object.entries(row.optionTexts ?? {})) {
    if (value !== text) continue;
    if (row.keys.includes(id)) return id;
    const slot = id.startsWith('slots.') ? `@slot:${id.slice(6).split('.').join(':')}` : null;
    if (slot && row.keys.includes(slot)) return id;
  }
  return null;
};

/** `opaque`, `editable` and `reason` are the CLI's own metadata about a step it could not
 *  read — its way of SAYING SO, not an option the step carries. They are present on
 *  exactly the unreadable steps, so leaving them in the guards makes them predict every
 *  option FileMaker prints on an unreadable step, and the guard then credits the CLI with
 *  sending data it explicitly says it could not read. Measured: with them left in, the
 *  `Filters` attribution on `Insert File` is thrown away as redundant with `reason`. */
const METADATA = ['opaque', 'editable', 'reason'];

// ---------------------------------------------------------------------------
// Stage 1 — every perfect predictor inside a step type, then the guards
// ---------------------------------------------------------------------------

const byType = new Map();
for (const row of rows) {
  if (!byType.has(row.step)) byType.set(row.step, []);
  byType.get(row.step).push(row);
}

const census = { raw: 0, fixedWording: [], notFixedWording: 0, shipped: [], redundant: [], presenceOnly: [], survived: [], narrowed: [] };

for (const [type, examples] of byType) {
  const entry = catalog[type];
  const flagsOf = (row) => row.json.flags ?? 0;
  const fmOptions = new Map(examples.map((row) => [row, optionsOf(row.fmCompared)]));
  const texts = [...new Set(examples.flatMap((row) => fmOptions.get(row)))];
  const keys = [...new Set(examples.flatMap((row) => row.keys))].filter((key) => !METADATA.includes(key));

  // Two conditions a bit is tested under: unconditionally, and inside the subset of
  // examples where one reported key is ABSENT. The second is the shape
  // `whenAbsent.flagBit` already ships, and the only shape available on a step whose
  // keys are all absent.
  const conditions = [{ id: 'always', subset: examples }];
  for (const key of keys) {
    const subset = examples.filter((row) => !row.keys.includes(key));
    if (subset.length === 0 || subset.length === examples.length) continue;
    conditions.push({ id: `absent:${key}`, key, subset });
  }

  // ONE claim per (bit, text, polarity): `always` if it holds, else the widest subset it
  // holds in. Without this a claim is counted once per absent key whose subset happens to
  // contain its examples.
  const found = new Map();
  for (const condition of conditions) {
    const scope = condition.subset;
    for (let k = 0; k < 32; k++) {
      const bit = 2 ** k;
      const set = scope.filter((row) => (flagsOf(row) & bit) !== 0);
      const clear = scope.filter((row) => (flagsOf(row) & bit) === 0);
      if (set.length === 0 || clear.length === 0) continue;
      for (const text of texts) {
        const carry = scope.filter((row) => fmOptions.get(row).includes(text));
        if (carry.length === 0) continue;
        const polarity =
          carry.length === set.length && carry.every((row) => (flagsOf(row) & bit) !== 0) ? 'set'
            : carry.length === clear.length && carry.every((row) => (flagsOf(row) & bit) === 0) ? 'clear'
              : null;
        if (!polarity) continue;
        census.raw += 1;
        const id = `${bit}|${text}|${polarity}`;
        const claim = {
          type, bit, text, polarity, condition: condition.id, key: condition.key ?? null,
          label: labelOf(text), carries: carry.length, doesNot: scope.length - carry.length,
          scope: scope.length, typeExamples: examples.length, carriers: carry,
        };
        const held = found.get(id);
        const wider =
          !held ||
          (held.condition !== 'always' && claim.condition === 'always') ||
          (held.condition !== 'always' && claim.condition !== 'always' && claim.scope > held.scope);
        if (wider) found.set(id, claim);
      }
    }
  }

  for (const claim of found.values()) {
    if (!isFixedWording(claim.text)) { census.notFixedWording += 1; continue; }
    census.fixedWording.push(claim);

    // Already read by the catalog for this step type, on this bit.
    const shipped = (entry?.segments ?? []).find(
      (segment) => segment.whenAbsent?.flagBit === claim.bit && segment.whenAbsent.text === claim.text,
    );
    if (shipped) { census.shipped.push({ ...claim, shippedKey: shipped.key }); continue; }

    // GUARD (a)
    const named = claim.carriers.map((row) => producedFromNamedKey(row, claim.text)).find((id) => id);
    const asValue = claim.carriers.every((row) =>
      reportedStrings(row.json).has(norm(claim.text.replace(/^[^:]+: /, ''))));
    if (named || asValue) {
      census.redundant.push({ ...claim, why: named
        ? `the key ${JSON.stringify(named)}, which the catalog already renders as this option`
        : 'the CLI sends this very text as a value' });
      continue;
    }
    if (claim.key && examples.some((row) => row.keys.includes(claim.key) && fmOptions.get(row).includes(claim.text))) {
      census.redundant.push({ ...claim, why: `the key ${JSON.stringify(claim.key)} prints this text where it is reported` });
      continue;
    }

    // GUARD (b)
    const scope = conditions.find((condition) => condition.id === claim.condition).subset;
    let predicts = null;
    for (const key of keys) {
      if (key === claim.key) continue;
      const present = scope.filter((row) => row.keys.includes(key));
      if (present.length === claim.carries && present.every((row) => claim.carriers.includes(row))) {
        predicts = { key, how: 'presence' };
        break;
      }
    }
    if (!predicts) {
      for (const key of keys) {
        if (key.startsWith('@slot:') || key === claim.key) continue;
        // The key must be REPORTED throughout the scope. Otherwise "absent" enters as a
        // pseudo-value trivially disjoint from every real one, and the test fires on any
        // option appearing only where the key is missing — a question about the key's
        // PRESENCE, which the test above already answers properly.
        if (!scope.every((row) => row.keys.includes(key))) continue;
        const valueOf = (row) => norm(JSON.stringify(row.json[key]));
        const inValues = new Set(claim.carriers.map(valueOf));
        const outValues = new Set(scope.filter((row) => !claim.carriers.includes(row)).map(valueOf));
        if (inValues.size > 0 && [...inValues].every((value) => !outValues.has(value))) {
          predicts = { key, how: 'value' };
          break;
        }
      }
    }
    if (predicts) {
      census.redundant.push({ ...claim, why: `the ${predicts.how} of the key ${JSON.stringify(predicts.key)}` });
      continue;
    }
    census.survived.push(claim);
  }

  // PRESENCE ONLY — the bit predicts that an option with this LABEL appears, and the
  // text under that label is something no number can hold. Not creditable as a fact:
  // it says an option is there without saying what it says.
  for (let k = 0; k < 32; k++) {
    const bit = 2 ** k;
    const set = examples.filter((row) => (flagsOf(row) & bit) !== 0);
    const clear = examples.filter((row) => (flagsOf(row) & bit) === 0);
    if (set.length === 0 || clear.length === 0) continue;
    const labels = new Set(texts.map(labelOf).filter((label) => label !== null));
    for (const label of labels) {
      const under = texts.filter((text) => labelOf(text) === label);
      if (under.every(isFixedWording)) continue;
      const carry = examples.filter((row) => fmOptions.get(row).some((text) => labelOf(text) === label));
      const polarity =
        carry.length === set.length && carry.every((row) => (flagsOf(row) & bit) !== 0) ? 'set'
          : carry.length === clear.length && carry.every((row) => (flagsOf(row) & bit) === 0) ? 'clear'
            : null;
      if (!polarity || carry.length < 2) continue;
      // The same two guards, in the form that applies to a presence claim: our renderer
      // must not already write the option from a named key, and no reported key's
      // presence may predict the same split.
      if (carry.some((row) => producedFromNamedKey(row, fmOptions.get(row).find((text) => labelOf(text) === label)))) continue;
      const byKey = keys.find((key) => {
        const present = examples.filter((row) => row.keys.includes(key));
        return present.length === carry.length && present.every((row) => carry.includes(row));
      });
      if (byKey) continue;
      census.presenceOnly.push({ type, bit, label, polarity, carries: carry.length, of: examples.length, forms: under.length });
    }
  }
}

// One claim per (step type, text, polarity): the WIDEST scope it holds in. A bit that
// predicts a text only inside the subset where some key is absent is not independent
// evidence against a bit that predicts it across the whole step type — it is the same
// observation under a narrower lens, and counting both makes two rival claims out of one.
{
  const widest = new Map();
  for (const claim of census.survived) {
    const id = `${claim.type}|${claim.text}|${claim.polarity}`;
    widest.set(id, Math.max(widest.get(id) ?? 0, claim.scope));
  }
  const at = (claim) => claim.scope === widest.get(`${claim.type}|${claim.text}|${claim.polarity}`);
  census.narrowed = census.survived.filter((claim) => !at(claim));
  census.survived = census.survived.filter(at);
}

// ---------------------------------------------------------------------------
// Stage 2 — injectivity, inside each step type
// ---------------------------------------------------------------------------

const facts = [];
const dropped = [];
for (const [type] of byType) {
  const mine = census.survived.filter((claim) => claim.type === type);
  const groups = new Map();
  for (const claim of mine) {
    const id = `${claim.bit}|${claim.condition}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(claim);
  }
  /** The option a group of claims is about. One claim: its label, or its text where it
   *  carries none. Two claims of opposite polarity: the label they share, or the two bare
   *  state words as one identity (`Off/On`). Unlabelled options must NOT collapse into
   *  one — `Automatically open` and `Create email` are two options, not two states. */
  const optionOf = (list) => {
    const labels = new Set(list.map((claim) => claim.label).filter((label) => label !== null));
    if (labels.size > 1) return null;
    if (labels.size === 1 && list.every((claim) => claim.label !== null)) return [...labels][0];
    if (list.length === 1) return list[0].text;
    return list.map((claim) => claim.text).sort().join('/');
  };
  const claims = new Map();
  const claim = (option, bit) => {
    if (!claims.has(option)) claims.set(option, new Set());
    claims.get(option).add(bit);
  };
  for (const item of census.shipped.filter((one) => one.type === type)) {
    claim(item.label ?? item.text, item.bit);
    claim(item.text, item.bit);
  }
  for (const [, list] of groups) {
    const option = optionOf(list);
    if (option === null) continue;
    claim(option, list[0].bit);
    for (const one of list) claim(one.text, list[0].bit);
  }
  for (const [, list] of groups) {
    const option = optionOf(list);
    const texts = list.map((one) => one.text);
    const note = { type, bit: list[0].bit, condition: list[0].condition, texts };
    if (option === null) { dropped.push({ ...note, why: 'one bit, two unrelated options' }); continue; }
    if (new Set(list.map((one) => one.polarity)).size !== list.length) {
      dropped.push({ ...note, why: 'two texts in one polarity' });
      continue;
    }
    const rivals = Math.max(
      claims.get(option).size,
      ...list.map((one) => claims.get(one.text)?.size ?? 0),
    );
    if (rivals > 1) { dropped.push({ ...note, why: `${rivals} bits claim the option` }); continue; }
    const single = list.some((one) => one.carries < 2);
    facts.push({
      type, bit: list[0].bit, condition: list[0].condition, option,
      states: Object.fromEntries(list.map((one) => [one.polarity, one.text])),
      evidence: Object.fromEntries(list.map((one) => [one.polarity, { carries: one.carries, of: one.scope }])),
      typeExamples: list[0].typeExamples,
      confidence: single ? 'low' : 'measured',
      doubts: single ? ['singleExample'] : [],
    });
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — payoff, against the round-trip's own buckets
// ---------------------------------------------------------------------------

const factsByType = new Map();
for (const fact of facts) {
  if (!factsByType.has(fact.type)) factsByType.set(fact.type, []);
  factsByType.get(fact.type).push(fact);
}
function supplies(row, pool) {
  const out = new Set();
  for (const fact of factsByType.get(row.step) ?? []) {
    if (!pool.includes(fact)) continue;
    if (fact.condition !== 'always' && row.keys.includes(fact.condition.slice('absent:'.length))) continue;
    const state = ((row.json.flags ?? 0) & fact.bit) !== 0 ? 'set' : 'clear';
    if (fact.states[state]) out.add(fact.states[state]);
  }
  return out;
}
/** RESOLVED means: every option FileMaker prints that we print nothing for is supplied by
 *  a `(step type, bit)` fact, AND we print nothing FileMaker does not — so the option SET
 *  agrees. It does not promise the finished line matches, which also needs the option
 *  ORDER right; `orderKnown` counts where it already does. */
function payoff(bucket, pool) {
  const out = { touched: 0, resolved: 0, ordered: 0, resolvedBy: new Map(), stuckBy: new Map() };
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const row of bucket) {
    const fm = optionsOf(row.fmCompared);
    const ours = optionsOf(row.ours);
    const missing = fm.filter((option) => !ours.includes(option));
    const extra = ours.filter((option) => !fm.includes(option));
    const supplied = supplies(row, pool);
    const hit = missing.filter((option) => supplied.has(option));
    if (hit.length > 0) out.touched += 1;
    if (missing.length > 0 && hit.length === missing.length && extra.length === 0) {
      out.resolved += 1;
      bump(out.resolvedBy, row.step);
      // Would the finished line come out right? Only if the options we already print sit
      // in FileMaker's own order among themselves.
      const positions = ours.map((option) => fm.indexOf(option));
      if (positions.every((at, index) => index === 0 || at > positions[index - 1])) out.ordered += 1;
    } else if (hit.length > 0) {
      bump(out.stuckBy, row.step);
    }
  }
  return out;
}

const buckets = {
  'still different': rows.filter((row) => row.verdict === 'mismatch'),
  'FileMaker shows what the CLI never sends (the 26)': rows.filter((row) => row.cause === 'unreported' && row.verdict === 'unrenderable'),
  'the CLI cannot read the step (the 81)': rows.filter((row) => row.cause === 'opaque'),
};
const measuredOnly = facts.filter((fact) => fact.confidence === 'measured');

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const say = (text = '') => console.log(text);
const pad = (value, width) => String(value).padStart(width);

say(`== the corpus ==`);
say(`  paired steps ${rows.length}   step types ${byType.size}`);
say(`  steps reporting a flags value: ${rows.filter((row) => row.json.flags !== undefined).length}` +
  `   reporting none: ${rows.filter((row) => row.json.flags === undefined).length}`);
say(`  steps the CLI reports as disabled: ${rows.filter((row) => row.json.disabled !== undefined).length}` +
  `  <- so this corpus can neither confirm nor contradict that \`disabled\` is absent from flags`);
for (const [name, bucket] of Object.entries(buckets)) say(`  ${name}: ${bucket.length}`);
say();

say('== why a global bit table is the wrong shape ==');
say('   distinct (step type, option) claims per bit, among perfect predictors whose text is');
say("   FileMaker's own fixed wording. One position, many unrelated meanings.");
const perBit = new Map();
for (const claim of census.fixedWording) {
  if (!perBit.has(claim.bit)) perBit.set(claim.bit, new Set());
  perBit.get(claim.bit).add(`${claim.type} :: ${claim.label ?? claim.text}`);
}
for (const [bit, claimed] of [...perBit.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 10)) {
  say(`  ${hex(bit).padEnd(12)} ${pad(claimed.size, 3)} claims`);
}
say();

say('== the funnel ==');
say(`  perfect predictors inside a step type            ${pad(census.raw, 5)}`);
say(`  one claim per (bit, text, polarity)              ${pad(census.fixedWording.length + census.notFixedWording, 5)}`);
say(`    text is not FileMaker's own fixed wording      ${pad(census.notFixedWording, 5)}  <- a number holds no name, path or calculation`);
say(`    already read by the catalog today              ${pad(census.shipped.length, 5)}`);
say(`    redundant with data the CLI sends by name      ${pad(census.redundant.length, 5)}`);
say(`    same text, narrower scope than another claim   ${pad(census.narrowed.length, 5)}`);
say(`    survive both guards                            ${pad(census.survived.length, 5)}`);
say(`  dropped for injectivity                          ${pad(dropped.length, 5)}`);
say(`  FACTS (step type, bit)                           ${pad(facts.length, 5)}   measured ${measuredOnly.length}  low ${facts.length - measuredOnly.length}`);
say();

say('== the facts, keyed by step type ==');
for (const fact of [...facts].sort((a, b) => a.type.localeCompare(b.type) || a.bit - b.bit)) {
  const states = Object.entries(fact.states)
    .map(([polarity, text]) => `${polarity} -> ${JSON.stringify(text)} (${fact.evidence[polarity].carries} of ${fact.evidence[polarity].of})`)
    .join('   ');
  say(`  ${fact.type} | ${hex(fact.bit)} | ${fact.condition} | ${fact.confidence}${fact.doubts.length ? ` (${fact.doubts.join('+')})` : ''}`);
  say(`      ${states}   step type has ${fact.typeExamples} examples`);
}
say();

say('== already read by the catalog (recovered by this search, so the method finds a known fact) ==');
for (const item of census.shipped) {
  say(`  ${item.type} | ${hex(item.bit)} | when the key ${JSON.stringify(item.shippedKey)} is absent | ${item.carries} of ${item.scope}`);
}
say();

say('== presence only: the bit says an option is THERE, not what it says ==');
for (const item of census.presenceOnly) {
  say(`  ${item.type} | ${hex(item.bit)} ${item.polarity} | the ${JSON.stringify(item.label)} option | ${item.carries} of ${item.of} | ${item.forms} different texts under that label`);
}
say();

say('== redundant with data the CLI already sends by name, grouped ==');
const redundantGroups = new Map();
for (const item of census.redundant) {
  const id = `${hex(item.bit)}|${item.label ?? item.text}|${item.why}`;
  if (!redundantGroups.has(id)) redundantGroups.set(id, []);
  redundantGroups.get(id).push(item);
}
// `FMAI_FLAGS_TOP=all` prints every group; the default keeps the output readable.
const top = process.env.FMAI_FLAGS_TOP === 'all' ? redundantGroups.size : Number(process.env.FMAI_FLAGS_TOP ?? 20);
for (const [, list] of [...redundantGroups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, top)) {
  const item = list[0];
  const types = new Set(list.map((one) => one.type));
  say(`  ${hex(item.bit).padEnd(12)} ${JSON.stringify(item.label ?? item.text)} — ${list.length} claim(s) on ${types.size} step type(s), redundant with ${item.why}`);
}
say(`  (${redundantGroups.size} groups in all, ${census.redundant.length} claims, ` +
  `${new Set(census.redundant.map((item) => `${item.type}|${item.bit}`)).size} distinct (step type, bit) pairs)`);
say();

say('== one position, step type by step type ==');
say('   The whole argument against a global bit table, spelled out for two positions: the');
say("   one the brief's Restore example rests on, and the one an earlier pass named as the");
say('   sole predictor of eight unrelated options.');
const verdictOf = new Map();
for (const item of census.shipped) verdictOf.set(`${item.type}|${item.bit}|${item.text}`, 'already read by the catalog');
for (const item of census.redundant) verdictOf.set(`${item.type}|${item.bit}|${item.text}`, `redundant with ${item.why}`);
for (const item of census.narrowed) verdictOf.set(`${item.type}|${item.bit}|${item.text}`, 'the same text is claimed at a wider scope');
for (const fact of facts) {
  for (const text of Object.values(fact.states)) verdictOf.set(`${fact.type}|${fact.bit}|${text}`, `ATTRIBUTED (${fact.confidence})`);
}
for (const item of dropped) {
  for (const text of item.texts) verdictOf.set(`${item.type}|${item.bit}|${text}`, `dropped — ${item.why}`);
}
for (const bit of [0x2000000, 0x100]) {
  say(`  ${hex(bit)}`);
  const mine = census.fixedWording.filter((claim) => claim.bit === bit);
  for (const claim of mine.sort((a, b) => a.type.localeCompare(b.type))) {
    say(`    ${claim.type.padEnd(30)} ${claim.polarity.padEnd(6)} ${JSON.stringify(claim.text).padEnd(26)}` +
      ` ${pad(claim.carries, 3)} of ${pad(claim.scope, 3)}   ${verdictOf.get(`${claim.type}|${bit}|${claim.text}`) ?? 'not credited'}`);
  }
  const presence = census.presenceOnly.filter((item) => item.bit === bit);
  for (const item of presence) {
    say(`    ${item.type.padEnd(30)} ${item.polarity.padEnd(6)} ${JSON.stringify(`${item.label}: …`).padEnd(26)}` +
      ` ${pad(item.carries, 3)} of ${pad(item.of, 3)}   presence only — ${item.forms} form(s) of text under that label`);
  }
}
say();

say('== dropped for injectivity ==');
for (const item of dropped) {
  say(`  ${item.type} | ${hex(item.bit)} | ${item.condition} | ${JSON.stringify(item.texts)} | ${item.why}`);
}
say();

say('== payoff ==');
for (const [name, bucket] of Object.entries(buckets)) {
  const all = payoff(bucket, facts);
  const strict = payoff(bucket, measuredOnly);
  say(`  ${name}`);
  say(`      all facts:      touched ${all.touched}   option set complete ${all.resolved}   of which the order already agrees ${all.ordered}`);
  say(`      measured only:  touched ${strict.touched}   option set complete ${strict.resolved}   of which the order already agrees ${strict.ordered}`);
  for (const [step, count] of all.resolvedBy) say(`      complete:   ${step} ${count}`);
  for (const [step, count] of all.stuckBy) say(`      gains an option and stays incomplete:   ${step} ${count}`);
}
say();

say('== what flags demonstrably does NOT carry ==');
say('   (step type, flags value) groups where ONE value of the number goes with more than');
say('   one FileMaker line. No reading of the number can tell those lines apart.');
const groups = new Map();
for (const row of rows) {
  const id = `${row.step}|${row.json.flags ?? 0}`;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(row);
}
const collisions = [...groups.entries()]
  .map(([id, list]) => ({ id, step: list[0].step, steps: list.length, lines: new Set(list.map((row) => row.fmCompared)).size }))
  .filter((item) => item.lines > 1)
  .sort((a, b) => b.lines - a.lines);
say(`  groups: ${collisions.length}`);
for (const item of collisions.slice(0, 10)) {
  say(`  ${item.step.padEnd(34)} ${pad(item.steps, 3)} steps, ${pad(item.lines, 3)} different lines`);
}
say();
say('   The three named in the reference document, because what differs inside each group is');
say('   the KIND of thing a number cannot hold — a text encoding, an import action, a name.');
for (const step of ['Export Records', 'Import Records', 'Add Account']) {
  for (const item of collisions.filter((one) => one.step === step)) {
    say(`  ${item.step.padEnd(20)} one flags value, ${pad(item.steps, 3)} steps, ${pad(item.lines, 3)} different lines`);
  }
}
