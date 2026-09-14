/** Pair each step of a script body with the line FileMaker's Script Workspace
 *  renders for it.
 *
 *  Data provenance: the owner's `fmnet://localhost/Ooe`, read only, exported as
 *  text in fm_scripts/ and read as JSON via `read:script`.
 */

/** CLI step name → the name FileMaker displays, where they differ by more than case.
 *  Measured, not guessed. Extend only from observed data. */
export const DISPLAY_NAME_OVERRIDES = {
  'Page Setup': 'Print Setup',
};

/** Step types whose display name depends on state outside the script.
 *
 *  ExternalStep: FileMaker renders the installed plugin's registered name, not
 *  "ExternalStep". The one example in the owner's data is plugin `4d425350`
 *  (four-byte code for `MBSP`) which FileMaker shows as "MBS". That is a lookup
 *  against installed plugins, unknowable from the step's JSON alone, so we cannot
 *  verify the name. Accept whatever line is at the cursor and tag the pair so
 *  later tasks can exclude it from name inference. */
export const NAME_UNVERIFIABLE = new Set(['ExternalStep']);

/** The JSON carries FileMaker returns as \r and the Script Workspace shows a step on
 *  ONE row, so a return becomes a space. Measured, and the only one of the three
 *  operations that used to live here which is a fact about FileMaker.
 *
 *  **THIS IS THE ONLY ONE OF THEM THE COMPARISON PATH MAY USE**, which is why it has a
 *  name of its own. See `normaliseCalc` for the other two and for what went wrong. */
export function oneLine(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\r\n]+/g, ' ');
}

/** `oneLine`, plus a whitespace-run collapse and a trim: A MATCHING TOLERANCE, not a
 *  fact about FileMaker.
 *
 *  It belongs where a rendered text and a JSON value are BOTH passed through it — the
 *  matcher asking "could this text be this value?" — because there it is symmetric and
 *  it only ever widens what the derivation can find.
 *
 *  It does NOT belong in the round-trip's comparison path, and it was there: the
 *  round-trip built OUR side of every comparison through this function and FileMaker's
 *  side not at all, so a collapse and a trim acted on one side only. An independent
 *  review measured the effect at net −2 on the exact count with one row bought, and the
 *  size is not the point — a one-sided normalisation can only move rows toward
 *  matching, and this one was undeclared inside another operation, which is the exact
 *  shape of the whitespace defect the "only these normalisations" rule exists to stop.
 *
 *  Worse, the collapse is not even measured: it reproduces FileMaker on one example
 *  (script 55 step 94, where a return sits between a space and a word and FileMaker
 *  shows one space) and contradicts it on another (step 22, where FileMaker preserves
 *  the same construction). So it is a guess, made outside the catalog, about a thing
 *  the catalog exists to record. The round-trip now uses `oneLine`. */
export function normaliseCalc(value) {
  return oneLine(value).replace(/\s+/g, ' ').trim();
}

/** How many rendered lines a step occupies. Only a comment's text can carry
 *  returns, and each one pushes the rest of the script down a line. */
function lineSpan(step) {
  if (step.step !== '#' || typeof step.text !== 'string') return 1;
  return 1 + (step.text.match(/[\r\n]/g) ?? []).length;
}

function leadingTabs(line) {
  const m = line.match(/^\t*/);
  return m ? m[0].length : 0;
}

/** Align a body against rendered lines.
 *
 *  Returns every pair it could make AND every step it could not, because a
 *  silent skip would narrow the derived catalog without anyone noticing. */
export function alignSteps(body, lines, displayNameFor) {
  const pairs = [];
  const failures = [];
  let cursor = 0;

  for (let index = 0; index < body.length; index++) {
    const step = body[index];

    if (cursor >= lines.length) {
      failures.push({ index, step: step.step, line: null, reason: 'ran out of rendered lines' });
      break;
    }

    const raw = lines[cursor];
    const indent = leadingTabs(raw);
    const line = raw.slice(indent);
    const expected = displayNameFor(step.step);

    // For steps whose name depends on external state (e.g., installed plugins),
    // accept the line without verifying the name and tag the pair.
    if (NAME_UNVERIFIABLE.has(step.step)) {
      pairs.push({ index, step, line, indent, nameUnverified: true });
      cursor += lineSpan(step);
      continue;
    }

    const matches =
      line.toLowerCase().startsWith(expected.toLowerCase()) ||
      (step.step === '#' && line.startsWith('#'));

    if (!matches) {
      failures.push({
        index,
        step: step.step,
        line,
        reason: `rendered name does not match; expected ${JSON.stringify(expected)}`,
      });
      cursor += 1;
      continue;
    }

    pairs.push({ index, step, line, indent });
    cursor += lineSpan(step);
  }

  return { pairs, failures };
}
