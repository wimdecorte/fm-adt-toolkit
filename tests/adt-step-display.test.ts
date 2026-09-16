import { describe, it, expect } from 'vitest';
import { CATALOG, keyLabel, stepDisplay, stepDisplayText } from '../src/step-display/step-display.ts';
import {
  STEP_MASK, catalogEntry, renderStepFromCatalog, stepConventions,
} from '../src/step-display/step-display-render.ts';
import type { ScriptDetailStep } from '../src/types.ts';

/** The renderer reads `src/catalogs/fm-step-display.json`, so most of what is asserted
 *  here is MEASURED: the catalog was derived by pairing 1203 steps the CLI reported with
 *  the lines FileMaker's own Script Workspace wrote for them, and
 *  `scripts/roundtrip-step-display.mjs` measures this very code against all 1203 (917
 *  exact / 84 settled by the owner's rulings / 94 still different / 108 not writable
 *  from what the CLI sends). A line below that a reader would have to take on trust
 *  says where it comes from.
 *
 *  Every step fixture is a step as fm actually reported it — a probe script
 *  holding a comment, an empty comment, two Set Variables, an If/Else If/Else/End If, a
 *  Loop/Exit Loop If/End Loop, two Insert from URLs and four unrelated steps, written to
 *  a scratch `--create` file and read straight back. So the keys, their spellings and
 *  the values that come back unasked — `collapsed: false`, `flush: "always"`,
 *  `targetType: 1`, `curlOptionsSpecified: false` — are measured too.
 *
 *  The SPELLINGS are fm 0.7.0's: that build renamed every multi-word option key to
 *  camelCase (`with dialog` -> `withDialog`, `verify SSL certificates` ->
 *  `verifySslCertificates`), and the catalog was re-derived from the same two ooe
 *  scripts read back with it. `a step an older fm reported` at the end of this file
 *  pins what a consumer still on 0.6.0 gets.
 *
 *  WHAT CHANGED WHEN THE CATALOG REPLACED SEVEN HAND-WRITTEN CASES, because several
 *  assertions here moved and each move is a correction rather than a preference:
 *   - `Loop [ Flush: Always ]`, where the hand-written renderer wrote `Loop` bare on the
 *     reasoning that `always` is the absence of a choice. FileMaker's own text disagrees
 *     three times over.
 *   - `Set Variable [ $n[2] ; … ]`, FileMaker's own form, where the old renderer wrote
 *     `Repetition: 2`; and no repetition at all when it is 1, on the owner's ruling.
 *   - `Set Variable []`, measured: FileMaker prints the brackets even with nothing in
 *     them, per step type.
 *   - a value the catalog cannot confidently place IS printed, under whatever label the
 *     catalog knows — see the block that pins the four ways in. Only the catalog's strong
 *     measured claim that FileMaker never shows a key keeps it off the line.
 */

/** The owner's own working step, and the line FileMaker shows for it. */
const INSERT_FROM_URL: ScriptDetailStep = {
  stepID: 160,
  step: 'Insert from URL',
  target: '$result',
  url: '$url',
  'curlOptions': '$cURL_options',
  'verifySslCertificates': true,
  select: true,
  'withDialog': false,
  'curlOptionsSpecified': false,
};

const GROUND_TRUTH =
  'Insert from URL [ Select ; With dialog: Off ; Target: $result ; $url ; ' +
  'Verify SSL Certificates ; cURL options: $cURL_options ]';

describe('Insert from URL, against the measured FileMaker line', () => {
  it('renders the owner’s step exactly as FileMaker writes it', () => {
    expect(stepDisplayText(INSERT_FROM_URL)).toBe(GROUND_TRUTH);
  });

  it('splits the name from the detail so a row can style them apart', () => {
    expect(stepDisplay(INSERT_FROM_URL)).toEqual({
      name: 'Insert from URL',
      detail: GROUND_TRUTH.slice('Insert from URL '.length),
    });
  });

  it('is unchanged by the artefact keys a real read adds', () => {
    // uuid, flags and target type all come back on every read of this step.
    expect(
      stepDisplayText({
        ...INSERT_FROM_URL,
        uuid: '092F3716-B45F-473D-9BAD-49AA11D5C1A5',
        'targetType': 1,
        flags: 268456071,
      }),
    ).toBe(GROUND_TRUTH);
  });

  it('drops a bare flag that is off and keeps the dialog switch either way', () => {
    // Measured: the second Insert from URL in the probe, written with no options.
    expect(
      stepDisplayText({
        stepID: 160,
        step: 'Insert from URL',
        target: '$r2',
        url: '"https://x"',
        'verifySslCertificates': false,
        select: true,
        'withDialog': false,
        'targetType': 1,
        'curlOptionsSpecified': false,
        flags: 20615,
      }),
    ).toBe('Insert from URL [ Select ; With dialog: Off ; Target: $r2 ; "https://x" ]');
  });

  it('prints no option for cURL options specified, whichever way it reads', () => {
    // **THE KEY THAT HAS ALREADY CAUSED A DEFECT IN THIS PROJECT**, on the one step type this app
    // generates. `CLAUDE.md`: reading it as the `Specify cURL options` checkbox silently dropped
    // the method and headers from working scripts, because a FileMaker-authored step reads it back
    // `false` while its options render, and FileMaker's popover has no such checkbox at all.
    //
    // The baseline printed it briefly, on the one corpus step where it is `true`: its `ignored`
    // claim read `low` because the claim needed a hand withdrawal to exist, and a `low` claim is
    // one a renderer prints. Closed in the DERIVATION — the withdrawal now names its external
    // source, which answers that dependence and takes the claim to `measured` — and deliberately
    // not in the renderer, where it would be the "renderer decides what may print" coupling all
    // over again. So the line is the same either way, and that is what this pins.
    expect(stepDisplayText({ ...INSERT_FROM_URL, 'curlOptionsSpecified': true })).toBe(GROUND_TRUTH);
    expect(stepDisplayText({ ...INSERT_FROM_URL, 'curlOptionsSpecified': false })).toBe(GROUND_TRUTH);
  });

  it('says With dialog: On when the switch is on', () => {
    expect(
      stepDisplayText({ stepID: 160, step: 'Insert from URL', 'withDialog': true, url: '$u' }),
    ).toBe('Insert from URL [ With dialog: On ; $u ]');
  });

  it('omits the dialog switch entirely when the key is absent', () => {
    // A body this app generated rather than read: claiming Off for a key nobody set
    // would be inventing a setting.
    expect(stepDisplayText({ stepID: 160, step: 'Insert from URL', url: '$u' })).toBe(
      'Insert from URL [ $u ]',
    );
  });

  it('appends a key the catalog has no opinion about, rather than dropping it', () => {
    // The catalog mentions a key by rendering it, by recording it as never shown, or by
    // naming it unresolved. `repetition` is none of those on this step type, so it is printed
    // by the baseline after the measured options. The owner's ruling: "we should not omit
    // options", and separately that an option we print and FileMaker does not is fine. On the
    // 1203 measured examples there is no such key at all — 0 pairs, 0 occurrences, asserted
    // in tests/step-display-catalog.test.ts — so this costs nothing measured and exists for
    // the files the catalog was never derived from.
    expect(
      stepDisplayText({ stepID: 160, step: 'Insert from URL', url: '$u', repetition: '3' }),
    ).toBe('Insert from URL [ $u ; Repetition: 3 ]');
  });

  it('renders an opaque step as the bare name, having no options to show', () => {
    // The CLI could not project this step's options, so there are none in the JSON to
    // write — `opaque` and `editable` are its own bookkeeping, not options. The row
    // draws the `opaque` marker that explains the empty line; see stepRowContents.
    expect(
      stepDisplayText({
        stepID: 160,
        step: 'Insert from URL',
        uuid: 'x',
        opaque: true,
        editable: false,
      }),
    ).toBe('Insert from URL');
  });
});

describe('the comment step', () => {
  it('shows its text after the #, unbracketed', () => {
    expect(
      stepDisplayText({
        stepID: 89,
        step: '#',
        uuid: '5BB65234-4086-4B33-B63C-FAECDA784BEC',
        text: 'a comment with text',
        flags: 4,
      }),
    ).toBe('# a comment with text');
  });

  it('is just # when the comment is empty', () => {
    // Measured: an empty comment comes back with no `text` key at all.
    expect(stepDisplayText({ stepID: 89, step: '#', uuid: 'C3998B2F' })).toBe('#');
  });

  it('keeps a text of spaces verbatim rather than squeezing it', () => {
    // The hand-written renderer collapsed and trimmed every value. The catalog path
    // prints a comment's text as the CLI reports it, because in FileMaker two spaces are
    // not one space — and because 285 measured comments are how the round-trip knows
    // what a comment's line looks like.
    expect(stepDisplayText({ stepID: 89, step: '#', text: '   ' })).toBe('#    ');
  });

  it('keeps a multi-line comment’s returns', () => {
    // Measured, and the reason the aligner counts `1 + returns` lines for a comment:
    // FileMaker gives such a comment a ROW PER LINE. `.fm-step-text` has no
    // `white-space: pre-wrap`, so the row still draws it as one line.
    expect(stepDisplayText({ stepID: 89, step: '#', text: 'first\rsecond' })).toBe(
      '# first\nsecond',
    );
  });
});

describe('Set Variable', () => {
  it('writes the variable bare and labels its value', () => {
    expect(
      stepDisplayText({
        stepID: 141,
        step: 'Set Variable',
        uuid: 'FACF7105',
        name: '$url',
        value: '"https://api.example.com/x"',
        flags: 16388,
      }),
    ).toBe('Set Variable [ $url ; Value: "https://api.example.com/x" ]');
  });

  it('writes a repetition inside the variable reference, as FileMaker does', () => {
    expect(
      stepDisplayText({
        stepID: 141,
        step: 'Set Variable',
        name: '$n',
        value: '1',
        repetition: '2',
        flags: 16388,
      }),
    ).toBe('Set Variable [ $n[2] ; Value: 1 ]');
  });

  it('omits a repetition of 1', () => {
    // The owner: "FM does not print the rep number if it is 1."
    expect(
      stepDisplayText({ stepID: 141, step: 'Set Variable', name: '$n', value: '1', repetition: '1' }),
    ).toBe('Set Variable [ $n ; Value: 1 ]');
  });

  it('prints empty brackets for a step measured to show them', () => {
    expect(stepDisplayText({ stepID: 141, step: 'Set Variable' })).toBe('Set Variable []');
  });
});

describe('the block steps', () => {
  it('writes If as its condition alone', () => {
    expect(
      stepDisplayText({
        stepID: 68,
        step: 'If',
        uuid: '45E2BF50',
        block: { role: 'opener', start: 3, end: 7 },
        condition: '$url ≠ ""',
        collapsed: false,
        flags: 16384,
      }),
    ).toBe('If [ $url ≠ "" ]');
  });

  it('writes Else If the same way', () => {
    expect(
      stepDisplayText({
        stepID: 125,
        step: 'Else If',
        block: { role: 'branch', start: 3, end: 7 },
        condition: '1',
        collapsed: false,
      }),
    ).toBe('Else If [ 1 ]');
  });

  it('writes Exit Loop If as its condition alone', () => {
    expect(
      stepDisplayText({ stepID: 72, step: 'Exit Loop If', condition: '$i > 3', flags: 16384 }),
    ).toBe('Exit Loop If [ $i > 3 ]');
  });

  it('writes Else, End If and End Loop bare', () => {
    expect(
      stepDisplayText({
        stepID: 69,
        step: 'Else',
        block: { role: 'branch', start: 3, end: 7 },
        collapsed: false,
      }),
    ).toBe('Else');
    expect(
      stepDisplayText({
        stepID: 70,
        step: 'End If',
        block: { role: 'closer', start: 3, end: 7 },
      }),
    ).toBe('End If');
    expect(
      stepDisplayText({
        stepID: 73,
        step: 'End Loop',
        block: { role: 'closer', start: 8, end: 10 },
      }),
    ).toBe('End Loop');
  });

  it('shows Loop’s flush even when it is the default', () => {
    // The correction the catalog paid for. The hand-written renderer wrote `Loop` bare
    // here, reasoning that `always` is what a Loop written with no keys reads back as,
    // so it could not be a choice anyone made. FileMaker writes all three out —
    // `Loop [ Flush: Always ]`, `Minimum`, `Defer` — and that is measured off the
    // owner's own script.
    expect(
      stepDisplayText({
        stepID: 71,
        step: 'Loop',
        block: { role: 'opener', start: 8, end: 10 },
        flush: 'always',
        collapsed: false,
        flags: 256,
      }),
    ).toBe('Loop [ Flush: Always ]');
    expect(stepDisplayText({ stepID: 71, step: 'Loop', flush: 'defer' })).toBe(
      'Loop [ Flush: Defer ]',
    );
  });

  it('prints a flush value the catalog has no word for, under the measured label', () => {
    // THE CORRECTION THIS ROUND. A value outside the measured set has no display form, and
    // the renderer used to answer that by printing nothing at all — so a step the CLI
    // described fully came out as a bare name. The label is measured and the value is in
    // hand; only FileMaker's word for the value is missing, so that is all that is missing
    // from the line. The round-trip still counts the gap and names the key, which is how a
    // missing display form stays work rather than becoming invisible.
    expect(stepDisplayText({ stepID: 71, step: 'Loop', flush: 'sideways' })).toBe(
      'Loop [ Flush: sideways ]',
    );
  });

  it('renders a disabled If, which the CLI reports with no block role, unchanged', () => {
    // `disabled` is drawn as a marker on the row, never as one of the step's options —
    // the row is what says FileMaker skips this step.
    expect(stepDisplayText({ stepID: 68, step: 'If', condition: '1', disabled: true })).toBe(
      'If [ 1 ]',
    );
  });
});

/** The owner, asked whether FileMaker prints the label of an option it has no value for:
 *
 *   > "FM is inconsistent here but often does print an option with no value set. So we
 *   > should."
 *
 *  So an option the CLI does not report still prints its slot. Two forms, and the second
 *  is the one that needed the renderer to change: a LABELLED slot already had `Label:` to
 *  print, while a slot with no label at all is an empty string, which the assembly drops
 *  as "print nothing for this key". Every line below is FileMaker's own, from the corpus. */
describe('the empty option slot, on the owner’s ruling', () => {
  it('prints a labelled slot for a key the CLI does not report', () => {
    // script 55 step 69. `errorMessage` is absent and FileMaker still prints its label.
    expect(
      stepDisplayText({
        stepID: 207,
        step: 'Revert Transaction',
        'hasCondition': true,
        condition: '1=1',
        'hasErrorCode': true,
        'errorCode': '5000',
      }),
    ).toBe('Revert Transaction [ Condition: 1=1 ; Error Code: 5000 ; Error Message: ]');
  });

  it('prints an unlabelled slot, and does not pad the bracket against it', () => {
    // script 55 step 763. Both `path` (no label) and `target` are absent, so the line
    // opens on an empty slot: FileMaker writes `[ ; Target: ]`, not `[  ; Target: ]`.
    expect(stepDisplayText({ stepID: 188, step: 'Get File Exists' })).toBe(
      'Get File Exists [ ; Target: ]',
    );
  });

  it('prints the unlabelled slot beside an option that does render', () => {
    // script 55 step 771.
    expect(
      stepDisplayText({ stepID: 190, step: 'Create Data File', 'createFolders': false }),
    ).toBe('Create Data File [ ; Create folders: Off ]');
  });

  it('still prints nothing for a value FileMaker was measured to omit', () => {
    // The empty slot must not be reachable from `omittedValues`: a repetition of 1 prints
    // NOTHING, not an empty option. Both go through an empty text and only one is a slot.
    expect(
      stepDisplayText({ stepID: 141, step: 'Set Variable', name: '$n', value: '1', repetition: '1' }),
    ).toBe('Set Variable [ $n ; Value: 1 ]');
  });
});

/** FileMaker's word for one value of a key that otherwise prints its value as it stands.
 *  `values` on `bare` and `labelled` is an OVERRIDE, so the untouched values must still
 *  come through unchanged — that is what makes it safe on a file this catalog never saw. */
describe('a value FileMaker prints its own word for', () => {
  it('writes Zoom In for the code, and the percentages as they stand', () => {
    // script 55 steps 669-678: eight percentages print bare, two codes do not.
    expect(stepDisplayText({ stepID: 97, step: 'Set Zoom Level', lock: true, zoom: 'zoomIn' })).toBe(
      'Set Zoom Level [ Lock: On ; Zoom In ]',
    );
    expect(stepDisplayText({ stepID: 97, step: 'Set Zoom Level', lock: true, zoom: '150%' })).toBe(
      'Set Zoom Level [ Lock: On ; 150% ]',
    );
  });

  it('prints a zoom level these scripts never used, rather than nothing for it', () => {
    // The reason the map is an override and not an enum: an unlisted value must still
    // print. Not in the corpus — this pins the DIRECTION the owner ruled on.
    expect(stepDisplayText({ stepID: 97, step: 'Set Zoom Level', zoom: '500%' })).toBe(
      'Set Zoom Level [ 500% ]',
    );
  });

  it('writes Geofence under the label the key already owns', () => {
    // script 55 step 23. `iBeacon` prints as itself in eight examples; `geoLocation` does not.
    expect(
      stepDisplayText({ stepID: 185, step: 'Configure Region Monitor Script', monitor: 'geoLocation' }),
    ).toBe('Configure Region Monitor Script [ Monitor: Geofence ]');
    expect(
      stepDisplayText({ stepID: 185, step: 'Configure Region Monitor Script', monitor: 'iBeacon' }),
    ).toBe('Configure Region Monitor Script [ Monitor: iBeacon ]');
  });

  it('writes Insert File’s third storage setting, which no example anchored', () => {
    // script 55 step 328. `Insert` shares no word with `embedOnly`, and counting could not
    // reach it: three of the step's keys were still unplaced.
    expect(
      stepDisplayText({
        stepID: 131,
        step: 'Insert File',
        target: '$Target',
        path: ['$Path'],
        storage: 'embedOnly',
        compress: 'userChoice',
        display: 'iconWithFilename',
      }),
    ).toBe('Insert File [ Insert ; Target: $Target ; “$Path” ]');
  });
});

describe('an option whose label points at one key and whose value comes from another', () => {
  it('writes Return count from the key that holds the count, not from the switch', () => {
    // script 55 step 930. The label spells the boolean `returnCount`, which cannot
    // produce a calculation; the text is `count`'s value, and `count` is reported in
    // exactly the five examples FileMaker shows the option in.
    expect(
      stepDisplayText({
        stepID: 218,
        step: 'Perform Semantic Find',
        query: 'text',
        records: 'allRecords',
        count: '$n',
        'returnCount': true,
      }),
    ).toBe('Perform Semantic Find [ Query by: Natural language ; Record set: All records ; Return count: $n ]');
  });

  it('writes nothing for the switch when the count is not there', () => {
    // script 55 steps 925-929: `return count: false`, no `count`, no option.
    expect(
      stepDisplayText({
        stepID: 218,
        step: 'Perform Semantic Find',
        query: 'text',
        records: 'allRecords',
        'returnCount': false,
      }),
    ).toBe('Perform Semantic Find [ Query by: Natural language ; Record set: All records ]');
  });
});

/** An option FileMaker prints because the CLI reports something, not because of any value
 *  it holds — and, on the same step, another option FileMaker DROPS for the same reason.
 *  Measured on `Go to Related Record`, whose new-window settings are five values the CLI
 *  reports without naming: script 55 steps 230-234. */
describe('an option that follows from a value the CLI does not name', () => {
  const RELATED = {
    stepID: 74,
    step: 'Go to Related Record',
    target: 'currentLayout',
    from: 'Contacts',
    'showOnlyRelatedRecords': true,
    animation: 19,
  } as ScriptDetailStep;

  it('writes New window and drops the animation while a window is configured', () => {
    expect(
      stepDisplayText({
        ...RELATED,
        slots: { calc: { 0: '"a window"', 1: '100', 2: '100', 3: '100', 4: '100' } },
      }),
    ).toBe(
      'Go to Related Record [ Show only related records ; From table: “Contacts” ; ' +
        'Using layout: <Current Layout> ; New window ]',
    );
  });

  it('writes the animation and no New window when there is none', () => {
    expect(stepDisplayText(RELATED)).toBe(
      'Go to Related Record [ Show only related records ; From table: “Contacts” ; ' +
        'Using layout: <Current Layout> ; Animation: Cross Dissolve ]',
    );
  });

  it('does not read the window name as the reason the option appears', () => {
    // The fact withdrawn to get here: in five examples the window's own name happened to
    // be the same words FileMaker prints for this option, so the matcher paired the value
    // with the option. Any other name must give the same option.
    expect(
      stepDisplayText({ ...RELATED, slots: { calc: { 0: '$w', 1: '1', 2: '1', 3: '1', 4: '1' } } }),
    ).toContain('New window');
  });
});

describe('steps whose old rendering was known to be wrong', () => {
  it('says how a script was specified, and quotes nothing the CLI did not send', () => {
    // The design spec named this step and `Go to Layout` as two the convention got
    // wrong. `Specified: By name` is a measured option whose text follows from WHICH
    // keys the CLI reports rather than from any value, and the script name is quoted
    // because FileMaker quotes it. `onError` is a key none of the four measured examples
    // carries, so the catalog says nothing about it and the convention appends it last.
    expect(
      stepDisplayText({
        stepID: 1,
        step: 'Perform Script',
        uuid: '95F0A919',
        'scriptName': '"Other"',
        parameter: '"p"',
        'onError': 'exit',
        flags: 18432,
      }),
    ).toBe('Perform Script [ Specified: By name ; "Other" ; Parameter: "p" ; On error: exit ]');
  });

  it('writes Go to Layout’s target as FileMaker’s own words, and its animation', () => {
    expect(stepDisplayText({ stepID: 6, step: 'Go to Layout', target: 'originalLayout' })).toBe(
      'Go to Layout [ original layout ; Animation: None ]',
    );
  });

  it('shows a triState that is on as its state alone', () => {
    expect(
      stepDisplayText({ stepID: 86, step: 'Set Error Capture', on: true, flags: 196608 }),
    ).toBe('Set Error Capture [ On ]');
  });

  it('drops the dialog keys FileMaker was measured not to show', () => {
    // Fifteen keys of this step are in the catalog's `ignored` list, each with the
    // number of examples that reported it and showed nothing for it. The button texts
    // are among them.
    expect(
      stepDisplayText({
        stepID: 87,
        step: 'Show Custom Dialog',
        title: '"Hi"',
        message: '"there"',
        'input1Password': false,
        'button1Text': 'OK',
        'button1Commit': false,
        'autoClose': false,
        flags: 16388,
      }),
    ).toBe('Show Custom Dialog [ "Hi" ; "there" ]');
  });

  it('uses FileMaker’s displayed name where it differs from the CLI’s', () => {
    // Measured: the CLI reports `Page Setup` and FileMaker writes `Print Setup`.
    expect(stepDisplayText({ stepID: 100, step: 'Page Setup' })).toBe('Print Setup');
  });

  it('writes a plugin step’s options under the CLI’s name for it', () => {
    // FileMaker shows the installed plugin's registered name, which no step's JSON can
    // supply — so the round-trip refuses to count this row at all. A read sheet still
    // draws it: a name we can defend beside options we measured beats a blank row.
    expect(
      stepDisplayText({
        stepID: 200,
        step: 'ExternalStep',
        slots: { calc: { '0': 'Plugin_Function', '1': '"x"' } },
      }),
    ).toBe('ExternalStep [ Function: Plugin_Function ; P1: "x" ]');
  });
});

describe('the convention fallback, for a step type the catalog has never seen', () => {
  it('labels a value and keeps the key order the body reports', () => {
    expect(stepDisplayText({ stepID: 5, step: 'Odd', animation: 3 })).toBe('Odd [ Animation: 3 ]');
  });

  it('writes a step with no options at all as its bare name', () => {
    expect(stepDisplayText({ stepID: 999, step: 'Commit Records/Requests' })).toBe(
      'Commit Records/Requests',
    );
  });

  it('names an unnamed step by its id rather than rendering a blank row', () => {
    expect(stepDisplayText({ stepID: 4242, step: '' })).toBe('Step 4242');
  });

  it('shows an unexpected object value as JSON rather than as [object Object]', () => {
    expect(stepDisplayText({ stepID: 5, step: 'Odd', thing: { a: 1 } })).toBe(
      'Odd [ Thing: {"a":1} ]',
    );
  });

  it('takes the label from the catalog where the catalog measured one', () => {
    // The point of a catalog-backed fallback: the inferred rule would write
    // `Verify SSL certificates`, and FileMaker capitalises all three words. That
    // spelling was read off FileMaker's own line, on another step type.
    expect(stepDisplayText({ stepID: 5, step: 'Odd', 'verifySslCertificates': true })).toBe(
      'Odd [ Verify SSL Certificates ]',
    );
  });

  it('writes a key bare when every step type the catalog measured writes it bare', () => {
    expect(stepDisplayText({ stepID: 5, step: 'Odd', calculation: '1+1' })).toBe('Odd [ 1+1 ]');
  });
});

/** FileMaker masks a password in its step display and the CLI does not, so this is the
 *  one thing in this module that is not cosmetic: the read sheet renders scripts from
 *  files this catalog was never derived from, and a script hard-coding a literal
 *  password must not have it printed. The masked key set is derived from the catalog,
 *  and every path — a measured segment, a step type the catalog covers but whose key it
 *  does not list, and a step type it has never seen — is asserted here. */
describe('a masked value never reaches the output', () => {
  const SECRET = 'S3cret!Literal';

  it('shows the mask instead of the value on a step measured to mask it', () => {
    const line = stepDisplayText({
      stepID: 138,
      step: 'Change Password',
      old: SECRET,
      new: SECRET,
    });
    expect(line).toBe(`Change Password [ Old Password: ${STEP_MASK} ; Password: ${STEP_MASK} ]`);
    expect(line).not.toContain(SECRET);
  });

  it('masks on a step type the catalog has never seen, by key alone', () => {
    // The fallback cannot consult a segment, so it consults the key set. A key FileMaker
    // masks on one step is a secret wherever it appears.
    const line = stepDisplayText({ stepID: 5, step: 'Some Step From A Later FileMaker', password: SECRET });
    expect(line).toBe(`Some Step From A Later FileMaker [ Password: ${STEP_MASK} ]`);
    expect(line).not.toContain(SECRET);
  });

  it('masks a key the catalog does not list on this step, which is now appended', () => {
    // The third way in, and the reason the mask is checked by KEY and not only by segment:
    // an unlisted key is no longer dropped, so on a covered step type a masked key reaches
    // the convention — which masks it before reading the value.
    const line = stepDisplayText({ stepID: 141, step: 'Set Variable', name: '$x', password: SECRET });
    expect(line).toBe(`Set Variable [ $x ; Password: ${STEP_MASK} ]`);
    expect(line).not.toContain(SECRET);
  });

  it('masks a masked key nested inside another key’s value, at any depth', () => {
    // THE HOLE A REVIEW FOUND. `Bag` is not a masked key, so the convention serialised its
    // whole value — and the module's doc claimed no key the catalog fails to list could put
    // a masked value on screen. Every key of every object is tested now, at any depth,
    // inside an array as much as inside an object. No shape in the 1203 measured examples
    // reaches this; the app renders files the catalog was never derived from, which is the
    // population the mask exists for.
    const nested: ScriptDetailStep[] = [
      { stepID: 141, step: 'Set Variable', name: '$x', bag: { password: SECRET } },
      { stepID: 999, step: 'Unknown Zz', deep: { a: { b: { password: SECRET } } } },
      { stepID: 999, step: 'Unknown Zz', things: ['a', { old: SECRET }] },
      { stepID: 999, step: 'Unknown Zz', list: [{ deeper: [{ new: SECRET }] }] },
    ];
    for (const step of nested) {
      const line = stepDisplayText(step);
      expect(line).not.toContain(SECRET);
      expect(line).toContain(STEP_MASK);
    }
  });

  it('masks a masked key however it is spelled in case', () => {
    // The set is derived from one corpus, which spells it `password`. A file this catalog
    // was never derived from can spell it `Password`, and a name-exact test let a literal
    // through. Case-insensitive costs nothing measured: no key in the corpus differs from a
    // masked key only in case.
    const line = stepDisplayText({ stepID: 137, step: 'Add Account', Password: SECRET });
    expect(line).not.toContain(SECRET);
    expect(line).toContain(STEP_MASK);
  });

  it('leaks nothing through any shape a step can arrive in', () => {
    // One assertion over the whole surface, because the guarantee is about the module
    // rather than about a step type: whatever the shape, the literal is not on screen.
    const shapes: ScriptDetailStep[] = [
      { stepID: 137, step: 'Add Account', account: '$a', password: SECRET },
      { stepID: 137, step: 'Add Account', account: '$a', password: SECRET, 'accountType': '1' },
      { stepID: 139, step: 'Re-Login', account: '$a', password: SECRET },
      { stepID: 140, step: 'Reset Account Password', account: '$a', password: SECRET },
      { stepID: 138, step: 'Change Password', old: SECRET, new: SECRET },
      { stepID: 5, step: 'Unheard Of', password: SECRET, old: SECRET, new: SECRET },
      { stepID: 5, step: 'Unheard Of', password: [SECRET] },
      { stepID: 5, step: 'Unheard Of', password: { literal: SECRET } },
      { stepID: 141, step: 'Set Variable', name: '$x', new: SECRET },
      { stepID: 89, step: '#', text: SECRET, password: SECRET },
      { stepID: 89, step: '#', password: SECRET },
    ];
    for (const step of shapes) {
      const { name, detail } = stepDisplay(step);
      // The comment step's own TEXT is not a secret — it is the comment — so that one is
      // checked with the text removed. Its `password` is still masked: the comment path
      // appends an unaccounted key like every other, which is why it has no carve-out.
      const line = `${name} ${detail}`;
      expect(step.step === '#' ? line.replace(SECRET, '') : line).not.toContain(SECRET);
    }
  });
});

/** THE BASELINE. The renderer's authority to print used to be the catalog's authority to
 *  claim, so a value the derivation could not confidently place was not shown at all — 105
 *  of them on the 1203 measured examples. These pin the four ways in, and the two lines the
 *  baseline still does not cross. */
describe('a value the catalog cannot place is still printed', () => {
  it('prints a key the catalog ignored on one example only', () => {
    // `Trigger Claris Connect Flow`'s `authentication` is `ignored` with ONE example behind
    // it and the doubt recorded (`singleExample`). One example is never enough to place a
    // fact — and it is not enough to withhold a value either, which is the half that was
    // missing. FileMaker shows no such option here; his ruling covers that.
    expect(
      stepDisplayText({
        stepID: 194,
        step: 'Trigger Claris Connect Flow',
        flow: '$Flow',
        authentication: '1+1',
      }),
      // `JSON Data:` is the empty option slot FileMaker prints for a key the CLI does not
      // report, measured on this step type and unrelated to the baseline.
    ).toBe('Trigger Claris Connect Flow [ Flow: $Flow ; JSON Data: ; Authentication: 1+1 ]');
  });

  it('prints a key the derivation could not settle either way', () => {
    // `Perform JavaScript in Web Viewer`'s `arg1`/`arg2` are `unresolved` — `refuted`,
    // because FileMaker's line DID show their values and the matcher could not attribute
    // them. So the catalog's own record says the content is displayed, and printing nothing
    // for it was the worst of the three possible answers.
    expect(
      stepDisplayText({
        stepID: 174,
        step: 'Perform JavaScript in Web Viewer',
        'objectName': '$w',
        'function name': '$f',
        'arg1': '$p1',
        'arg2': '$p2',
      }),
    ).toBe(
      'Perform JavaScript in Web Viewer [ Object Name: $w ; Function name: $f ; Arg 1: $p1 ; Arg 2: $p2 ]',
    );
  });

  it('prints a value the CLI does not name, numbering it only when a member repeats', () => {
    // The plugin step's own arguments. One `text` slot keeps the short label; five `calc`
    // slots would otherwise be five options all called `Calc`, which reads as a bug.
    expect(
      stepDisplayText({
        stepID: 200,
        step: 'ExternalStep',
        slots: { calc: { '0': 'Fn', '1': '"a"', '5': '$P5', '6': '$P6' }, text: { '32': '$out' } },
      }),
    ).toBe('ExternalStep [ Function: Fn ; P1: "a" ; Calc 5: $P5 ; Calc 6: $P6 ; Text: $out ]');
  });

  it('prints the value under a measured label the catalog says it cannot reproduce', () => {
    // `labelledMismatch`: the catalog measured that FileMaker's text here is not derivable
    // from the CLI's value — one letter's case, on `Set Error Logging` — and used to answer
    // that by printing neither the label it knew nor the value it held.
    expect(
      stepDisplayText({
        stepID: 200,
        step: 'Set Error Logging',
        enabled: true,
        'customDebugInfo': 'Get ( CurrentHostTimeStamp )',
      }),
      // FileMaker's own line for this step, script 55 step 109, reads
      // `Set Error Logging [ On ; Custom debug info: Get ( CurrentHostTimestamp ) ]` — one
      // letter's case apart, which the round-trip files under the owner's ruling that a
      // value's case is not worth normalising. Before this it printed the first option only.
    ).toBe('Set Error Logging [ On ; Custom debug info: Get ( CurrentHostTimeStamp ) ]');
  });

  it('does not print an option a measured option on the same line already labels', () => {
    // The one shape the owner rejected outright, and the line the baseline must not cross:
    // FileMaker prints `Return count: $n` from the key holding the COUNT, and the boolean
    // switch is itself called `returnCount`. Printing both gives `Return count: $n ; Return
    // count` — the same option twice, which is a duplicate rather than an extra option.
    expect(
      stepDisplayText({
        stepID: 218,
        step: 'Perform Semantic Find',
        query: 'text',
        count: '$n',
        'returnCount': true,
      }),
    ).toBe('Perform Semantic Find [ Query by: Natural language ; Return count: $n ]');
  });

  it('still prints nothing for a key measured never to be shown', () => {
    // The other line: `button1Text` and `button3Text` are `ignored` at `measured`
    // confidence — observed twice, with nothing against them — so they stay unprinted. That
    // claim is a measurement of FileMaker, and this change deliberately does not reclassify
    // it. `button2Text` rests on ONE example and does print, which is the whole distinction
    // in one step type.
    expect(
      stepDisplayText({
        stepID: 87,
        step: 'Show Custom Dialog',
        title: '"Hi"',
        'button1Text': 'OK',
        'button3Text': 'Cancel',
        'autoClose': false,
      }),
    ).toBe('Show Custom Dialog [ "Hi" ]');
    expect(
      stepDisplayText({ stepID: 87, step: 'Show Custom Dialog', title: '"Hi"', 'button2Text': 'No' }),
    ).toBe('Show Custom Dialog [ "Hi" ; Button 2 text: No ]');
  });
});

/** The mask's surface grew with the baseline, so this is where that is pinned: the wide test
 *  is what a NEWLY printed value goes through, and the measured options are untouched by it. */
describe('the widened secret test', () => {
  const SECRET = 'S3cret!Literal';

  it('masks a compound password key the baseline would otherwise print', () => {
    // `Save Records as PDF`'s `editPassword` is `ignored` at `low` confidence, so the baseline
    // prints it — and the catalog does not mask it, because `masked` was only ever derived for
    // a key called `password`. The moment the baseline started printing values the catalog
    // could not place, a key whose NAME contains a masked one became a way out for a literal.
    // Nine such names exist in the corpus behind the catalog, all of them password-ish.
    for (const step of [
      { stepID: 128, step: 'Save Records as PDF', 'editPassword': SECRET },
      { stepID: 5, step: 'Unheard Of', 'Some Password Here': SECRET },
      { stepID: 5, step: 'Unheard Of', 'smtpPassword': SECRET },
    ] as ScriptDetailStep[]) {
      const line = stepDisplayText(step);
      expect(line).not.toContain(SECRET);
      expect(line).toContain(STEP_MASK);
    }
  });

  it('prints nothing at all for a password key measured never to be shown', () => {
    // `Send Mail`'s `smtpPassword` is `ignored` at `measured` confidence, so it does not reach
    // the baseline on that step type at all. Recorded because it is the safe side of a
    // decision the owner has not taken yet: if those claims are ever released to the baseline,
    // the test above is what stops this one becoming a leak.
    const line = stepDisplayText({ stepID: 133, step: 'Send Mail', 'smtpPassword': SECRET });
    expect(line).not.toContain(SECRET);
    expect(line).toBe('Send Mail');
  });

  it('masks through every path the baseline opened, at any depth', () => {
    // The baseline prints three kinds of value nothing printed before — a value the CLI does
    // not NAME, a segment's own value where its display form is missing, and an option whose
    // host never rendered — so each is a new way out for a literal. Asserted over all of them
    // rather than per case, because the guarantee is about the module.
    const shapes: ScriptDetailStep[] = [
      // a value the CLI does not name, holding a masked key at depth
      { stepID: 141, step: 'Set Variable', name: '$x', slots: { calc: { 0: { password: SECRET } } } },
      { stepID: 9, step: 'Zz Unknown', slots: { calc: { 0: { deep: [{ Password: SECRET }] } } } },
      // a segment whose measured display form is missing, falling back to the value
      { stepID: 128, step: 'Save Records as PDF', 'openPassword': SECRET },
      { stepID: 71, step: 'Loop', flush: { password: SECRET } },
      // a suffix whose host option rendered nothing, printed as an option of its own
      { stepID: 141, step: 'Set Variable', repetition: '5', password: SECRET },
      // the comment path, which returns before the rest of the assembly
      { stepID: 89, step: '#', text: 'note', bag: { old: SECRET } },
    ] as unknown as ScriptDetailStep[];
    for (const step of shapes) {
      const line = stepDisplayText(step);
      expect(line).not.toContain(SECRET);
      expect(line).toContain(STEP_MASK);
    }
    // And the mask says WHAT is hidden even where the segment prints no label of its own.
    expect(stepDisplayText({ stepID: 128, step: 'Save Records as PDF', 'openPassword': SECRET })).toBe(
      `Save Records as PDF [ Open password: ${STEP_MASK} ]`,
    );
  });

  it('does not mask a word inside a longer word', () => {
    // `old` and `new` are masked key names on `Change Password`, and a substring test would
    // swallow `threshold`, `createFolders` and `allowFolderCreation`. Measured: word
    // matching adds nine names to the set and neither `old` nor `new` adds any. The label here
    // is the catalog's measured one for the key, which is beside the point being pinned: the
    // VALUE comes through.
    expect(stepDisplayText({ stepID: 5, step: 'Unheard Of', threshold: '0.5' })).toContain('0.5');
    expect(stepDisplayText({ stepID: 5, step: 'Unheard Of', 'createFolders': 'x' })).toContain('x');
  });

  it('leaves a measured option that prints no value alone', () => {
    // `Add Account`'s `expirePassword` is a measured `bareWhenTrue`: FileMaker prints the
    // option's own name and never a value, so there is nothing to mask, and masking it would
    // replace a measured option with a mask for nothing.
    expect(
      stepDisplayText({ stepID: 137, step: 'Add Account', account: '$a', 'expirePassword': true }),
    ).toContain('Expire password');
  });
});

describe('keyLabel', () => {
  it('uses the label FileMaker was measured to print', () => {
    expect(keyLabel('verifySslCertificates')).toBe('Verify SSL Certificates');
  });

  it('prefers the label of the step type it is given', () => {
    // `dataSource` is labelled four ways across the catalog, so it has no global
    // answer; on this step type FileMaker prints it inside the script option as
    // `from file`.
    expect(keyLabel('dataSource', 'Perform Script')).toBe('from file');
  });

  it('falls back to the inferred rule for a key the catalog never labels', () => {
    expect(keyLabel('some key no FileMaker has')).toBe('Some key no FileMaker has');
    expect(keyLabel('value')).toBe('Value');
  });

  it('leaves FileMaker’s own lower-case acronym alone', () => {
    // fm 0.7.0 spells the key `curlOptions` and no longer carries FileMaker's `cURL`
    // anywhere, so the acronym survives ONLY because the label is MEASURED — the
    // inferred rule is not consulted at all, and could not produce it if it were. That
    // is the whole reason the labels are measured rather than derived from key names.
    expect(keyLabel('curlOptions')).toBe('cURL options');
    // A key the catalog never labels, which is the only way to reach the inferred rule:
    // it must not capitalise a key whose second character already is, and it must leave
    // a key that is not the CLI's own identifier shape (this one carries spaces) alone.
    expect(keyLabel('xYZ setting no FileMaker has')).toBe('xYZ setting no FileMaker has');
  });

  it('spells a 0.7.0 camelCase key as words for a key the catalog never labels', () => {
    // `withDialog` IS labelled by the catalog, so the rule is reached with a key no
    // FileMaker reports. fm 0.7.0 made every multi-word key camelCase, so the inferred
    // rule has to read the capital as the word boundary a space used to be: without
    // this, a consumer printed `someUnmeasuredThing: On` at a user.
    expect(keyLabel('someUnmeasuredThing')).toBe('Some unmeasured thing');
    expect(keyLabel('unmeasuredArg2')).toBe('Unmeasured arg 2');
  });

  it('leaves an already-capitalised key alone', () => {
    expect(keyLabel('Target')).toBe('Target');
  });

  it('survives an empty key', () => {
    expect(keyLabel('')).toBe('');
  });
});

/** The renderer runs on whatever a live `read:script` hands over, and a crash here takes
 *  out the read sheet's whole step list. These are the shapes that used to do it. */
describe('a step no one predicted still renders', () => {
  it('renders a step named after an Object.prototype member', () => {
    // `CATALOG` is a JSON module, so it inherits `Object.prototype`: a bare
    // `CATALOG[step.step]` answered a truthy non-entry for each of these and the renderer
    // died iterating `entry.segments`. Unreachable from FileMaker's fixed vocabulary,
    // reachable from any hand-built or proxied body.
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf']) {
      expect(stepDisplayText({ stepID: 1, step: name })).toBe(name);
    }
  });

  it('renders a circular structure and a BigInt rather than throwing', () => {
    // `JSON.stringify` throws on both. Neither can come out of `JSON.parse`, so neither is
    // reachable from a wire body — but "never throws" is unconditional, and the convention
    // is the path that has to serialise a value it knows nothing about.
    const circular: Record<string, unknown> = { stepID: 1, step: 'Unknown Zz' };
    circular.loop = circular;
    expect(stepDisplayText(circular as ScriptDetailStep)).toContain('(circular)');
    expect(
      stepDisplayText({ stepID: 1, step: 'Unknown Zz', n: 10n } as unknown as ScriptDetailStep),
    ).toBe('Unknown Zz [ N: "10" ]');
  });

  it('keeps printing an object value as JSON, as it did before', () => {
    // The serialiser is not `JSON.stringify` any more, so this pins the agreement on the
    // shapes the CLI actually sends.
    expect(stepDisplayText({ stepID: 5, step: 'Odd', thing: { a: 1, b: [1, 'x', true, null] } })).toBe(
      'Odd [ Thing: {"a":1,"b":[1,"x",true,null]} ]',
    );
  });
});

describe('hiddenWhen, the option FileMaker stops printing', () => {
  it('prints no password option at all for an external account', () => {
    // Measured on `Add Account`: the account type decides three things at once, and one of
    // them is that the password option disappears. Its failure mode is not a leak — the
    // value stays masked — but a `Password: ••••••••` FileMaker does not print at all, and
    // the byte-identical floor cannot see it (it costs exactly one exact row).
    const external = stepDisplayText({
      stepID: 137,
      step: 'Add Account',
      account: '$a',
      password: '$p',
      'accountType': '1',
    });
    expect(external).not.toContain('Password');
    expect(external).toContain('Authenticate via: External Server');
    // The same step without the deciding key keeps its password option, masked.
    expect(stepDisplayText({ stepID: 137, step: 'Add Account', account: '$a', password: '$p' })).toContain(
      `Password: ${STEP_MASK}`,
    );
  });
});

/** THE 0.7.0 KEY RENAME, from both sides.
 *
 *  fm 0.7.0 respelled every multi-word option key in camelCase, and the catalog is keyed
 *  on the key the CLI sends — so what a consumer gets depends on which fm wrote the step
 *  it is holding. Both sides are pinned here because the first is the contract and the
 *  second is the failure mode: a consumer still on 0.6.0 does not get an error, it gets a
 *  quieter line, and that is worth seeing in a test rather than in a bug report. */
describe('a step as fm 0.7.0 reports it', () => {
  // Script 55 step 547 of the corpus, verbatim, minus the uuid and the slots.
  const PDF: ScriptDetailStep = {
    stepID: 144,
    step: 'Save Records as PDF',
    records: 'browsedRecords',
    withDialog: true,
    createFolders: false,
    openAutomatically: false,
    createEmail: false,
    appendToExistingPdf: false,
    restore: false,
  };

  it('renders every camelCase option the catalog measured', () => {
    expect(stepDisplayText(PDF)).toBe(
      'Save Records as PDF [ Create folders: Off ; With dialog: On ; Records being browsed ]',
    );
  });

  it('leaves no gap and takes nothing from the baseline', () => {
    const { gaps, baseline, contributed } = renderStepFromCatalog(
      PDF,
      catalogEntry(CATALOG, 'Save Records as PDF')!,
      stepConventions(CATALOG),
    );
    // No segment produced nothing, and no key fell through to the convention: every
    // option on that line is a measured fact about `withDialog` and `createFolders`.
    expect(gaps).toEqual([]);
    expect(baseline).toEqual([]);
    expect(contributed).toEqual(['createFolders', 'withDialog', 'records']);
  });
});

describe('a step an older fm reported', () => {
  // A SUBSET of the same step as fm 0.6.0 spelled it: the three keys that render nothing
  // here either way (`open automatically`, `create email`, `append to existing file`, all
  // false) are left out, so what the assertions below name is the whole of what is left.
  // Nothing aliases the old names back: the catalog says what was MEASURED, and measuring
  // 0.7.0 is not a licence to assert 0.6.0.
  const OLD: ScriptDetailStep = {
    stepID: 144,
    step: 'Save Records as PDF',
    records: 'browsedRecords',
    'with dialog': true,
    'create folders': false,
    restore: false,
  };

  it('prints the old key from the BASELINE, which is the visible signal', () => {
    const { baseline, contributed, gaps } = renderStepFromCatalog(
      OLD,
      catalogEntry(CATALOG, 'Save Records as PDF')!,
      stepConventions(CATALOG),
    );
    // `gaps` is for a measured segment that produced nothing, and no segment is keyed on
    // `with dialog` any more, so the key cannot reach one. What it reaches instead is
    // `baseline` — the renderer's own record of an option it printed by convention rather
    // than by measurement — and that IS the signal: a consumer asking how much of a line
    // is measured sees this key named.
    expect(gaps).toEqual([]);
    expect(baseline).toEqual(['with dialog']);
    expect(contributed).toEqual(['records', 'with dialog']);
  });

  it('shows what the old spelling costs: a coarser option, and a lost one', () => {
    // `With dialog` without its `: On`, because the measured `labelledState` render is
    // keyed on `withDialog` and the baseline knows only that the flag is true. And
    // `create folders: false` prints NOTHING: the baseline drops a false flag, where the
    // measured segment would have written `Create folders: Off`. Neither is an error, and
    // that is exactly why it is pinned.
    expect(stepDisplayText(OLD)).toBe('Save Records as PDF [ Records being browsed ; With dialog ]');
    expect(stepDisplayText(OLD)).not.toContain('Create folders');
  });
});
