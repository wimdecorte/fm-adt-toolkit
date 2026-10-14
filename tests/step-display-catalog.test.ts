import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import catalogData from '../src/catalogs/fm-step-display.json' with { type: 'json' };
import {
  ARTEFACT_KEYS,
  expandStep,
  oneLine,
  renderStepFromCatalog,
  segmentID,
  stepConventions,
  STEP_MASK,
  topKey,
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
    // Measured on fm 0.10.0 (29853940): 68 rendered + 159 never shown + 7 unresolved.
    // The partition above is the invariant; both the sum and the split are facts about the
    // corpus, and three builds running have moved them.
    //
    // 0.8.0-beta.0 reported Replace Field Contents' and Install Menu Set's options as named
    // keys instead of anonymous `slots` places, taking 29 places out of the bag: the sum fell
    // 319 -> 290 and `rendered` 61 -> 56, while the test below rose 2813 -> 3016 in the same
    // move. 0.8.0 GA then took Set Zoom Level's last `slots` place the same way, replacing
    // `slots` + `stepValue` with `customZoomLevel`: 290 -> 289 and 56 -> 55.
    //
    // A fall here needs a reason every time. For the GA one see the test below: it is a
    // spurious segment going away, not a value that stopped rendering.
    //
    // 0.9.0 took 45 more places out of the bag, 289 -> 244, every one by step type. 28 are
    // `slots.fileReference: "Current File"`, which fm stopped sending on AVPlayer Set Options
    // (18) and Perform Semantic Find (10) — never shown, so nothing printed changed. The other
    // 17 became named keys: a data source given by id (Configure Region Monitor Script, Install
    // OnTimer Script, Open File), `sourceOptions` on Convert File (3), `sql` on Execute SQL,
    // `parameters`/`llmParameters` on the two AI steps (5) and the Perform Script family (5).
    // `rendered` fell 55 -> 48 with them, and seven is the same set seen from the other side:
    // the three data sources render from their named key now; Convert File's two and Execute
    // SQL's one went into `sourceOptions` and `sql`, which render member by member (see the
    // members paragraph under `withheld` below); and Perform Script on Server's was the spurious
    // `List: 1` — see `baseline`.
    //
    // Then 48 -> 43 rendered and 2 -> 7 unresolved, with no place leaving the bag: the plug-in
    // step's five argument slots. fm 0.9.0 sends those values twice, under `arguments.*` and as
    // `slots.calc.0`-`4`, and once `expandStep` let the matcher see `arguments.Function` it
    // placed the named copy, so the slot copies are settled as shown under another key.
    //
    // 0.10.0 took 51 places out of the bag and put 41 in, 244 -> 234. Out: the stored settings
    // FileMaker does not apply — a layout id of 0 beside a layout given by calculation or
    // `<Current Layout>` on Go to Layout (12), Go to List of Records (12) and New Window (3), and
    // Save Records as PDF's calc and numeric slots where Restore is off (22) — all never shown,
    // so nothing printed changed; and Install Menu Set's `memberKey` (2), which 0.10.0 names
    // `menuSet`. In: `fieldRepetition`, a field reference's repetition, on seven step types (40),
    // and one `memberKey` on a Go to Related Record into another file. `rendered` ROSE 43 -> 68:
    // 35 of the 40 repetitions are what FileMaker prints after the field, in brackets,
    // against Install Menu Set's two and Go to Related Record's window name (8), which no longer
    // carries `New window` — 0.10.0 names the window style, and that option follows `style`.
    //
    // 0.11.0 (29863806) EMPTIED THE BAG, 234 -> 0: it sends `slots` on no step, nor `flags`.
    // Its help says why — "Every other step describes its options with named keys", and only
    // an opaque step, which neither corpus file has, carries the raw word. So the partition
    // holds with nothing in it, and the zero is pinned so that a build sending `slots` again
    // shows up here. `rendered` has no floor left to hold and is not asserted.
    //
    // Where the 234 went, matched by value step by step. 114 came back under a named key with
    // the same value: Go to Related Record's window (40, now `name`, `width`, `height`, `left`,
    // `top`), the field repetitions (37, as `fieldRepetition`, `repetition` or
    // `<key>Repetition`), Insert from Device's prompt, title, message and duration (13),
    // ExternalStep's ten arguments, which were already sent as `arguments.*` too, and 14 more.
    // Five came back re-encoded: Insert from Device's two numeric switches as
    // `startImmediately` and `scanFrom`, and Convert File's path as `path`. The other 115 are
    // sent nowhere. Nearly all of them are values FileMaker stores and does not print, the class
    // 0.10.0 started leaving out (AVPlayer's 59 script and member ids, Perform Semantic Find's
    // 10, the six Insert and Get steps' unused target variable). But 7 of the 68 rendered places
    // were printed by FileMaker too: Configure Region Monitor Script's `Parameter:` (5),
    // which no key carries, and Import Records' XML and XSL paths (2). The step-display backlog
    // records them as a CLI regression.
    expect(tally.rendered + tally.neverShown + tally.unsettled).toBe(0);
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
        // The keys as the catalog addresses them: a structured option by its members, any of
        // which is accounted for by a mention of its own or of the option as a whole.
        for (const key of Object.keys(expandStep(step))) {
          if (ARTEFACT_KEYS.has(key) || accounted.has(key) || accounted.has(topKey(key))) continue;
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
        // Counted as the renderer addresses them: a structured option by its members.
        const places = [
          ...Object.keys(expandStep(step)).filter((key) => key !== 'slots' && !ARTEFACT_KEYS.has(key)),
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
    //
    // fm 0.9.0 (29846589): 3058 printed, 93 of them by the baseline, 1224 withheld, and FileMaker's
    // own text is matched byte for byte on 910 lines where it was 894 — measured by rendering every
    // pair under the GA catalog and corpus and under these.
    //
    // `rendered` rose, 3015 -> 3058, nearly all of it Insert File: the 14 steps 0.8.0 sent opaque
    // are decoded, and all 31 examples now match FileMaker exactly (17 before).
    //
    // `baseline` FELL against its floor, 107 -> 93, and each of the 14 is a print FileMaker never
    // made going away: `List: 1` / `List 1: 1 ; List 6: 1` on the Perform Script family (4) and
    // `Calc 30`, `Calc 31`, `Numeric` on the two AI steps (5), slot values 0.9.0 now names; `; true`
    // on Replace Field Contents (2), which the enum-only omitted-boolean rule removed; `"dev" ;
    // Calc: "dev"` on one Convert File (2); and Perform JavaScript in Web Viewer's two `Arg`
    // slots, now one `parameters` list (1), which FileMaker prints joined with `, ` — the
    // catalog measures that as `listForm: 'joined'` and prints it the same way.
    //
    // `withheld` ROSE, 1142 -> 1224, and the ratchet is suspended for this build as it was for
    // 0.8.0-beta.0, because most of the rise is population rather than regression. Insert File
    // +93: its 14 formerly opaque steps are counted for the first time, with every key FileMaker
    // draws nothing for. Then the objects fm 0.9.0 introduced and this catalog does not render
    // inside: Convert File's `sourceOptions` +6 and Execute SQL's `sql` +3 — the second costs a
    // line that matched before, `Calculated SQL Text:`. Then the AI steps +10: Perform SQL Query
    // by Natural Language's `tableOccurrences` (8, withheld on the owner's ruling) and each step's
    // withdrawn `parameters` list (2). Then Replace Field Contents' `performAutoEnter: true` (2),
    // correctly unprinted now. Against those: `slots.fileReference` no longer sent (-28), Set
    // Error Logging's `on` rendered at last (-3), and Insert from URL's `encodeUrl` (-1).
    //
    // THEN THE MEMBERS, in the same intake. A structured option is now addressed member by member
    // (`expandStep`), so `sql.query` renders and Execute SQL matches FileMaker on all three lines;
    // Print's printer, Import Records' table, action and character set, and Convert File's source
    // render too. `rendered` 3058 -> 3137 and `baseline` 93 -> 95. `withheld` is now counted per
    // member, which is what the renderer addresses, and that is a different population: 1770.
    // Counted the old way, one object at a time, the same catalog withholds 1210 — FELL by 14 from
    // 1224 — so the rise is the count's unit, not the catalog. The ratchet is re-armed on members.
    //
    // fm 0.10.0 (29853940): 3176 printed, 81 of them by the baseline, 1749 withheld; FileMaker's
    // own text matched byte for byte on 962 lines.
    //
    // `rendered` rose, 3137 -> 3176: Add Account's privilege set, which 0.10.0 is the first build to
    // report (+11); Configure Regression Model's `action` and field repetitions (+18); Generate
    // Response from Model's (+19) and Insert Image Captions in Found Set's (+4) repetitions; one each
    // on AVPlayer Play, Go to Layout and Install Menu Set. Against them, 16 prints FileMaker never
    // made: Go to List of Records (-12) and Configure AI Account (-1), both under `baseline` below,
    // and Save Records as Excel (-3) — its inverted `useFieldNames`, and `records` on the two steps
    // whose Restore is off.
    //
    // `baseline` FELL against its floor, 95 -> 81. Sixteen left, every one a print FileMaker never
    // made: Go to List of Records' `Member key: 0` (12), the stale layout id 0.10.0 stopped sending;
    // Install Menu Set's id, Set Window Title's and Configure AI Account's `stepValue`, now named
    // (`menuSet`, `target`, `provider`); and Save Records as Excel's `useFieldNames`, which 0.9.0
    // reported inverted. Two arrived. AVPlayer Play prints a field repetition that one example
    // carries (`slots.fieldRepetition.0`), as any value on one example prints. Go to Layout prints
    // `Member key: 0` for its one broken layout reference, which FileMaker writes `<unknown>`: the
    // twelve stale ids that used to hide it as never shown are gone, and R2 rules that a broken
    // reference is not skipped.
    //
    // `withheld` FELL, 1770 -> 1749, so the ratchet tightens. Out (-48): the stored-but-unapplied
    // settings above (Save Records as PDF -22, Go to Layout -13, New Window -3, Configure AI
    // Account's SSL switch -4), the Perform Script family -5 (the stale `script` on its three by-name
    // steps, and two Perform Script on Server with Callback `stepValue`s now `callbackState`), and
    // Install Menu Set -1. In (+27): Go to Related Record's window name and style (+10), now never
    // shown; Sort Records' `maintain` and `blanksLast` (+6), which 0.10.0 sends on every step in
    // place of the raw `sortOrder.flags`; AVPlayer Play (+4 net, `source`); Save Records as Excel
    // (+3); Perform RAG Action's and Perform Semantic Find's repetitions (+4).
    //
    // fm 0.11.0 (29863806): 3169 printed, 71 of them by the baseline, 1698 withheld; FileMaker's
    // own text matched byte for byte on 970 lines. Measured by rendering every pair under the
    // 0.10.0 catalog and corpus and under these, step type by step type.
    //
    // `rendered` FELL against its floor, 3176 -> 3169, and the floor moves down with a reason for
    // every value. Out (-32), three kinds. FileMaker's `<Table Missing>` on a broken field
    // reference (-12, eleven step types): the catalog printed it while bit 1 of `flags` was set,
    // and 0.11.0 sends no `flags`, so a broken reference and no reference now read the same.
    // Stale stored values the baseline printed and FileMaker never did (-11): the six Insert and
    // Get steps' target variable, AVPlayer Play's field repetition, Speak's voice name and three
    // `memberKey`/list ids, all of them `slots` places 0.11.0 no longer sends. And values
    // FileMaker DOES print that 0.11.0 sends under no key (-9): Configure Region Monitor
    // Script's `Parameter:` (5), Import Records' XML and XSL paths (2), and a calculation Perform
    // RAG Action printed beside `Tokens per Text Chunk` (2). In (+25): keys 0.11.0 sends for the
    // first time — Save Records as Excel's, JSONL's and Snapshot Link's `openAutomatically` and
    // `createEmail` (13), `on` on Allow Formatting Bar, Set Layout Object Animation and Set
    // Revert Transaction on Error (5), Move/Resize Window's `currentFileOnly` (2), Insert from
    // Device's `scanFrom` (1) — and Go to Related Record's `New window` on two more lines than the
    // `style` presence route reached (2), and Perform Semantic Find's repetitions (2).
    //
    // `baseline` FELL against its floor, 81 -> 71. Out (-15): the eleven stale `slots` prints
    // above, Go to List of Records' window `name` (4), which the catalog now measures never
    // shown. In (+5), every one a key the catalog holds no measured segment for: Perform Semantic
    // Find's `saveResultRepetition` (2), Insert from Device's `scanFrom`/`scanFromField` in place
    // of `slots.numeric.3` (net +1), Go to Field's `repetition` on its broken reference (1), and
    // Go to Related Record's broken layout reference, `layout: 0` (1). Go to Layout's equivalent
    // moved from `slots.memberKey` to `layout` and nets zero.
    //
    // `withheld` FELL, 1749 -> 1698, so the ratchet tightens. Out (-115), nearly all of it the
    // never-shown `slots` places 0.11.0 stopped sending (see the partition above) — AVPlayer Set
    // Options -48, Perform Semantic Find -18, Configure Prompt Template's prompts -17, AVPlayer
    // Play -11, ExternalStep's slot copies of its arguments -10, Perform Script on Server with
    // Callback -5, and six more on four step types. In (+64): keys 0.11.0 sends on every example whatever their
    // value, mostly off — Go to Related Record's `showInNewWindow` and window values (+21), Go to
    // List of Records' `newWindow` (+19), Insert from Device's `startImmediately` and duration
    // (+13), Save Records as Excel, JSONL and Snapshot Link (+8), Trigger Claris Connect Flow's
    // `encodeUrl` (+3).
    expect(rendered).toBeGreaterThanOrEqual(3169);
    expect(baseline).toBeGreaterThanOrEqual(71);
    expect(withheld).toBeLessThanOrEqual(1698);
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
