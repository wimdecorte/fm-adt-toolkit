# fm-adt-toolkit

Shared code for tools built on the Claris Agentic Development Toolkit `fm` CLI.

- `fm-adt-toolkit/runner`: locate the CLI, run a batch of NDJSON ops, parse the result lines.
- `fm-adt-toolkit/step-display`: render a script step the way FileMaker's Script Workspace writes it, from the catalog in `src/catalogs/`.
- `fm-adt-toolkit/gaps`: the register of what the CLI cannot read yet, with `fm-gaps check` to re-run every probe against a new build and `fm-gaps report` to write the Markdown for Claris.

Measured against fm 0.6.0 (29816214). Node 22.18 or later.

## Re-checking the register on a new fm build

    npx fm-gaps check --file=fmnet://localhost/ooe --username=admin
    npx fm-gaps report --out=gaps-report.md

`check` sends read ops only. It records the exact command and fm's verbatim response on every entry and never changes an entry's `status`; read the evidence, then set `status` to `fixed` by hand and commit the register.
