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

**Re-read with fm 0.8.0-beta.0 (build 29827611) on 2026-09-21.** This build replaced the
options blob on eleven step types with structured objects, so both `.adt.json` files were
re-read with nothing but `read:script` and rewritten in place. 96 of the 1155 steps changed
key set; `20260625_missing.adt.json` came back byte-identical, so none of its 48 steps was
affected. What moved, by step type: `opaque`/`editable`/`reason` gone and named options in
their place on Import Records (38 examples), Export Records (15), Print (10) and Page Setup
(4); `spec` replaced by `findRequests` on the four Find steps (8) and by `sortOrder` on Sort
Records (7); `slots` replaced by named keys on Replace Field Contents (10) and by `menuSet`
on Install Menu Set (1); and ExternalStep gained `arguments`, `pluginDescription` and
`pluginStep`. Both scripts still report 48 and 1155 steps and the `.txt` halves are
unchanged — the Script Workspace draws the same lines it always did.

The derivation gained from it: 17 more segments (560 -> 577) and two more verified step types
(Page Setup and Set Variable, 136 -> 138). No step type lost its verification. Export Records
and Page Setup went from rendering nothing at all — `residual: {opaque: N}` — to rendering
their options. What the corpus does NOT yet reach is the inside of the new objects:
`importOptions`, `exportOptions`, `printOptions` and `pageSetup` are read but rendered by
nothing, which is the 937 -> 1139 rise in the `withheld` count that
`tests/step-display-catalog.test.ts` pins and explains.

**Read back with fm 0.7.0 (build 29823677) on 2026-09-16.** That build renamed every
multi-word option key to camelCase — `with dialog` -> `withDialog`, `verify SSL
certificates` -> `verifySslCertificates`, `append to existing file` ->
`appendToExistingPdf` — and the catalog is keyed on those names, so both `.adt.json`
files were re-read with nothing but `read:script` and rewritten in place. 181 distinct
old key spellings moved; three VALUES moved with them (`openAI` -> `openAi`,
`goToURL` -> `goToUrl`, and two members of `barcodeTypes`). Neither script itself was
touched, both still report 48 and 1155 steps, and the `.txt` halves are unchanged —
the Script Workspace draws the same lines it always did. The 0.6.0-era JSON is in git
history if a spelling needs checking against it.

One thing the re-read cost, recorded here because it is a fact about the DATA rather than
about any one derivation: six segments moved from `anchored` attribution to `labelWords`
(`verifySslCertificates` on three step types, `selectPerform`, `skipAutoEnterOptions`,
`overrideEssLockingConflicts`, `formatForFineTuning`). `anchored` means the key's own
spelling reproduced FileMaker's label exactly, and a 0.6.0 key could do that because it
carried FileMaker's acronyms, slashes and hyphens — `verify SSL certificates`,
`select/perform`, `skip auto-enter options`. camelCase spells none of the three, so those
labels are now attributed by shared words instead. Nothing's confidence moved.

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
