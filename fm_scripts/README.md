# The paired data behind `src/catalogs/fm-step-display.json`

Two FileMaker scripts, each held **twice over**. That pairing is the whole point: one side is
what the Claris ADT `fm` CLI reports for a script step, the other is the line FileMaker Pro's
own Script Workspace draws for that same step, and the catalog is derived by matching them
against each other rather than by anyone guessing.

| Script | id | The CLI's side (`read:script`) | FileMaker's side (Script Workspace text) | Steps |
|---|---|---|---|---|
| `20260625_missing` | 70 | `20260625_missing.adt.json` | `20260625_missing.txt` | 48 |
| `All script steps and all options 20260318` | 55 | `All script steps and all options 20260318.adt.json` | `All script steps and all options 20260318.txt` | 1155 |

Same stem, two extensions: `.adt.json` is the CLI's `body` array verbatim, `.txt` is the
rendered text. 1203 pairs in total, covering 209 distinct step types.

**Read-only data, committed on purpose.** They come from a FileMaker file only the repo owner
has, read with `read:script` and nothing else. Committing them is what makes the deliverable
auditable by anyone: without them `scripts/derive-step-display.mjs` cannot rebuild the
catalog, `scripts/roundtrip-step-display.mjs` cannot measure it, and four corpus-wide
assertions in `tests/step-display-catalog.test.ts` — the match floor, the planted-password
mask check, the `slots` partition and the zero-appended-keys check — would have nothing to run
against. They were inert off the owner's machine until these two files landed.

Nothing regenerates them. No script and no test invokes the `fm` CLI; the JSON here IS the
cache. Refreshing it is a deliberate, hand-run act, and only when the data itself grows —
`scripts/derive-step-display.mjs` prints the exact `read:script` command if a file is missing.

**They publish the owner's schema, with his authorisation.** The CLI's output and the rendered
text both name his tables, fields, layouts, scripts and two hosts, and he has ruled that the
trade is worth it: the catalog stays auditable and the data is not sanitised. That authorisation
covers **this directory only**. It is not a licence to let any of it into code or into the
catalog — `assertNoOwnerContent` in `scripts/derive-step-display.mjs` fails the derivation over
a single owner token reaching `src/catalogs/fm-step-display.json`, and the fact that the raw
data sits here is not a reason to weaken that check. The two are different things: data we
deliberately publish, and content that leaked into something meant to be general.

## Reproducing the catalog from these files

```bash
npm run derive:step-display      # writes src/catalogs/fm-step-display.json
npm run roundtrip:step-display   # measures it, and fills in `verified`
```

In that order, both commands, every time — see the README's "step display catalog" section for
why neither is optional.
