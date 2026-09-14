# fm-adt-toolkit

Shared code for tools built on the Claris Agentic Development Toolkit `fm` CLI.

- `fm-adt-toolkit/runner`: locate the CLI, run a batch of NDJSON ops, parse the result lines.
- `fm-adt-toolkit/step-display`: render a script step the way FileMaker's Script Workspace writes it, from the catalog in `src/catalogs/`.
- `fm-adt-toolkit/read-only`: `isReadOnlyOp` and `assertReadOnly`, the one guard every read-only entry point shares. Read-only means `read:*` plus `evaluate:calculation` and `validate:calculation`, which fm's help guarantees never change a file. Browser safe.
- `fm-adt-toolkit/gaps`: the register of what the CLI cannot read yet, with `fm-gaps check` to re-run every probe against a new build and `fm-gaps report` to write the Markdown for Claris. `fm-adt-toolkit/gaps/checks` is the browser-safe subset — just `evaluateCheck` and the `GapCheck` type, with none of `gaps`'s `node:fs` dependency, for code that needs to evaluate a check result without pulling in the register.

Measured against fm 0.6.0 (29816214). Node 22.18 or later.

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
every distinct probe once, and records evidence (`gaps/evidence/<version>/<probe-id>.ndjson`) and
a per-attribute outcome on every entry; it never edits `reported` or `fmKey` itself. `check` exits
1 on errored probes or regressions; newly reported attributes are printed for a human to confirm
by setting `fmKey` and `reported`. `report` renders the matrix as Markdown for Claris.
