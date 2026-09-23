import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import catalogData from '../src/catalogs/fm-step-display.json' with { type: 'json' };
import {
  ARTEFACT_KEYS,
  oneLine,
  renderStepFromCatalog,
  segmentID,
  stepConventions,
  STEP_MASK,
} from '../src/step-display/step-display-render.ts';
import type { StepDisplayCatalog, StepSlotRef } from '../src/step-display/step-display-types.ts';
import type { ScriptDetailStep } from '../src/types.ts';
import { alignSteps, DISPLAY_NAME_OVERRIDES, oneLine as alignOneLine } from '../scripts/fm-script-align.mjs';

/** A GUARD over the round-trip, not a second copy of it.
 *
 *  `scripts/roundtrip-step-display.mjs` is the measurement: it renders all 1203 paired
 *  examples through `renderStepFromCatalog` — the same function the read sheet uses —
 *  applies the two normalisations the design spec names and the two the repo owner ruled,
 *  and reports FOUR counts against one denominator: 917 exact, 84 settled by his rulings,
 *  94 still different, 108 not writable from what the CLI sends. It also writes the HTML
 *  report he reads and fills in each entry's `verified`.
 *
 *  This file exists so that a change to the renderer or the catalog which BREAKS what has
 *  already been measured fails `npm test`, without waiting for someone to run the script
 *  by hand. So it asserts one deliberately conservative floor and no normalisations at
 *  all:
 *
 *  > at least 886 of the 1203 lines are BYTE-IDENTICAL to the text FileMaker's own Script
 *  > Workspace wrote for the same step.
 *
 *  886 is measured (the round-trip's `byteIdentical` figure at the commit that last moved it;
 *  it was 894 when this file was written and 913 before the baseline landed — see
 *  `BYTE_IDENTICAL_FLOOR` for why that number FELL and what it bought).
 *
 *  Nothing here strips the `➜🌍` marker, matches a truncated line by its prefix or
 *  normalises the spacing round a colon, so those rows are simply not counted — a floor
 *  under a floor. Re-implementing the normalisations here is exactly the duplication that
 *  makes a number a claim about the wrong code, and a normalisation applied to one side
 *  only can move rows toward matching, which has happened in this project before.
 *
 *  IT DOES NOT ASSERT A 100% MATCH, and it must not: 94 rows still differ and 108 cannot
 *  be written from what the CLI sends. The spec forbids one blended accuracy figure, and
 *  a test asserting perfection would have to be loosened to stay green, which is how a
 *  measurement stops measuring.
 *
 *  IT ALSO DOES NOT SKIP. Both halves of all 1203 pairs are committed in `fm_scripts/`, so
 *  these run wherever the repo does; a missing file fails loudly (`readCommitted`). While the
 *  CLI's half lived in `/tmp` these four assertions were `skipIf`d away on any machine but
 *  one, which is the state the owner committed the data to end.
 */

const CATALOG = catalogData as unknown as StepDisplayCatalog;
const CONVENTIONS = stepConventions(CATALOG);
const MASKED_KEYS = CONVENTIONS.maskedKeys;
const ROOT = path.resolve(__dirname, '..');

/** Both halves of every pair, COMMITTED — the CLI's `read:script` output as `<stem>.adt.json`
 *  and FileMaker's own rendered text as `<stem>.txt`. Read-only, and the same files the
 *  derivation and the round-trip read: the owner's FileMaker file is never opened, here or
 *  anywhere in the suite. See fm_scripts/README.md. */
const SOURCES = [
  {
    id: 70,
    body: 'fm_scripts/20260625_missing.adt.json',
    text: 'fm_scripts/20260625_missing.txt',
  },
  {
    id: 55,
    body: 'fm_scripts/All script steps and all options 20260318.adt.json',
    text: 'fm_scripts/All script steps and all options 20260318.txt',
  },
];

/** Measured with `scripts/roundtrip-step-display.mjs`: of 1203 paired examples, this many
 *  render byte-identically to FileMaker's line before any normalisation. A drop is a
 *  regression; a rise means the floor can be raised.
 *
 *  **IT WAS LOWERED ONCE, FROM 913, AND THAT IS THE ONE DIRECTION THAT NEEDS A REASON.** The
 *  renderer stopped suppressing values it holds: 104 values the CLI sends and the catalog
 *  could not confidently place now print, and on 30 of these lines FileMaker prints no such
 *  option, so 30 rows left the exact column for the owner's own — his ruling: "any
 *  weAddAnOption is not a problem, FM does not always show all configured options so if we
 *  do then that is fine." No row got WORSE at showing what the CLI sent; the round-trip
 *  reports the movement as `accepted` rather than as `mismatch`, and its four counts are
 *  where that trade is visible. A drop with no such account behind it is a regression. */
const BYTE_IDENTICAL_FLOOR = 886;
const PAIRED_EXAMPLES = 1203;

/** A committed file, or a LOUD failure naming what is missing.
 *
 *  **THE FOUR ASSERTIONS BELOW MUST NEVER SKIP.** They were `describe.skipIf`d while the CLI's
 *  half of the data lived in `/tmp` — so the match floor, the planted-password mask check, the
 *  `slots` partition and the zero-appended-keys check were all conditional on one machine's
 *  state, and silently inert everywhere else. A silent skip is what let that stand for two
 *  rounds. Now the data is committed, so a missing file is an incomplete checkout and this says
 *  so rather than quietly passing. */
function readCommitted(relative: string): string {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    throw new Error(
      `${relative} is missing, and it is COMMITTED data rather than a cache: restore it with ` +
        '`git checkout fm_scripts`. This assertion is not allowed to skip — it is one of the four ' +
        'that measure the catalog against FileMaker\'s own text, and the reason the data was ' +
        'committed at all is that they stop being inert off the owner\'s machine. Nothing here ' +
        'regenerates it and nothing invokes the fm CLI; see fm_scripts/README.md.',
    );
  }
  return fs.readFileSync(file, 'utf8');
}

function readBody(relative: string): ScriptDetailStep[] {
  return JSON.parse(readCommitted(relative)) as ScriptDetailStep[];
}

interface Row {
  script: number;
  step: string;
  fm: string;
  ours: string | null;
}

/** Pair every step with FileMaker's line and render it, exactly as the round-trip does —
 *  including its three reasons for declining to render at all, in the same order, so this
 *  guard and that measurement are counting the same population. */
function readRows(): Row[] {
  const rows: Row[] = [];
  for (const source of SOURCES) {
    const body = readBody(source.body);
    const lines = readCommitted(source.text).split('\n');
    if (lines.at(-1) === '') lines.pop();
    const aligned = alignSteps(body, lines, (name: string) => DISPLAY_NAME_OVERRIDES[name] ?? name);
    let cursor = 0;
    for (const pair of aligned.pairs as Array<{ index: number; step: ScriptDetailStep }>) {
      const step = pair.step;
      // A comment's text can hold returns, and each one takes a line of its own.
      const span =
        step.step === '#' && typeof step.text === 'string'
          ? 1 + (step.text.match(/[\r\n]/g) ?? []).length
          : 1;
      const fm = lines
        .slice(cursor, cursor + span)
        .map((line) => line.slice(line.match(/^\t*/)?.[0].length ?? 0))
        .join('\n');
      cursor += span;
      const entry = CATALOG[step.step];
      const blocked =
        entry === undefined || Object.hasOwn(step, 'opaque') || entry.displayNameUnverifiable;
      rows.push({
        script: source.id,
        step: step.step,
        fm,
        ours: blocked ? null : renderStepFromCatalog(step, entry, CONVENTIONS).line,
      });
    }
  }
  return rows;
}

describe('the catalog renderer against FileMaker’s own text', () => {
  it('has both halves of every pair committed, so nothing below can skip', () => {
    // First, and deliberately its own case: if this fails, the four assertions after it fail
    // for a reason a reader can act on instead of erroring deep inside a comparison.
    for (const source of SOURCES) {
      expect(readCommitted(source.body).length).toBeGreaterThan(0);
      expect(readCommitted(source.text).length).toBeGreaterThan(0);
    }
  });

  it(`reproduces at least ${BYTE_IDENTICAL_FLOOR} of ${PAIRED_EXAMPLES} lines byte for byte`, () => {
    const rows = readRows();
    const identical = rows.filter((row) => row.ours !== null && row.ours === row.fm);
    const differing = rows.filter((row) => row.ours !== null && row.ours !== row.fm);
    const unrendered = rows.filter((row) => row.ours === null);

    // A summary, because the number alone does not say where the remainder is. Step type
    // names are FileMaker's own vocabulary; no value, calculation or name out of the
    // owner's scripts is printed here or committed anywhere in this file.
    const byStep = new Map<string, number>();
    for (const row of differing) byStep.set(row.step, (byStep.get(row.step) ?? 0) + 1);
    const worst = [...byStep.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(
      [
        `step display catalog: ${rows.length} paired examples`,
        `  byte-identical to FileMaker: ${identical.length}`,
        `  differing (some settled by the owner's rulings, or by a normalisation the`,
        `    round-trip applies and this guard does not): ${differing.length}`,
        `  not rendered at all (no catalog entry, opaque, or a plugin's own name): ${unrendered.length}`,
        `  step types differing most: ${worst.map(([name, count]) => `${name} (${count})`).join(', ')}`,
        '  the four measured counts are in scripts/roundtrip-step-display.mjs; run it for the report',
      ].join('\n'),
    );

    expect(rows.length).toBe(PAIRED_EXAMPLES);
    expect(identical.length).toBeGreaterThanOrEqual(BYTE_IDENTICAL_FLOOR);
  });

  it('prints no masked value anywhere in the corpus', () => {
    // The round-trip asserts this of its report's data; this asserts it of the rendered
    // LINE, which is what the read sheet shows. Every masked key in this corpus holds a
    // `$variable` rather than a literal, so the test substitutes a literal of its own and
    // renders again: a renderer that printed the value would print this one.
    const literal = 'Nc9-literal-password-Nc9';
    let planted = 0;
    let masked = 0;
    for (const source of SOURCES) {
      const body = readBody(source.body);
      for (const step of body) {
        const entry = CATALOG[step.step];
        if (entry === undefined) continue;
        const present = [...MASKED_KEYS].filter((key) => Object.hasOwn(step, key));
        if (present.length === 0) continue;
        const withLiteral: ScriptDetailStep = { ...step };
        for (const key of present) withLiteral[key] = literal;
        const line = renderStepFromCatalog(withLiteral, entry, CONVENTIONS).line;
        planted += 1;
        // Two acceptable outcomes and they are not the same one: FileMaker prints the mask,
        // or it prints no such option at all — measured on `Add Account`, where an external
        // account type hides the password option outright. Only the literal is a failure.
        if (line.includes(STEP_MASK)) masked += 1;
        expect(line).not.toContain(literal);
      }
    }
    // So the assertion above cannot pass by finding nothing to test.
    expect(planted).toBeGreaterThan(0);
    expect(masked).toBeGreaterThan(0);
  });

  it('gives every value the CLI does not name a disposition', () => {
    // THE PARTITION. Each place in the CLI's `slots` bag is rendered, recorded as never
    // shown, or named in `unresolved` with a reason; nothing may be outside those three.
    // Asserted here as well as in the round-trip because "unaccounted for" is a category
    // that survived two rounds of review, and a hand-run script is not a gate.
    const tally = { rendered: 0, neverShown: 0, unsettled: 0, outside: [] as string[] };
    for (const source of SOURCES) {
      const body = readBody(source.body);
      for (const step of body) {
        const slots = step.slots;
        if (slots === null || typeof slots !== 'object') continue;
        const entry = CATALOG[step.step];
        const refs = (list: Array<{ key: string; slot?: StepSlotRef }> | undefined) =>
          new Set((list ?? []).filter((item) => item.slot).map((item) => segmentID(item)));
        const rendered = refs(entry?.segments);
        const hidden = refs(entry?.ignored);
        const unsettled = refs(entry?.unresolved);
        for (const [member, held] of Object.entries(slots as Record<string, unknown>)) {
          const here =
            held !== null && typeof held === 'object' && !Array.isArray(held)
              ? Object.keys(held).map((number) => segmentID({ key: 'slots', slot: { member, number } }))
              : [segmentID({ key: 'slots', slot: { member } })];
          for (const ref of here) {
            if (rendered.has(ref)) tally.rendered += 1;
            else if (hidden.has(ref)) tally.neverShown += 1;
            else if (unsettled.has(ref)) tally.unsettled += 1;
            else tally.outside.push(`${step.step} ${ref}`);
          }
        }
      }
    }
    expect(tally.outside).toEqual([]);
    // Measured on fm 0.8.0 (29834929): 55 rendered + 232 never shown + 2 unresolved.
    // The partition above is the invariant; both the sum and the split are facts about the
    // corpus, and two builds running have moved them.
    //
    // 0.8.0-beta.0 reported Replace Field Contents' and Install Menu Set's options as named
    // keys instead of anonymous `slots` places, taking 29 places out of the bag: the sum fell
    // 319 -> 290 and `rendered` 61 -> 56, while the test below rose 2813 -> 3016 in the same
    // move. 0.8.0 GA then took Set Zoom Level's last `slots` place the same way, replacing
    // `slots` + `stepValue` with `customZoomLevel`: 290 -> 289 and 56 -> 55.
    //
    // A fall here needs a reason every time. For the GA one see the test below: it is a
    // spurious segment going away, not a value that stopped rendering.
    expect(tally.rendered + tally.neverShown + tally.unsettled).toBe(289);
    expect(tally.rendered).toBeGreaterThanOrEqual(55);
  });

  it('has no key the catalog accounts for in no way at all', () => {
    // The population the convention append pass was built for: a key the entry does not
    // mention anywhere, in any list. It is asserted to be EMPTY on this corpus, and that zero
    // is what keeps the round-trip's counts figures about the catalog. Where it matters is a
    // file this catalog was never derived from, which no corpus can measure.
    //
    // It is deliberately NOT the same set the renderer withholds — see the case below. A key
    // the catalog `ignored` at `low` confidence, or named in `unresolved`, is mentioned here
    // and still printed there, because a recorded doubt is not a measurement.
    const unmentioned: string[] = [];
    for (const source of SOURCES) {
      const body = readBody(source.body);
      for (const step of body) {
        const entry = CATALOG[step.step];
        if (entry === undefined) continue;
        const accounted = new Set<string>([
          ...entry.segments.filter((item) => !item.slot).map((item) => item.key),
          ...entry.ignored.filter((item) => !item.slot).map((item) => item.key),
          ...(entry.unresolved ?? []).filter((item) => !item.slot).map((item) => item.key),
          ...(entry.commentStyle ? ['text'] : []),
        ]);
        for (const key of Object.keys(step)) {
          if (ARTEFACT_KEYS.has(key) || accounted.has(key)) continue;
          unmentioned.push(`${step.step} | ${key}`);
        }
      }
    }
    expect([...new Set(unmentioned)]).toEqual([]);
  });

  it('prints every value it holds except the ones measured never to show', () => {
    // THE BASELINE, MEASURED OVER THE WHOLE CORPUS, and the assertion the previous shape of
    // this file could not make: of every value the CLI sends, how many reach the line.
    //
    // Two numbers, and they are different claims. `rendered` may only rise. `withheld` is the
    // catalog's strong evidence — `ignored` at `measured` confidence, a `hiddenWhen`, an
    // `omittedValues`, a flag that is off — and it may only fall; the 660 `ignored`-at-
    // `measured` values inside it are the ones awaiting the owner's decision, since "FileMaker
    // never shows this key" is a universal negative drawn from this one corpus.
    let rendered = 0;
    let baseline = 0;
    let withheld = 0;
    for (const source of SOURCES) {
      for (const step of readBody(source.body)) {
        const entry = CATALOG[step.step];
        if (entry === undefined || Object.hasOwn(step, 'opaque')) continue;
        const line = renderStepFromCatalog(step, entry, CONVENTIONS);
        const printed = new Set(line.contributed);
        rendered += printed.size;
        baseline += new Set(line.baseline).size;
        const slots = step.slots;
        const places = [
          ...Object.keys(step).filter((key) => key !== 'slots' && !ARTEFACT_KEYS.has(key)),
          ...(slots !== null && typeof slots === 'object'
            ? Object.entries(slots as Record<string, unknown>).flatMap(([member, held]) =>
                held !== null && typeof held === 'object' && !Array.isArray(held)
                  ? Object.keys(held).map((number) => segmentID({ key: 'slots', slot: { member, number } }))
                  : [segmentID({ key: 'slots', slot: { member } })],
              )
            : []),
        ];
        withheld += places.filter((id) => !printed.has(id)).length;
      }
    }
    // Measured on fm 0.8.0 (29834929): 3015 options printed, 107 of them by the baseline,
    // 1142 values withheld. `rendered` exceeds the number of values the CLI sends because a
    // `whenAbsent` option prints for a key it does NOT send.
    //
    // `rendered` FELL by one against its own ratchet, 3016 -> 3015, and `baseline` with it,
    // 108 -> 107. Both are the same single value, and it is a WRONG segment going away.
    // Isolated to one step type by rendering every example under both catalogs: Set Zoom
    // Level, 23 -> 22. Its eleventh example has a calculated zoom level, and through
    // 0.8.0-beta.0 fm sent `stepValue: 11` alongside the calc, which this catalog rendered as
    // a trailing `; Step value: 11`. FileMaker's own line for that step — line 679 of
    // `All script steps and all options 20260318.txt`, `Set Zoom Level [ Lock: On ; <the
    // calc's own comment text>% ]` — has no Step value segment at all. GA sends only
    // `customZoomLevel`, so the false segment is gone and the floor was inflated by it. The
    // entry is `verified: false` before and after, for an unrelated reason: the `%` suffix
    // still does not render.
    //
    // `withheld` rose again, 1139 -> 1142, and the three are accounted for: GA sends `on` on
    // Set Error Logging's three examples, and the catalog `ignored`s it rather than rendering
    // it.
    //
    // `withheld` first ROSE at 0.8.0-beta.0, 937 -> 1139, and the ratchet ("it may only fall") is suspended
    // for this build rather than quietly rebased: the population it counts changed underneath
    // it. The `continue` above skips any step carrying `opaque`, and 0.8.0 stopped sending
    // `opaque` on Import Records (38 examples), Export Records (15), Print (10) and Page Setup
    // (4) — so 67 steps that were excluded from this tally are now measured by it for the
    // first time. What they bring with them is fm's new structured options: `importOptions`
    // (30 keys), `exportOptions` (22), `printOptions` (11, nested `pageSetup` 8), `pageSetup`
    // (8). The catalog does not render those yet, so they land in `withheld`, and this number
    // is the size of that outstanding work, not a regression in what the catalog prints.
    // Re-tighten it to the measured value once those objects are rendered.
    expect(rendered).toBeGreaterThanOrEqual(3015);
    expect(baseline).toBeGreaterThanOrEqual(107);
    expect(withheld).toBeLessThanOrEqual(1142);
  });

  it('agrees with the aligner about collapsing a return', () => {
    // The renderer and the derivation hold this two-line function separately, because the
    // derivation must not depend on the app's source. Checked rather than claimed.
    for (const value of ['a\rb', 'a\nb', 'a\r\nb', ' a ', '', 'a\r\rb', 'plain']) {
      expect(oneLine(value)).toBe(alignOneLine(value));
    }
    expect(oneLine(undefined)).toBe(alignOneLine(undefined));
    expect(oneLine(null)).toBe(alignOneLine(null));
    expect(oneLine(3)).toBe(alignOneLine(3));
  });
});

/** THE BOUNDARY, in the direction that was unguarded.
 *
 *  `assertNoOwnerContent` in scripts/derive-step-display.mjs fails the derivation if one token
 *  of the owner's schema reaches the strings the CATALOG emits. Committed CODE had no such
 *  guard, and six comments had picked up his table and field names as illustrations —
 *  `derive-step-display.mjs`, `fm-segment-parse.mjs`, `step-display-types.ts` and a fixture in
 *  another test. Each is now a placeholder.
 *
 *  It needs no list of forbidden names, which is the point: the names are READ OUT of
 *  `fm_scripts/`, the copy of his two scripts this repo publishes deliberately. So the guard
 *  contains no owner content itself, it cannot go stale against the data, and it widens the
 *  moment the data does. `fm_scripts/` is excluded because its owner content is its purpose. */
describe('the boundary between the data this repo publishes and the code it ships', () => {
  it('has no field reference out of the owner’s own scripts in any committed source file', () => {
    const owned = new Set<string>();
    for (const source of SOURCES) {
      for (const file of [source.body, source.text]) {
        for (const token of readCommitted(file).match(/[A-Za-z0-9_]+::[A-Za-z0-9_]+/g) ?? []) {
          owned.add(token);
        }
      }
    }
    // So the assertion below cannot pass by finding nothing to look for.
    expect(owned.size).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const dir of ['src', 'scripts', 'tests']) {
      const here = path.join(ROOT, dir);
      for (const relative of fs.readdirSync(here, { recursive: true }) as string[]) {
        if (!/\.(ts|mjs|tsx)$/.test(relative)) continue;
        const text = fs.readFileSync(path.join(here, relative), 'utf8');
        for (const token of owned) if (text.includes(token)) offenders.push(`${dir}/${relative}`);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
    // Substring-searches every committed source file once per owned token, and the token set
    // is read out of the corpus — so the work grows with the data. fm 0.8.0's structured
    // `importOptions`/`exportOptions`/`sortOrder` objects name their fields as
    // `Occurrence::Field` text, which widened the set enough to push this past vitest's 5s
    // default. The timeout is raised rather than the scan narrowed: reading the names out of
    // the data is what keeps the guard from going stale, which is the whole design.
  }, 30_000);
});

describe('the shared renderer’s two halves', () => {
  it('joins to the measured line, with the empty comment as the one exception', () => {
    // `stepDisplayText` rebuilds the line from `name` and `detail`; the round-trip
    // compares `line`. They are the same string everywhere except an empty comment, where
    // FileMaker writes a trailing space that a UI row cannot show — so the difference is
    // pinned here rather than left to be discovered as a mismatch.
    const comment = CATALOG['#'];
    const empty = renderStepFromCatalog({ stepID: 89, step: '#' }, comment, CONVENTIONS);
    expect(empty.line).toBe('# ');
    expect(empty.detail).toBe('');

    const filled = renderStepFromCatalog(
      { stepID: 89, step: '#', text: 'a note' },
      comment,
      CONVENTIONS,
    );
    expect(filled.line).toBe('# a note');
    expect(`${filled.name} ${filled.detail}`).toBe(filled.line);
  });

  it('renders a step whose shape nothing predicted, rather than throwing', () => {
    // It runs on whatever a live file holds. A missing key, a value of the wrong type, a
    // `slots` object that is not an object: each produces a line.
    const entry = CATALOG['Set Variable'];
    // Cast deliberately, and it is the point rather than a convenience: `ScriptDetailStep`
    // declares `name` a string, and what a live `read:script` hands over is only as
    // well-shaped as the file it came from. The renderer has to survive the shapes the
    // type forbids as much as the ones it allows.
    const shapes = [
      { stepID: 141, step: 'Set Variable' },
      { stepID: 141, step: 'Set Variable', name: null, value: undefined },
      { stepID: 141, step: 'Set Variable', name: { nested: true }, repetition: [] },
      { stepID: 141, step: 'Set Variable', name: 3, value: false, slots: 'not an object' },
      { stepID: 141, step: 'Set Variable', name: '$x', repetition: { set: ['odd'] } },
    ] as unknown as ScriptDetailStep[];
    for (const step of shapes) {
      expect(typeof renderStepFromCatalog(step, entry, CONVENTIONS).line).toBe('string');
    }
  });

  it('names the mask as FileMaker writes it', () => {
    expect(STEP_MASK).toBe('•'.repeat(8));
  });
});

/** The one invariant that makes the shared-source arrangement work, and it is invisible to
 *  every other gate: `scripts/roundtrip-step-display.mjs` imports
 *  `src/step-display/step-display-render.ts` AS SOURCE, so Node has to be able to strip its
 *  types. A planted `enum` kills the round-trip and leaves `npm test`, `npm run lint` and
 *  `npm run build` green — measured by a review — so the guard belongs here rather than in
 *  a comment. Vitest cannot catch it by importing the module itself: vite transpiles, and
 *  Node's loader does not. */
describe('the round-trip can import the shipped renderer', () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const stripsTypes = major > 22 || (major === 22 && minor >= 18);

  it.skipIf(!stripsTypes)('loads as plain TypeScript under Node’s own loader', () => {
    // Exactly what the round-trip does, in a child process, so the failure mode is this
    // test rather than a hand run three weeks later. `engines.node` in package.json states
    // the floor this skips below.
    const module = path.resolve(__dirname, '../src/step-display/step-display-render.ts');
    const source = `import('${module}').then((m) => { if (typeof m.renderStepFromCatalog !== 'function') throw new Error('no renderer'); });`;
    const output = execFileSync(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', source],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(output).toBe('');
  });

  it('declares the Node floor that loader needs', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
    ) as { engines?: { node?: string } };
    expect(manifest.engines?.node).toBeDefined();
  });
});
