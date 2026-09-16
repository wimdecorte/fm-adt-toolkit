# fm-adt-toolkit

Shared code for tools built on the Claris Agentic Development Toolkit `fm` CLI.

- `fm-adt-toolkit/runner`: locate the CLI, run a batch of NDJSON ops, parse the result lines.
- `fm-adt-toolkit/step-display`: render a script step the way FileMaker's Script Workspace writes it, from the catalog in `src/catalogs/`. The catalog spells each option key exactly as the fm build it was measured against does; the renderer looks a key up exactly first and then by its case-and-separator fold (`foldKey`), so a step written by a build that only respelled a key (`with dialog` to `withDialog`) still renders. A key renamed by word reaches the baseline, as any unmeasured key does.
- `fm-adt-toolkit/read-only`: `isReadOnlyOp` and `assertReadOnly`, the one guard every read-only entry point shares. Read-only means `read:*` plus `evaluate:calculation` and `validate:calculation`, which fm's help guarantees never change a file. Browser safe.
- `fm-adt-toolkit/gaps`: the register of what the CLI cannot read yet, with `fm-gaps check` to re-run every probe against a new build and `fm-gaps report` to write the Markdown for Claris. `fm-adt-toolkit/gaps/checks` is the browser-safe subset — just `evaluateCheck` and the `GapCheck` type, with none of `gaps`'s `node:fs` dependency, for code that needs to evaluate a check result without pulling in the register.
- `fm-adt-toolkit/intake`: which fm build everything above was measured against, as `{ version, build, checked }`. See [Which build this is](#which-build-this-is).

Node 22.18 or later.

## Which build this is

[`gaps/intake.json`](gaps/intake.json) names the fm build this repo's measurements come from.
`fm-gaps check` writes it from the CLI that just answered the probes, next to where it saves the
register, so the record cannot disagree with the run that produced it and no one has to restate
the build in prose. A fatal batch writes neither.

Consumers can read it and compare against the CLI they actually located, which is worth doing:
the step renderer folds a respelled option key but sends a *renamed* one to the baseline
silently, so a newer fm than this one degrades quietly rather than loudly.

```js
import intake from 'fm-adt-toolkit/intake' with { type: 'json' };
import { locateFmCli } from 'fm-adt-toolkit/runner';

const cli = await locateFmCli();
if (cli && cli.version !== intake.version) {
  console.warn(`fm ${cli.version} differs from this toolkit's measurements (${intake.version}, ` +
    `build ${intake.build}, checked ${intake.checked}); renamed option keys will render from ` +
    `the baseline and the gap register may be stale.`);
}
```

Node needs `with { type: 'json' }` on that import. Code already pulling in the register can take
the same record as `readIntake` and the `Intake` type from `fm-adt-toolkit/gaps` instead.

Version numbers elsewhere in the docs are history, not a claim about this tree: where
[docs/fm-step-flags-reference.md](docs/fm-step-flags-reference.md) and
[fm_scripts/README.md](fm_scripts/README.md) say what 0.6.0 spelt and what 0.7.0 spells, they are
explaining why a key looks the way it does.

## The coverage register

The register is a per-kind coverage matrix: one entry per subject kind (`layout-object:edit-box`,
`field:text`, ...), each with its full list of known attributes and, once checked, fm's actual
response. Four commands maintain it:

    npx fm-gaps enumerate --saxml=<dir> --prefix=<FileName> --label=<export label>
    npx fm-gaps draft --kind=layout-object:edit-box --file=fmnet://localhost/ooe --username=admin
    npx fm-gaps check --file=fmnet://localhost/ooe --username=admin
    npx fm-gaps report --out=gaps-report.md

`enumerate` reads a Save as XML export (never writes to it) and writes one reference file per
kind under `gaps/reference/<label>/`: attribute paths and counts, no values. `draft` reads one
instance of each named kind through fm and writes a first-draft entry into the register for a
human to review; an existing entry with that id is left alone. `check` sends read ops only, runs
every distinct probe once, and records evidence (`gaps/evidence/<version>-<build>/<probe-id>.ndjson`)
and a per-attribute outcome on every entry; it never edits `reported` or `fmKey` itself. `check`
exits 1 on unexpected errored probes, regressions, attribute verification errors, or an expected
failure that has resolved; newly reported attributes are printed for a human to confirm by setting
`fmKey` and `reported`. `report` renders the matrix as Markdown for Claris.

Three entry-level fields shape what `check` does with an entry:

- `expectedError` is the one probe failure the owner accepts, written as a `lastChecked.reason`
  prefix (`"container key absent: contents.parts"`) or the bare fm error code of a refused probe
  (`"unknown_catalog"`). An errored entry it matches is listed under **Errored (expected)** and
  raises nothing. The same entry SUCCEEDING is listed under **Expected failure resolved** and does
  raise the exit code — that is the signal the gap closed and the entry needs rereading.
- `fmType` is the `(type, control)` pair the reference export recorded for a layout-object kind.
  A selector addresses one object among hundreds, so an instance of the wrong kind would read as
  "fm reports none of these attributes"; `check` refuses to score it and errors the entry instead.
- An attribute's `expect: { contains: "<member>" }` makes membership of an array value the test
  rather than the key's presence — 28 layout option rows all read `flags.set`, and only the member
  tells them apart.

## Intake per fm build

`check` also snapshots the CLI's own `fm help --json --all` under `gaps/help/<version>-<build>.json`
and prints how it differs from the previous build's — catalogs, ops and keys gained or lost. That
is the authoritative surface: a probe only notices a rename or a new catalog once something breaks,
while `fm help` says so directly. `report` repeats the same diff as a `## CLI surface since <prev>`
section, and `fm-gaps help-diff --from=<version-build> [--to=<version-build>]` prints it on demand
for any two stored snapshots (`--to` defaults to the greatest one stored).

The runbook for picking up a new fm build:

1. Install the build.
2. Commit or stash whatever is in progress, so the diff below is only the new build's doing.
3. `npx fm-gaps check --file=fmnet://localhost/ooe --username=admin`
4. Read the output in this order: Help since, Errored, Regressed, Expected failure resolved,
   Newly reported, Unexplained keys (and nested).
5. Fix the register: fmKey renames, new selectors, dropped `expectedError`s, new "(fm only)" rows
   for anything the CLI now reports that nothing in the register named yet. Re-run `check` until it
   exits 0 with only the known expected errors. The last `check` to exit 0 is what leaves
   [`gaps/intake.json`](gaps/intake.json) naming the new build — nothing to edit by hand.
6. `npx fm-gaps report --out=gaps/reports/<date>-fm-<version>.md`
7. If any step keys changed, re-derive the step-display catalog: re-read the corpus scripts, then
   `npm run derive:step-display`.
8. Bump this package's version and tag it; consumers (fm-ai, the inspector) bump their pin.
