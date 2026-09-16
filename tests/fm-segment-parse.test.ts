import { describe, it, expect } from 'vitest';
import { bracketContent, displayKeys, expandSlots, labelCandidates, matchSegments, parseSlotID, slotID } from '../scripts/fm-segment-parse.mjs';

/** The module is plain ESM with no types, so `matchSegments` returns `any`.
 *  Naming the segment shape here keeps the callbacks below type-checked. */
type Segment = {
  key: string;
  render: string;
  label: string | null;
  value: string;
  quoted?: boolean;
  truncated?: boolean;
  attributed?: string;
  inlineOf?: string;
};

describe('bracketContent', () => {
  it('returns what is inside the outer brackets', () => {
    expect(bracketContent('If [ 1=1 ]', 'If')).toBe('1=1');
  });

  it('keeps nested brackets and semicolons intact', () => {
    const line = 'Set Variable [ $c ; Value: Let( [ _a = 1 ; _b = 2 ]; _a ) ]';
    expect(bracketContent(line, 'Set Variable')).toBe('$c ; Value: Let( [ _a = 1 ; _b = 2 ]; _a )');
  });

  it('returns null for a step rendered without brackets', () => {
    expect(bracketContent('End If', 'End If')).toBeNull();
    expect(bracketContent('Else', 'Else')).toBeNull();
  });

  it('returns an empty string for empty brackets', () => {
    expect(bracketContent('If [    ]', 'If')).toBe('');
  });
});

describe('labelCandidates', () => {
  it('includes the key verbatim', () => {
    expect(labelCandidates('curlOptions')).toContain('curlOptions');
  });

  it('includes a leading-capital form', () => {
    expect(labelCandidates('withDialog')).toContain('With dialog');
  });

  it('includes a start-case form for a multi-word key', () => {
    expect(labelCandidates('verifySslCertificates')).toContain('Verify Ssl Certificates');
  });

  it('splits a camelCase key at its humps and its digits', () => {
    // fm 0.7.0 spells a multi-word key in camelCase, so the word boundary that used to
    // be a space is now a capital — and a numbered key (`input 1` -> `input1`) needs the
    // digit read as a boundary too, or `Input 1:` is never found.
    expect(labelCandidates('withDialog')).toContain('with Dialog');
    expect(labelCandidates('input1Label')).toContain('Input 1 label');
  });

  it('finds a label whose capitals the 0.7.0 key can no longer spell', () => {
    // `verifySslCertificates` cannot produce `SSL`, so pass 1 matches the label with
    // case folded away and records the capitals FileMaker actually printed.
    const step = { stepID: 160, step: 'Insert from URL', verifySslCertificates: true };
    const { segments } = matchSegments(
      step,
      'Insert from URL [ Verify SSL Certificates: On ]',
      'Insert from URL',
    );
    expect(segments).toEqual([
      {
        key: 'verifySslCertificates',
        render: 'labelledState',
        label: 'Verify SSL Certificates',
        value: 'On',
      },
    ]);
  });
});

describe('matchSegments — the Insert from URL ground truth', () => {
  // Measured from the owner's live file. FileMaker renders this step exactly as below.
  const step = {
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
  const line =
    'Insert from URL [ Select ; With dialog: Off ; Target: $result ; $url ; Verify SSL Certificates ; cURL options: $cURL_options ]';

  it('recovers the key order FileMaker uses', () => {
    const { segments } = matchSegments(step, line, 'Insert from URL');
    expect(segments.map((s: Segment) => s.key)).toEqual([
      'select',
      'withDialog',
      'target',
      'url',
      'verifySslCertificates',
      'curlOptions',
    ]);
  });

  it('classifies each render kind', () => {
    const { segments } = matchSegments(step, line, 'Insert from URL');
    const byKey = Object.fromEntries(segments.map((s: Segment) => [s.key, s.render]));
    expect(byKey.select).toBe('bareWhenTrue');
    expect(byKey['withDialog']).toBe('labelledState');
    expect(byKey.target).toBe('labelled');
    expect(byKey.url).toBe('bare');
    expect(byKey['verifySslCertificates']).toBe('bareWhenTrue');
    expect(byKey['curlOptions']).toBe('labelled');
  });

  it('reports the key FileMaker never shows as ignored, not unmatched', () => {
    const { unmatched, ignoredKeys } = matchSegments(step, line, 'Insert from URL');
    expect(unmatched).toEqual([]);
    expect(ignoredKeys).toContain('curlOptionsSpecified');
  });
});

describe('matchSegments — a calculation containing the segment separator', () => {
  it('does not shred a calc that itself contains " ; "', () => {
    const step = {
      stepID: 141,
      step: 'Set Variable',
      name: '$c',
      value: 'Let(\r[\r_a = 1 ;\r_b = If ( x = 1 ; 2 ; 3 )\r];\r_a )',
    };
    const line = 'Set Variable [ $c ; Value: Let( [ _a = 1 ; _b = If ( x = 1 ; 2 ; 3 ) ]; _a ) ]';
    const { segments, unmatched } = matchSegments(step, line, 'Set Variable');
    expect(unmatched).toEqual([]);
    expect(segments.map((s: Segment) => s.key)).toEqual(['name', 'value']);
    expect(segments.find((s: Segment) => s.key === 'value').render).toBe('labelled');
    expect(segments.find((s: Segment) => s.key === 'name').render).toBe('bare');
  });
});

describe('matchSegments — a step with no bracket', () => {
  it('yields no segments and no unmatched content', () => {
    const { segments, unmatched } = matchSegments({ stepID: 70, step: 'End If' }, 'End If', 'End If');
    expect(segments).toEqual([]);
    expect(unmatched).toEqual([]);
  });
});

describe('matchSegments — a masked password', () => {
  // FileMaker masks a password in its step display; the CLI reports the value.
  // Values here are variable names, as in the owner's data, but the point is
  // that a hard-coded literal must never reach a rendered line either.
  const step = {
    stepID: 141,
    step: 'Add Account',
    account: '$account_var',
    password: '$password_var',
    'expirePassword': true,
  };
  const line =
    'Add Account [ Authenticate via: FileMaker ; Account Name: $account_var ; Password: •••••••• ; Privilege Set: [Data Entry Only] ; Expire password ]';

  it('classifies a bullet-run value as masked, not as the value', () => {
    const { segments } = matchSegments(step, line, 'Add Account');
    const password = segments.find((s: Segment) => s.key === 'password');
    expect(password.render).toBe('masked');
    expect(password.value).not.toContain('$password_var');
  });

  it('never lets a hard-coded password reach any part of the result', () => {
    // The security property, pinned on a literal rather than a variable name and
    // on the WHOLE result: a future change that routed the value into
    // `unmatched` instead of a segment would still be a leak.
    const withLiteral = { stepID: 141, step: 'Add Account', account: 'acct', password: 'hunter2' };
    const rendered = 'Add Account [ Account Name: acct ; Password: •••••••• ]';
    const result = matchSegments(withLiteral, rendered, 'Add Account');
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(result.segments.find((s: Segment) => s.key === 'password').render).toBe('masked');
  });

  it('discovers a label FileMaker does not derive from the key', () => {
    const { segments } = matchSegments(step, line, 'Add Account');
    const account = segments.find((s: Segment) => s.key === 'account');
    expect(account.render).toBe('labelled');
    expect(account.label).toBe('Account Name');
  });

  it('reports content the CLI does not report as unmatched', () => {
    const { unmatched } = matchSegments(step, line, 'Add Account');
    // The CLI reports no key for either of these, so they must surface rather
    // than be attached to a key that does not own them.
    expect(unmatched).toContain('Authenticate via: FileMaker');
    expect(unmatched).toContain('Privilege Set: [Data Entry Only]');
  });

  it('still places the boolean rendered as its own label', () => {
    const { segments } = matchSegments(step, line, 'Add Account');
    expect(segments.find((s: Segment) => s.key === 'expirePassword').render).toBe('bareWhenTrue');
  });
});

describe('matchSegments — enum kinds the data forced', () => {
  it('attributes a display name by the words it shares with the key’s code', () => {
    const step = { stepID: 78, step: 'Adjust Window', state: 'resizeToFit', flags: 2 };
    const { segments, unmatched } = matchSegments(step, 'Adjust Window [ Resize to Fit ]', 'Adjust Window');
    expect(unmatched).toEqual([]);
    // `attributed` records what placed it, so the next task can weigh an
    // attribution below an anchored segment.
    expect(segments).toEqual([
      { key: 'state', render: 'enum', label: null, value: 'Resize to Fit', attributed: 'valueWords' },
    ]);
  });

  it('falls back to counting when nothing but the key is left', () => {
    // The CLI reports this option only as an unnamed number, so no word can
    // connect it to `To Selection` — but there is nothing else it could be.
    const step = { stepID: 60, step: 'Scroll Window', stepValue: 5, flags: 2 };
    const { segments, unmatched } = matchSegments(step, 'Scroll Window [ To Selection ]', 'Scroll Window');
    expect(unmatched).toEqual([]);
    expect(segments).toEqual([
      { key: 'stepValue', render: 'enum', label: null, value: 'To Selection', attributed: 'sole' },
    ]);
  });

  it('separates a labelled display name from a labelled value', () => {
    // `flush: "always"` renders as `Flush: Always`: the label is the key's, but
    // the text is a display form of the value, so a renderer cannot print the
    // value verbatim.
    const step = { stepID: 141, step: 'Loop', flush: 'always', collapsed: false };
    const { segments } = matchSegments(step, 'Loop [ Flush: Always ]', 'Loop');
    expect(segments).toEqual([
      { key: 'flush', render: 'labelledEnum', label: 'Flush', value: 'Always' },
    ]);
  });

  it('keeps a value the Script Workspace and the CLI disagree about out of labelled', () => {
    // The CLI reports `<Function Missing>` for a plugin function the Script
    // Workspace spells out. Claiming a match would hide a real disagreement.
    const step = { stepID: 141, step: 'Set Variable', name: '$c', value: '<Function Missing> ( 1 )' };
    const line = 'Set Variable [ $c ; Value: BE_CurlTrace ( 1 ) ]';
    const { segments } = matchSegments(step, line, 'Set Variable');
    expect(segments.find((s: Segment) => s.key === 'value').render).toBe('labelledMismatch');
  });
});

describe('matchSegments — presentation details a renderer has to reproduce', () => {
  it('flags a named object FileMaker wraps in curly quotes', () => {
    const step = { stepID: 1, step: 'Perform Script', script: 'noop', parameter: '$p' };
    const line = 'Perform Script [ “noop” ; Specified: From list ; Parameter: $p ]';
    const { segments } = matchSegments(step, line, 'Perform Script');
    const script = segments.find((s: Segment) => s.key === 'script');
    expect(script.render).toBe('bare');
    expect(script.quoted).toBe(true);
  });

  it('flags a long option FileMaker truncates with an ellipsis', () => {
    const step = { stepID: 141, step: 'Set Variable', value: 'Let ( [ a = 1 ] ; a + 2 + 3 + 4 )' };
    const line = 'Set Variable [ Value: Let ( [ a = 1 ] ; a + 2 +… ]';
    const { segments } = matchSegments(step, line, 'Set Variable');
    expect(segments[0].render).toBe('labelled');
    expect(segments[0].truncated).toBe(true);
  });
});

describe('matchSegments — an option must never swallow the next one', () => {
  it('stops a decoration at the option boundary', () => {
    // Measured (Generate Response from Model): `messages` shows with a
    // repetition the CLI reports for a different field. If the decoration is
    // allowed to run past the `;`, `slidingWindowVariable` looks as if
    // FileMaker never showed it — while the line shows it under its own label.
    const step = {
      stepID: 199,
      step: 'Generate Response from Model',
      repetition: 0,
      messages: '$target',
      'slidingWindowVariable': '$history',
      'slidingWindowCount': '3',
    };
    const line =
      'Generate Response from Model [ Messages: $target[10] ; Save Message History To: $history[7] ; Message History Count: 3 ]';
    const { segments, ignoredKeys } = matchSegments(step, line, 'Generate Response from Model');
    expect(segments.find((s: Segment) => s.key === 'messages').value).toBe('$target[10]');
    expect(ignoredKeys).not.toContain('slidingWindowVariable');
  });

  it('cuts a span back to its first option when nothing classifies', () => {
    // Measured (New Window): `style` is a structured value nothing can classify,
    // so its span used to run to the next anchor and hide `Using layout`, which
    // then reported as never rendered — 8 times out of 8.
    const step = {
      stepID: 65,
      step: 'New Window',
      layout: 'File Open',
      height: '1',
      style: { raw: '0x40270602', set: ['documentMode', 'resize'] },
    };
    const line = 'New Window [ Style: Document ; Using layout: “File Open” (blank) ; Height: 1 ]';
    const { segments, ignoredKeys } = matchSegments(step, line, 'New Window');
    expect(segments.find((s: Segment) => s.key === 'style').value).toBe('Document');
    expect(ignoredKeys).not.toContain('layout');
    const layout = segments.find((s: Segment) => s.key === 'layout');
    expect(layout.label).toBe('Using layout');
    expect(layout.render).toBe('labelled');
  });

  it('lets the key with label evidence claim a shared value first', () => {
    // Measured (Insert Embedding, Perform Semantic Find): several keys report the
    // SAME calculation. The key order matters and is the point of the fixture —
    // `count` comes first, as in the CLI's output, so taking the earliest free
    // option per key gives it `Account Name:` and reports `account`, which owns
    // that label, as never rendered.
    const calc = '// some calc here';
    const step = { stepID: 205, step: 'Insert Embedding', count: calc, account: calc };
    const line = `Insert Embedding [ Account Name: ${calc} ]`;
    const { segments, ignoredKeys } = matchSegments(step, line, 'Insert Embedding');
    expect(segments).toEqual([
      { key: 'account', render: 'labelled', label: 'Account Name', value: calc },
    ]);
    expect(ignoredKeys).toEqual(['count']);
  });

  it('never lets a repetition claim an option of its own', () => {
    // A repetition renders as a suffix on the option it belongs to. When it holds
    // a calculation it can report the same text as a real option, and claiming
    // that option would both invent a fact and hide the true owner. `repetition`
    // is first here for the same reason as above: if `text` goes first the wrong
    // behaviour cannot show.
    const calc = '// some calc here';
    const step = { stepID: 206, step: 'Insert Embedding', repetition: calc, text: calc };
    const { segments, ignoredKeys } = matchSegments(
      step,
      `Insert Embedding [ Input: ${calc} ]`,
      'Insert Embedding',
    );
    expect(segments).toEqual([{ key: 'text', render: 'labelled', label: 'Input', value: calc }]);
    expect(ignoredKeys).toEqual(['repetition']);
  });

  it('reads a bare state word as the boolean it spells, in both polarities', () => {
    // Measured: `Allow User Abort [ Off ]` and `Set AI Call Logging [ On ; … ]`.
    // FileMaker prints the STATE of a boolean with no label at all, so neither the
    // key's label nor its value ever appears in the line. Before `bareState` the
    // option was unmatchable and the key was reported as never rendered — and for
    // the `true` polarity, counting invented `bareWhenTrue` with the label "On",
    // which would render nothing at all when the flag is off.
    const off = matchSegments({ stepID: 71, step: 'Allow User Abort', on: false }, 'Allow User Abort [ Off ]', 'Allow User Abort');
    expect(off.segments).toEqual([
      { key: 'on', render: 'bareState', label: null, value: 'Off', attributed: 'valueWords' },
    ]);
    expect(off.unmatched).toEqual([]);
    expect(off.ignoredKeys).toEqual([]);

    const on = matchSegments({ stepID: 214, step: 'Set AI Call Logging', enabled: true }, 'Set AI Call Logging [ On ]', 'Set AI Call Logging');
    expect(on.segments).toEqual([
      { key: 'enabled', render: 'bareState', label: null, value: 'On', attributed: 'valueWords' },
    ]);
  });

  it('reads a bare state word as a state even where it is also the key own name', () => {
    // `Allow User Abort [ On ]` with `{on: true}`: the option is both a spelling of
    // the key AND the state word, so pass 2 could read it either way. The state
    // reading wins, because it is the only one that also explains the same step
    // printing `[ Off ]` — which this step does. Read as `bareWhenTrue`, a renderer
    // prints nothing when the flag is off.
    const { segments } = matchSegments({ stepID: 71, step: 'Allow User Abort', on: true }, 'Allow User Abort [ On ]', 'Allow User Abort');
    expect(segments).toEqual([{ key: 'on', render: 'bareState', label: null, value: 'On' }]);
  });

  it('credits a SECOND repetition key from the decoration on its own host', () => {
    // Measured on `Generate Response from Model`: `repetition` belongs to `target`
    // and `slidingWindowVariableRepetition` to `slidingWindowVariable`. Keying
    // the suffix rule off the literal string `repetition` credited the first and
    // left the second reported as never displayed — while FileMaker was displaying
    // it, and the matcher was recording the proof in `decorated`.
    const step = {
      stepID: 218,
      step: 'Generate Response from Model',
      target: '$out',
      repetition: '7',
      'slidingWindowVariable': '$hist',
      'slidingWindowVariableRepetition': '9',
    };
    const line = 'Generate Response from Model [ Response: $out[7] ; Save Message History To: $hist[9] ]';
    const { segments, unmatched, ignoredKeys } = matchSegments(step, line, 'Generate Response from Model');
    expect(segments).toEqual([
      { key: 'target', render: 'labelled', label: 'Response', value: '$out[7]', withRepetition: true },
      { key: 'repetition', render: 'suffix', label: null, value: '[7]', suffixOf: 'target' },
      // The host is matched with a DECORATION, not with a repetition variant:
      // `renderVariants` only offers the plain `repetition` key's suffix, which is
      // why the second repetition needed the decoration route in the first place.
      { key: 'slidingWindowVariable', render: 'labelled', label: 'Save Message History To', value: '$hist[9]', decorated: '[9]', attributed: 'valueWords' },
      { key: 'slidingWindowVariableRepetition', render: 'suffix', label: null, value: '[9]', suffixOf: 'slidingWindowVariable' },
    ]);
    expect(unmatched).toEqual([]);
    expect(ignoredKeys).toEqual([]);
  });

  it('lets a repetition take a Repetition label but not another option label', () => {
    // Two halves of one rule. FileMaker DOES label some repetitions, for a key it
    // does not spell (`AVPlayer Play`'s `objectRepetition` renders
    // `Repetition: 2`), so that label must be claimable. Any other label belongs to
    // another option, even when the values are identical — which is how a
    // repetition key came to claim `Web Viewer:`.
    const labelled = matchSegments(
      { stepID: 177, step: 'AVPlayer Play', 'objectName': '"AV"', 'objectRepetition': '2' },
      'AVPlayer Play [ Object Name : "AV" ; Repetition: 2 ]',
      'AVPlayer Play',
    );
    expect(labelled.segments).toEqual([
      { key: 'objectName', render: 'labelled', label: 'Object Name', value: '"AV"' },
      { key: 'objectRepetition', render: 'labelled', label: 'Repetition', value: '2' },
    ]);

    const calc = '// some calc here';
    const stolen = matchSegments(
      { stepID: 218, step: 'Generate Response from Model', 'slidingWindowVariableRepetition': calc },
      `Generate Response from Model [ Web Viewer: ${calc} ]`,
      'Generate Response from Model',
    );
    expect(stolen.segments).toEqual([]);
    expect(stolen.ignoredKeys).toEqual(['slidingWindowVariableRepetition']);
  });

  it('refuses a bare state word when two boolean keys could own it', () => {
    // The word says which VALUE is shown, never which key shows it. Two keys with
    // that same value are indistinguishable, so the option stays unplaced rather
    // than being handed to whichever key the CLI happened to report first.
    const step = { stepID: 71, step: 'Allow User Abort', on: false, other: false };
    const { segments, unmatched } = matchSegments(step, 'Allow User Abort [ Off ]', 'Allow User Abort');
    expect(segments).toEqual([]);
    expect(unmatched).toEqual(['Off']);
  });

  it('leaves a state word that spells the opposite of the key alone', () => {
    // `On` cannot be `enabled: false`. Mis-reading polarity would be worse than
    // not placing it: the renderer would print the wrong state.
    const step = { stepID: 214, step: 'Set AI Call Logging', enabled: false };
    const { segments, unmatched } = matchSegments(step, 'Set AI Call Logging [ On ]', 'Set AI Call Logging');
    expect(segments).toEqual([]);
    expect(unmatched).toEqual(['On']);
  });

  it('keeps an unplaceable calculation in one piece', () => {
    // A leftover stretch is only cut on `;` when every piece looks like an
    // option. `Choose ( n ; one ; two )` looks wordlike piece by piece, so the
    // unbalanced bracket is what gives the cut away.
    const step = { stepID: 76, step: 'Set Field', target: 'Table::Field', mode: 'x' };
    const line = 'Set Field [ Table::Field ; Choose ( n ; one ; two ) ]';
    const { unmatched } = matchSegments(step, line, 'Set Field');
    expect(unmatched).toEqual(['Choose ( n ; one ; two )']);
  });
});

describe('matchSegments — never throws', () => {
  it('survives a step that is not an object and a line that is not a string', () => {
    expect(matchSegments(null, null, undefined)).toEqual({
      segments: [],
      positions: [],
      unmatched: [],
      unmatchedAt: [],
      ignoredKeys: [],
    });
    expect(matchSegments({ step: 'If' }, 42, 'If')).toEqual({
      segments: [],
      positions: [],
      unmatched: [],
      unmatchedAt: [],
      ignoredKeys: [],
    });
  });

  it('reports every key as ignored when the CLI reports options the line does not show', () => {
    // An opaque step: the CLI cannot read the options, so nothing can be paired.
    const step = { stepID: 36, step: 'Import Records', opaque: true, editable: false };
    const { segments, unmatched, ignoredKeys } = matchSegments(
      step,
      'Import Records [ With dialog: On ; “file.txt” ]',
      'Import Records',
    );
    expect(segments).toEqual([]);
    expect(unmatched).toEqual(['With dialog: On ; “file.txt”']);
    expect(ignoredKeys).toEqual(['opaque', 'editable']);
  });
});

describe('slots — the values the CLI does not name', () => {
  it('expands a numbered member into one key per slot, in place', () => {
    const step = {
      stepID: 148,
      step: 'Install OnTimer Script',
      script: 'noop',
      slots: { fileReference: 'Elsewhere', calc: { '0': '1', '2': '3' } },
      interval: '1+2',
    };
    // `slots` itself is gone: it is not a displayed option, its members are.
    expect(displayKeys(step)).toEqual([
      'script',
      '@slot:fileReference',
      '@slot:calc:0',
      '@slot:calc:2',
      'interval',
    ]);
    expect(expandSlots(step)['@slot:calc:2']).toBe('3');
    expect(expandSlots(step)['@slot:fileReference']).toBe('Elsewhere');
  });

  it('leaves a step with no slots untouched', () => {
    const step = { stepID: 141, step: 'Set Variable', name: '$x' };
    expect(expandSlots(step)).toBe(step);
    expect(displayKeys(step)).toEqual(['name']);
  });

  it('round-trips a slot id both ways', () => {
    expect(parseSlotID(slotID('calc', '4'))).toEqual({ member: 'calc', number: '4' });
    expect(parseSlotID(slotID('fileReference'))).toEqual({ member: 'fileReference' });
    expect(parseSlotID('interval')).toBeNull();
  });

  it('places a slot by the label FileMaker printed for it', () => {
    // Measured: the file a scheduled script lives in is reported only as a slot.
    const step = {
      stepID: 148,
      step: 'Install OnTimer Script',
      script: 'noop',
      interval: '1+2',
      slots: { fileReference: 'Elsewhere' },
    };
    const line = 'Install OnTimer Script [ “noop” from file: “Elsewhere” ; Interval: 1+2 ]';
    const { segments, unmatched } = matchSegments(step, line, 'Install OnTimer Script');
    const slot = (segments as Segment[]).find((item) => item.key === '@slot:fileReference');
    expect(slot?.label).toBe('from file');
    expect(slot?.value).toBe('“Elsewhere”');
    // The label does not begin an option, so FileMaker printed it INSIDE the one
    // before it — the fact `inlineOf` carries into the catalog.
    expect(slot?.inlineOf).toBe('script');
    expect(unmatched).toEqual([]);
  });

  it('does not let counting claim an option for a slot while a named key is open', () => {
    // `sole` is a count, and expanding slots multiplies what is left over to count.
    const step = {
      stepID: 91,
      step: 'Replace Field Contents',
      'withDialog': true,
      field: 'T::f',
      replace: 2,
      slots: { text: { '3': '1' }, numeric: { '2': 1 } },
    };
    const line = 'Replace Field Contents [ With dialog: On ; T::f ; Serial numbers ]';
    const { segments } = matchSegments(step, line, 'Replace Field Contents');
    const counted = (segments as Segment[]).find((item) => item.attributed === 'sole');
    expect(counted?.key).toBe('replace');
    expect(counted?.value).toBe('Serial numbers');
  });

  it('refuses a counted claim on an option another reported key is labelled for', () => {
    // The shape the owner ruled out: an option printed twice because a second key
    // claimed it by counting.
    const step = { stepID: 6, step: 'Go to Layout', animation: 19, slots: { memberKey: 0 } };
    const line = 'Go to Layout [ Animation: Cross Dissolve ]';
    const { segments } = matchSegments(step, line, 'Go to Layout');
    expect((segments as Segment[]).map((item) => item.key)).toEqual(['animation']);
  });
});
