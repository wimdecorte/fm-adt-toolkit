# fm-adt-toolkit

Shared code for tools built on the Claris Agentic Development Toolkit `fm` CLI.

- `fm-adt-toolkit/runner`: locate the CLI, run a batch of NDJSON ops, parse the result lines.
- `fm-adt-toolkit/step-display`: render a script step the way FileMaker's Script Workspace writes it, from the catalog in `src/catalogs/`.
- `fm-adt-toolkit/gaps`: the register of what the CLI cannot read yet, with `fm-gaps check` to re-run every probe against a new build and `fm-gaps report` to write the Markdown for Claris.

Measured against fm 0.6.0 (29816214). Node 22.18 or later.
