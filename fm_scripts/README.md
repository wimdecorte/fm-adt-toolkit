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

**Re-read with fm 0.11.0 (build 29863806) on 2026-10-14.** Both `.adt.json` files re-read with
nothing but `read:script`, BaseElements and MBS loaded; still 48 and 1155 steps, `.txt` halves
unchanged. **Every step lost `flags`**, and nothing carries `slots` any more: fm's help now says only
an opaque step carries the raw word and every other step "describes its options with named keys".
Beyond `flags`, 5 of the 48 and 192 of the 1155 steps changed key set, and none changed a value under
the same keys. Three shapes:

- **An unnamed value is named.** Go to Related Record's window (`name`, `width`, `height`, `left`,
  `top`, and the switch itself, `showInNewWindow`, on all 23); Insert from Device's `maximumDuration`,
  `title`, `message`, `prompt`, `scanFrom`, `scanFromField` and `startImmediately` (16); field
  repetitions as `fieldRepetition`, `repetition` or `<key>Repetition` on seven step types. Options that
  lived only in the word got keys too: `on` (Allow Formatting Bar, Set Layout Object Animation, Set
  Revert Transaction on Error), `openAutomatically` and `createEmail` (the three Save Records as … steps),
  `currentFileOnly` (Move/Resize Window), `newWindow` (Go to List of Records, 19), `encodeUrl` (Trigger
  Claris Connect Flow).
- **A value FileMaker stores and does not print is no longer sent** — 115 `slots` places: AVPlayer's
  script and member ids (59), Perform Semantic Find's (10), the unused target variable of six Insert and
  Get steps, `createFolders` on Append PDF and Open PDF, which FileMaker Pro Help does not list for
  either, and `collapsed: false` everywhere.
- **Some values FileMaker DOES print are now sent nowhere.** Configure Region Monitor Script's
  `Parameter:` (5 steps), Import Records' XML and XSL paths, Configure Prompt Template's prompt texts
  (5 steps, not printed, and none of the four prompt keys fm's help documents is sent), `collapsed:
  true` on If and Else If, and — with the raw word — FileMaker's `<Table Missing>`: on 18 steps of
  seventeen types a broken field reference now reads exactly like no field. See section 5 of
  [docs/fm-step-display-backlog.md](../docs/fm-step-display-backlog.md).

Derived and round-tripped: verified 148 → 150, byte-identical lines 962 → 970 of 1203. Lost: the
eleven step types whose `<Table Missing>` followed bit 1 of `flags`. Gained: thirteen, mostly where a
stale value had printed (the six Insert and Get steps, Configure Prompt Template, Configure Local
Notification) or a new key renders (the three Save Records as … steps, the three `on` steps). One
derivation change came with it: a withdrawal may now re-match its example without the withdrawn key
(`rematch`), which Go to Related Record needed once 0.11.0 named the window. The owner's window
"new window" made the matcher pair `name` with `New window` on five steps; withdrawn without
re-matching, the option kept only three steps, and the hidden-option search blamed `target`.

**Re-read with fm 0.10.0 (build 29853940) on 2026-10-09.** Both `.adt.json` files re-read with
nothing but `read:script`, BaseElements and MBS loaded; still 48 and 1155 steps, `.txt` halves
unchanged. 3 of the 48 and 108 of the 1155 steps changed key set, and 13 more of the 1155 changed values
under the same keys. Three shapes account for nearly all of it:

- **A value that was a bare number is named.** `stepValue` became `mode`, `state`,
  `callbackState`, `source`, `arrangement`, `to`, `target` and `action` on eleven step types — the
  pause, AVPlayer, callback, window, toolbar, ruler, menubar and undo steps — and `slots.memberKey`
  became `menuSet` on Install Menu Set. Add Account gained `privilegeSet` (11), which no build reported
  before; Configure AI Account gained `provider: chatGpt`; Configure Regression Model `action` (7);
  Go to Related Record `style`, its new window's style (8).
- **A stored setting FileMaker does not apply is no longer sent.** A layout id of 0 beside a layout
  given by calculation or `<Current Layout>` (Go to Layout 12, Go to List of Records 12, New
  Window 3); the stale `script` beside `scriptName` on the three Perform Script variants; Save
  Records as PDF's slots and Save Records as Excel's `records` where Restore is off;
  `verifySslCertificates` unless the AI provider is Other.
- **A field reference's repetition is reported**, as `slots.fieldRepetition`, on seven step types
  (40 places) — the number FileMaker appends in brackets.

Two value changes ride along: Save Records as Excel's `useFieldNames` is now a boolean on every step
that restores its options, where 0.9.0 sent `1` on the one step whose option is OFF; and Sort
Records' `sortOrder` carries `maintain` and `blanksLast` on every step instead of a raw `flags`.

Derived and round-tripped: verified 145 → 148 with none lost, byte-identical lines 921 → 962 of
1203. Gained: Configure AI Account, Configure Regression Model, Insert Image Captions in Found Set.
Three derivation changes came with it, each because a 0.10.0 change left a rule describing nothing
or left a tie. `HIDDEN_WHEN` is empty: fm itself no longer sends `script` beside `scriptName`, which
is what the rule was for. A new `PRESENCE_KEY` keeps `Specified: From list / By name` on
`scriptName`, which the two keys now predict equally well — 0.9.0's corpus is what tells them
apart. And two withdrawals gained a FileMaker Pro Help attestation, so Go to Related Record's window
name and AVPlayer Play's `source` are measured never shown rather than printed: Go to Related Record
had begun appending `Calc: "<window name>"` and AVPlayer Play a second `Object Name:`.

**Re-read with fm 0.9.0 (build 29846589) on 2026-10-01.** Both `.adt.json` files re-read with
nothing but `read:script`; still 48 and 1155 steps, `.txt` halves unchanged. 2 of the 48 and 66 of
the 1155 steps changed key set. By step type: Insert File's 14 opaque steps are decoded
(`fileTypeFilters`, `storage`, `display`, `dialogTitle` and more), so no step in either file is
opaque any more; `curlOptionsSpecified` became `encodeUrl` on Insert from URL (8), inverted;
`enabled` left Set Error Logging (3), whose `on` now reads the option instead of `false`;
`stepValue` became `spellingLanguage` on Set Dictionary (2); data sources moved from `slots` to
named keys (`dataSource`, `sourceOptions` on Convert File, `sql` on Execute SQL); the AI steps'
`parameters` calculation became `llmParameters`, and `parameters` is now the list that `slots`
calc 30 and 31 held; Perform JavaScript in Web Viewer's `arg1`/`arg2` became one `parameters` list;
and `slots.fileReference: "Current File"` is no longer sent on 28 steps.

**Read with BaseElements loaded, and that is a condition of this data.** The first re-read ran
while the machine's plug-ins were not yet updated for FileMaker Pro 26.1.1, and fm then returned
script 55 step 6 — a Set Variable calling `BE_CurlTrace` — as `valueApproximate` with `<Function
Missing>` in place of the call, which cost Set Variable its verification. Re-read with the plug-in
loaded, that step is back to `value` and nothing else differs. Check
`fm-cli --harvest-plugins=<path>` before refreshing these files.

Derived and round-tripped: verified 138 → 145 with none lost, byte-identical lines 894 → 921 of
1203. Two derivation changes came with it. A structured option is now seen member by member
(`expandStep`), so `sql.query`, `printOptions.printer` or `importOptions.targetTable` can be placed
where FileMaker prints them, while an option whose other members FileMaker never shows keeps one
claim for the whole object. And a list FileMaker prints whole is measured as `listForm: 'joined'`.
Gained: Insert File, Insert from URL, Perform Script, Execute SQL, Print, Perform JavaScript in Web
Viewer and Insert Embedding. Export Records' two lines that matched by luck no longer match: its
`Macintosh` was the export character set, which the CLI reports on one step of eleven.

**Re-read with fm 0.8.0 (build 29834929) on 2026-09-23.** GA. Both `.adt.json` files re-read with
nothing but `read:script` and rewritten in place; still 48 and 1155 steps, `.txt` halves unchanged.
12 of the 48 and 312 of the 1155 steps changed key set, and the bulk of that is one uniform change:
**`flags` is now reported even when the word is zero**, so ~300 steps that omitted it gained it
(210 of them comments). Beyond that: `Set Error Logging` gained `on` (3 examples), one `Set Variable`
traded `value` for `valueApproximate`, and `Set Zoom Level` swapped `slots` + `stepValue` for
`customZoomLevel`.

Derived and round-tripped: verified 138 → 138 with none lost, segments 577 → 578.

One thing the re-read settled, recorded here because it is a fact about the DATA: the catalog had
been rendering a trailing `; Step value: 11` on the one Set Zoom Level example with a calculated
zoom level, because the beta sent `stepValue` alongside the calc. FileMaker's own line for that step
draws no such segment. GA stopped sending the key, so the spurious segment is gone — which is why
the `rendered` floor in `tests/step-display-catalog.test.ts` FELL by one and why that fall is an
improvement rather than a regression. `Set Zoom Level` is `verified: false` before and after, for an
unrelated reason: the `%` suffix still does not render.

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
