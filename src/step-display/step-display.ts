import catalogData from '../catalogs/fm-step-display.js';
import {
  catalogEntry,
  renderStepByConvention,
  renderStepFromCatalog,
  stepConventions,
} from './step-display-render.ts';
import type { StepDisplayCatalog } from './step-display-types.ts';
import type { ScriptDetailStep } from '../types.ts';

/** How FileMaker writes one script step on one line, from the JSON the ADT CLI
 *  projects it as.
 *
 *  The Script Workspace shows a step as its name followed by its options in square
 *  brackets — `Set Variable [ $url ; Value: "https://…" ]` — and a step list that
 *  instead shows the name with one value flung to the far right does not read as a
 *  script. This module produces that line and nothing else: it is pure, so it is
 *  unit-tested, and it is display only. Nothing here decides what is converted, pushed
 *  or read.
 *
 *  WHERE THE LINE COMES FROM, which is the whole of what changed:
 *
 *   - `src/catalogs/fm-step-display.json` describes 209 step types, DERIVED by pairing
 *     1203 steps the CLI reported with the lines FileMaker's own Script Workspace wrote
 *     for them. A step type it covers is written out by `renderStepFromCatalog` in
 *     step-display-render.ts, and `scripts/roundtrip-step-display.mjs` measures THAT
 *     FUNCTION — the one this module calls, not a copy of it — against all 1203 lines.
 *     Read `derivedFrom`, `confidence` and `doubts` on an entry before trusting one
 *     line of it: the catalog's own purpose is to make the weak facts visible.
 *   - A step type the catalog does NOT cover falls back to the CLI's convention, which
 *     is a GUESS and says so. FileMaker will add steps, and a step read from a file this
 *     catalog never saw must still show something.
 *   - A KEY the catalog does not account for — on a covered step type or an unknown one
 *     — is printed by that same convention rather than dropped. The owner's ruling:
 *     "we should not omit options", and separately that an option we print and FileMaker
 *     does not is fine. Where the catalog is silent, printing beats hiding.
 *
 *  Nothing here decides what is renderable: `stepDisplay` renders every step it is
 *  given, including an opaque one (as its bare name) and one whose displayed name only
 *  an installed plugin knows (under the CLI's name). The round-trip counts those as
 *  unwritable, which is right for a measurement and wrong for a row someone is reading.
 */

export const CATALOG: StepDisplayCatalog = catalogData as unknown as StepDisplayCatalog;

/** The catalog's own tables, built once: the masked keys, the measured labels and the
 *  keys FileMaker writes bare. THE SECURITY BOUNDARY OF THIS MODULE runs through the
 *  first of them.
 *
 *  FileMaker hides a password in its step display and the CLI does not, so a script
 *  hard-coding a literal password would otherwise have it printed into the read sheet.
 *
 *  WHAT IS ENFORCED, exactly, because a promise wider than the code is worse than none —
 *  a review defeated the wider wording by nesting a masked key under an unmasked one:
 *
 *   - a key whose NAME the catalog masks prints the mask and never the value, on every
 *     path: a measured segment, a key the catalog does not account for on a covered step
 *     type, and a step type the catalog has never seen;
 *   - the name is matched case-insensitively, so `Password` is caught as well as
 *     `password`;
 *   - **at any depth**: a value the convention has to serialise has every masked key
 *     inside it replaced, however deeply nested, by `redactedJson`.
 *
 *  WHAT IS NOT, and cannot be from a derived set: a key that is neither one of the three
 *  the corpus contains nor a case variant of one is not recognised as a secret. The set is
 *  as wide as the data that produced it. */
const CONVENTIONS = stepConventions(CATALOG);

/** A step split into the two pieces a row styles differently. */
export interface StepDisplay {
  /** The step's displayed name: FileMaker's own where the catalog measured it to
   *  differ from the CLI's (`Page Setup` is displayed `Print Setup`), and the CLI's
   *  otherwise. */
  name: string;
  /** Everything after the name — the bracketed options, or a comment's text. `''` for
   *  a step that shows none, so a caller can skip the element. */
  detail: string;
}

/** The label FileMaker writes for a key, MEASURED where the catalog has it.
 *
 *  Two sources, strongest first:
 *
 *   1. **The catalog.** Its labels were read off the lines FileMaker itself wrote, so
 *      they carry spellings no rule could produce: `verifySslCertificates` is
 *      displayed `Verify SSL Certificates`, and `dataSource` on one step type is
 *      displayed `from file`. Where a step type is named its own label wins; without
 *      one, a key every step type spells the same way is safe to use globally, and a
 *      key whose label DIFFERS between step types (`target` is variously `Target`,
 *      `Response`, `Using layout`, …) falls through rather than picking a favourite.
 *   2. **The inferred rule**, for a key the catalog never labels — still a guess, and
 *      the only one left in the labels.
 *
 *  `stepName` is optional because the signature predates the catalog; the rendering
 *  paths always have a step name to give it. Exported because it was, and because a
 *  caller building its own line about one key should get FileMaker's word for it. */
export function keyLabel(key: string, stepName?: string): string {
  return CONVENTIONS.labelFor(key, stepName);
}

/** One step as its own name plus the detail FileMaker writes after it.
 *
 *  Three things the catalog declines to render, each answered here rather than by the
 *  shared renderer, because the round-trip answers them differently — it counts them as
 *  unwritable, which is the right verdict for a measurement and the wrong one for a row
 *  the user is looking at:
 *
 *   - a step type with no entry: the convention fallback, guessed and marked so;
 *   - an OPAQUE step: the CLI stripped its options and says so, so the catalog path
 *     writes the name with nothing after it, which is what FileMaker's own line cannot
 *     be reproduced as. `stepRowContents` draws the `opaque` marker that explains it;
 *   - a step whose displayed name comes from an installed plugin: the catalog cannot
 *     know that name, so the CLI's own is shown with the step's measured options. A
 *     wrong name beside the right options beats no row at all. */
export function stepDisplay(step: ScriptDetailStep): StepDisplay {
  // `catalogEntry` rather than `CATALOG[step.step]`: a JSON module inherits
  // `Object.prototype`, so a step named `constructor` or `toString` used to find a truthy
  // non-entry and take the read sheet down with it.
  const entry = catalogEntry(CATALOG, step.step);
  const { name, detail } = entry
    ? renderStepFromCatalog(step, entry, CONVENTIONS)
    : renderStepByConvention(step, CONVENTIONS);
  return { name, detail };
}

/** The whole line, for a caller that does not style the two halves apart. */
export function stepDisplayText(step: ScriptDetailStep): string {
  const { name, detail } = stepDisplay(step);
  return detail ? `${name} ${detail}` : name;
}
