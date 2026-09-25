# fm-adt-toolkit

Shared code for tools built on the Claris Agentic Development Toolkit `fm` CLI.

- `fm-adt-toolkit/runner`: locate the CLI, run a batch of NDJSON ops, parse the result lines. `locateFmCli` resolves the launcher under either name ADT has shipped — 0.8.0 renamed `fm` to `filemaker` — and falls back to the real binary under Application Support, which no build has renamed. Resolve through it rather than hardcoding a name; see [The launcher's name](#the-launchers-name).
- `fm-adt-toolkit/step-display`: render a script step the way FileMaker's Script Workspace writes it, from the catalog in `src/catalogs/`. The catalog spells each option key exactly as the fm build it was measured against does; the renderer looks a key up exactly first and then by its case-and-separator fold (`foldKey`), so a step written by a build that only respelled a key (`with dialog` to `withDialog`) still renders. A key renamed by word reaches the baseline, as any unmeasured key does.
- `fm-adt-toolkit/read-only`: `isReadOnlyOp` and `assertReadOnly`, the one guard every read-only entry point shares. Read-only means `read:*` plus `evaluate:calculation` and `validate:calculation`, which fm's help guarantees never change a file. Browser safe.
- `fm-adt-toolkit/gaps`: the register of what the CLI cannot read yet, with `fm-gaps check` to re-run every probe against a new build and `fm-gaps report` to write the Markdown for Claris. `fm-adt-toolkit/gaps/checks` is the browser-safe subset — just `evaluateCheck` and the `GapCheck` type, with none of `gaps`'s `node:fs` dependency, for code that needs to evaluate a check result without pulling in the register.
- `fm-adt-toolkit/intake`: which fm build everything above was measured against, as `{ version, build, checked, cliPath }`. See [Which build this is](#which-build-this-is).

Node 22.18 or later.

## Which build this is

[`gaps/intake.json`](gaps/intake.json) names the fm build this repo's measurements come from.
`fm-gaps check` writes it from the CLI that just answered the probes, next to where it saves the
register, so the record cannot disagree with the run that produced it and no one has to restate
the build in prose. A fatal batch writes neither.

`version` is the CLI's own, prerelease tag and all: a build announcing `0.8.0-beta.0` is recorded
as `0.8.0-beta.0`, never as the `0.8.0` it precedes, so the comparison below cannot read a beta's
measurements as current for the release.

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

`cliPath` is the binary `locateFmCli` resolved for that run. It is recorded because the launcher's
name is a fact about a build that nothing else here can see — see below.

## The launcher's name

**0.8.0 renamed it.** That build installs `/usr/local/bin/filemaker`, a wrapper script that execs
the real binary under `~/Library/Application Support/ADT/MCP/fm-cli/fm-cli`, and it installs no
`fm` at all: on a machine with 0.8.0, `command -v fm` answers nothing. Builds through 0.7.0
installed `fm`. Both launchers report the same `--version` banner, and the real binary keeps its
own name, `fm-cli`, in every build so far — as does `fm help`'s own title.

Anything that resolves the CLI by name must therefore try both, which `locateFmCli` does. Call it
instead of hardcoding a name, and prefer `cli.path` over the word `fm` anywhere a command line is
recorded or printed.

Nothing in a `check` run can notice a rename like this: the register, the help snapshot, the
evidence and the exit code are all identical across one, because the locator falls through to the
Application Support binary, which is not renamed. That is what makes this toolkit survive a
rename, and it is also what hid this one — 0.8.0's intake here passed clean while consumers that
resolved `fm` by name were broken by it. Hence `cliPath` in
[`gaps/intake.json`](gaps/intake.json): the next rename shows up as a one-line diff in the intake
instead of as somebody else's bug report.

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
and prints how it differs from the previous build's — catalogs, ops and script steps gained or lost,
and per op and per step, keys gained or lost. That is the authoritative surface: a probe only
notices a rename or a new catalog once something breaks, while `fm help` says so directly.
Script steps are counted because they are where the changes have been: they hang off the
`script › steps` roster rather than off an op, and 0.8.0 documented 163 new step keys (the innards
of `findRequests`, `importOptions`, `exportOptions`, `sortOrder`, `printOptions`, `pageSetup`)
without touching a single catalog or op. `report` repeats the same diff as a `## CLI surface since <prev>`
section, and `fm-gaps help-diff --from=<version-build> [--to=<version-build>]` prints it on demand
for any two stored snapshots (`--to` defaults to the greatest one stored).

`fm-gaps behaviour` records a second kind of snapshot, under
`gaps/behaviour/<version>-<build>.json`, and diffs it the same way. Where the register measures what
fm REPORTS about a file, this measures how fm BEHAVES toward the account asking: which privilege a
session needs to run at all, what a read returns when a grant is withheld, whether two sessions may
read at once. None of that appears in the register or in `fm help`, so nothing else here would notice
it change — and one of the answers, the exclusive schema lock on reads, is already expected to move.

It is the only command in this repo that WRITES outside the register, which is why it is separate:
`check` puts every batch through `assertReadOnly`, and a probe that tests a refusal has to send the op
that gets refused. It builds five privilege sets and an account each, probes as every one of them,
then deletes them — refusing to start if an object of its own naming already exists, and never
touching one it did not create. What the answers mean is written up in
[docs/fm-adt-privileges.md](docs/fm-adt-privileges.md).

The runbook for picking up a new fm build:

1. Install the build, then say out loud what it put on PATH: `ls -l /usr/local/bin/filemaker
   /usr/local/bin/fm; command -v filemaker fm`. Nothing downstream in this runbook can notice
   that answer changing — 0.8.0 renamed `fm` to `filemaker` and every step below still passed —
   and consumers that resolve the launcher by name break on it. If the name moved again, teach
   `LAUNCHER_NAMES` in [src/runner/locate.ts](src/runner/locate.ts) the new one and say so in
   [The launcher's name](#the-launchers-name).
2. Commit or stash whatever is in progress, so the diff below is only the new build's doing.
3. `npx fm-gaps check --file=fmnet://localhost/ooe --username=admin`
4. Read the output in this order: Help since, Errored, Regressed, Expected failure resolved,
   Newly reported, Unexplained keys (and nested).
5. Fix the register: fmKey renames, new selectors, dropped `expectedError`s, new "(fm only)" rows
   for anything the CLI now reports that nothing in the register named yet. Re-run `check` until it
   exits 0 with only the known expected errors. The last `check` to exit 0 is what leaves
   [`gaps/intake.json`](gaps/intake.json) naming the new build, and the binary that answered for
   it — nothing to edit by hand.
6. `npx fm-gaps report --out=gaps/reports/<date>-fm-<version>.md`
7. `npx fm-gaps behaviour --file=fmnet://localhost/ooe --username=admin` — the one command here
   that WRITES. It builds five privilege sets and an account each, probes fm as every one of them,
   deletes them again, and records the answers under `gaps/behaviour/<version>-<build>.json`, printing
   how they differ from the previous build. It refuses to start if an object of its own naming already
   exists, and it never touches one it did not create. Run it when the register work is settled, not
   alongside step 3 — fm holds an exclusive schema lock, so two runs against one file collide.

   What it pins is how fm behaves toward the ACCOUNT asking, which is in neither the register nor
   `fm help`: which privilege a session needs to run at all, what a read does when a grant is
   withheld, whether two sessions may read at once. Behaviour changes never affect the exit code.

   **Then update the write-ups, because the snapshot is evidence and they are the claims.** Two
   edits, one of them unconditional:

   - Always: the provenance line at the top of
     [docs/fm-adt-privileges.md](docs/fm-adt-privileges.md) names the fm build and date it was
     measured against. Restate it, or the document asserts a build it no longer describes.
   - Per `~` line: a changed answer falsifies a specific sentence. Which one is not a judgement
     call — each probe backs a named claim:

     | probe | what it backs |
     |---|---|
     | `lock:concurrent-reads` | "fm holds an exclusive schema lock, even for reads". `by=fm-cli` is fm serialising itself; `by=other-client` means something else held the schema and the row proves nothing about fm |
     | `no-developer-privilege:open` | gate 1 — that fm runs at all only with the developer privilege |
     | `developer-only:read:layout` / `:read:script` / `:read:valueList` | "What filtering looks like", and trap 1. `all`/`subset`/`none` is the filtering; `total=file` would mean `total` stopped being session-scoped, which retires trap 2 |
     | `*:read:account`, `*:read:privilegeSet` | that those two catalogs are `[Full Access]`-only whatever else is granted |
     | `developer-only:create:*` | the per-catalog table's write column, and the `create_failed` / dbError 9 trap |
     | `layouts-only:create:theme` | the "borrowed grant" bullet — that theme writes ride on Layouts access |
     | `extendedPrivilege:keywords` | the closing section. A keyword ADDED here is the news that section asks for |
     | `plugin:validate-plugin-function`, `plugin:validate-External` | [docs/fm-plugin-findings.md](docs/fm-plugin-findings.md), not the privileges document |

   `lock:concurrent-reads` is the one already expected to move.
8. If any step keys changed, re-derive the step-display catalog: re-read the corpus scripts
   (`fm_scripts/*.adt.json`, `read:script` and nothing else, written back as
   `json.dumps(body, ensure_ascii=False)` with no trailing newline), then BOTH commands, in
   order — `npm run derive:step-display` and then `npm run roundtrip:step-display`. The derive
   writes `verified: false` on all 209 entries and asserts it; only the round-trip can know
   that field, so stopping after the derive leaves every entry claiming it was never verified.
   Expect the corpus-wide pins in `tests/step-display-catalog.test.ts` to need re-measuring,
   and read their comments before changing a number — one of them is a ratchet.
9. Bump this package's version, tag it, **and push both the branch and the tag**. Then consumers
   (fm-ai, the inspector) bump their pin.

   The push is part of the step, not a follow-up. Consumers pin by git tag
   (`github:wimdecorte/fm-adt-toolkit#v0.8.1`), and npm resolves that committish against the
   REMOTE via `git ls-remote` — it never sees a local clone. So an unpushed tag is not a release,
   it is a local bookmark, and every consumer stays on its old pin with no signal that anything
   happened. Push the branch too: pushing only the tag leaves the work reachable on the remote but
   absent from `main`.

   Tag it ANNOTATED, naming the fm build the measurements come from:

       git tag -a v0.8.1 -m "fm-adt-toolkit 0.8.1: measured against fm 0.8.0 (29834929)"
       git push origin main && git push origin refs/tags/v0.8.1

   The build belongs in the message because the two version numbers are independent and look
   misleadingly close: toolkit 0.8.1 holds fm 0.8.0 measurements, toolkit 0.7.0 held fm
   0.8.0-beta.0's. Nothing in a pin string says which fm build it speaks for, so the tag should.
   (`v0.7.0` and `v0.8.0` are lightweight and say nothing; they are already published, which is
   why they were left alone.)
