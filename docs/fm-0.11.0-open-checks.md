# What the fm 0.11.0 intake left open, and how to close each item

The fm 0.11.0 (29863806) intake made claims that rest on less than a measurement. This document
lists each one and the test that settles it. It also records one claim that a check has already
overturned (item 3).

Every test is one of three kinds, and the kind decides who can run it:

- **R** — read-only against `fmnet://localhost/ooe`. Nothing changes. An agent can run it.
- **W** — writes, but only to a throwaway file: `/tmp/fm-prompt-test/prompt-test.fmp12`, which
  `filemaker --create` made. Ooe is never written. An agent can run it.
- **P** — needs a person at FileMaker Pro: authoring a step through its dialog, collapsing a block,
  or Save a Copy as XML. The person does that part; the reading back is R or W.

"Pro-authored" means a step written through FileMaker Pro's own dialog. "fm-authored" means written
by `create:script` or `update:script`. Every step in the corpus is Pro-authored.

Each item gives the claim, what it rests on now, the procedure, and what each outcome changes.
They are in priority order.

## Results so far (2026-10-16)

The W checks ran on `/tmp/fm-open-checks/checks.fmp12`, a second throwaway file, so that
`prompt-test.fmp12` stayed free for the P steps.

- **1. Overturned again, now with a mechanism.** The Save as XML export of `prompt-test.fmp12` shows
  where FileMaker marks a customised prompt: bits of the step's options word (0x100 Natural
  Language, 0x200 SQL, 0x400 Find Request). Every fm-authored step that sent a prompt had its bit
  set. The Pro-authored step A, left at defaults, has none set, and neither do Ooe's five steps
  (0x4000). So 0.11.0 sends a prompt exactly where FileMaker marks it customised, and Ooe's stored
  texts are uncustomised predefined prompts. Nothing is lost. **Still open:** step B has
  `"MARKER-PRO"` in Template Name, not in SQL Prompt, so a prompt customised in Pro has not been read
  yet.
- **2.** Truncate Table: an fm-authored step reads back as `table: "checks"` with
  `tableSelection: 0`, and the renderer prints `Table: <Current Table>`, ignoring the table. The
  corpus's Pro-authored steps have `tableSelection: 1` and no `table`, while FileMaker prints the
  table. What FileMaker prints for the fm-authored step is the next check, a P one. Configure Region
  Monitor Script: `parameter` is refused (`unknown_step_option`), a gap in the documented surface
  itself. Import Records: the literal XML and XSL paths are in `importOptions.profile.dataRaw`,
  XOR-obfuscated (`2..*` is `http`). A calculated path has no documented key, so it can be neither
  read nor written.
- **3.** Three kinds of "no field", measured on fm-authored steps before and after deleting a field
  and a table:

  | step | 0.11.0 sends | in `problems` |
  |---|---|---|
  | written with no field | no `field` | yes, even intact |
  | field later deleted | `field: {"occurrence":"checks","fieldId":1}` | yes |
  | table later deleted | `field: {"occurrence":1065090,"fieldId":1}`, and Go to Related Record's `from: 1065090` | yes |
  | Ooe's `<Table Missing>` steps (the export stores `FieldReference id="0"` and no occurrence) | no `field` | yes, 17 of 18 |

  The renderer prints the id shapes as `Occurrence: checks ; Field id: 1` and `From table:
  “1065090”`, which is a renderer bug. A calculation naming the deleted field reads back as
  `valueApproximate: "checks::<Field Missing>"`.
- **5.** fm-authored Save a Copy as XML with the switch on round-trips `optionsJson`. The
  Pro-authored half is still open.
- **6. Done.** With all 257 of Ooe's scripts read (the first listing was nested, so it missed
  folders) and matched by step UUID to the 2026-08-07 export, all 17 unmeasured rows took a key.
  15 map uniquely. Two were ties of a value the owner reused, broken by the row's SaXML path. One
  more row (step 179) had been drafted against the wrong slot. `check` exits 0 after the change.
- **7. Done (P).** The screenshot shows `From table: <unknown> ; Using layout: <Current Layout>` as
  the default state of a new step, and it saves. fm writes the same step with a warning, and
  `problems` flags it. `<unknown>` is FileMaker's default for "no table chosen", so the catalog is
  right to print it.

**Second round, the same day.**

- **1. Closed.** A third `wim` step, with the SQL Prompt customised in FileMaker Pro, reads back
  `sqlPrompt: "MARKER-PRO"`; the two left at defaults send no prompt. Nothing is lost. The
  `step:226` rows read "not exercised".
- **3. FileMaker's own text, from Script Workspace on `checks.fmp12`:** a deleted field is
  `checks::<Field Missing>`, a deleted table is `<Table Missing>`, and Go to Related Record's deleted
  occurrence is `From table: <unknown>`. The renderer now writes all three; the tests are in
  `tests/adt-step-display.test.ts`, "a reference whose target is gone". A quoted name reported as a
  number prints `<unknown>`, which also matches Open File's `dataSource: 3` in the corpus.
- **3, and a bug for Claris.** FileMaker does not mark the fieldless Set Field or Cut as problem steps
  (they are not red), but fm's `problems` lists both. fm's help calls `problems` "the same live
  re-check that puts FileMaker Pro's red 'problem step' flag on a step", and for these two steps it is
  not.
- **4.** The collapsed If reads back with no `collapsed` key. An `update:script` that edited only the
  comment inside the block (the If claimed by its `uuid`) has been applied, and whether the block is
  still collapsed in Pro is the remaining look.
- **2, Truncate Table.** `t-truncate` (fm wrote `table` and nothing else) shows `Table: <Current
  Table>` in FileMaker, though fm reads it back as `table: "checks"`. Two more steps are now in
  `prompt-test.fmp12`: `t-truncate-1` (`tableSelection: 1` plus `table`; fm warned that its options
  have a problem) and `t-truncate-0` (`tableSelection: 0` plus `table`). Both read back with `table`.
  Their lines in FileMaker say which value means "this table".

**Round 3.**

- **4. Closed.** The block is still collapsed after fm edited another step in it, so fm's help is
  right: `collapsed` cannot be read, and it survives a write.
- **2, Truncate Table. Closed, a bug for Claris.** `t-truncate-1` shows `Table: <Table Missing>`
  (red) and `t-truncate-0` shows `Table: <Current Table>`. So `tableSelection` 1 means "this table",
  and the table fm writes is one FileMaker cannot resolve, though fm reads it back by name. On Ooe it
  fails the other way: the stored ids, 131 and 139, are base tables (Contacts, summary_fields), the
  register's SaXML path is `List/BaseTableReference`, and fm's `table` is typed as a table
  occurrence. That fm WRITES an occurrence id is inferred from the symmetry; a Save as XML export of
  `prompt-test.fmp12` would show it.

Everything here is now either closed or a recorded report item, except the Pro-authored half of item
5 and the low-priority item 8.

**Waiting on you (round 1, done).** Item 1: redo step B with the marker in SQL Prompt. Item 4, and reading `wim`:
FileMaker Pro holds `prompt-test.fmp12` without sharing it, so close it or turn on sharing. A new
look, for items 2 and 3: open `/tmp/fm-open-checks/checks.fmp12` in Pro and report the lines of
`t-truncate` and `broken-refs`. Those lines are what the renderer fix in item 3 has to reproduce.

---

## 1. Configure Prompt Template's prompts are lost only on Pro-authored steps

**Claim.** 0.11.0 reads prompts back faithfully from fm-authored steps and drops them from
Pro-authored ones, so this is a read bug, not a policy of leaving out defaults.

**Rests on.** Six fm-authored steps in the throwaway file read back with every prompt sent,
including FileMaker's predefined SQL text verbatim and a prompt the step's type does not use. On the
five Pro-authored corpus steps, 0.11.0 sends no prompt, though 0.10.0 showed them as
`slots.calc.3/4/6/7`. Nothing yet rules out a cause particular to Ooe's five steps. Two candidates:
they were written by an older FileMaker Pro, or their template name is a calculation.

**Procedure.**
1. **P** — Open `/tmp/fm-prompt-test/prompt-test.fmp12` in FileMaker Pro 26.1.1 and add a script
   holding two Configure Prompt Template steps through the dialog. Step A: SQL Query, OpenAI,
   prompts left as the dialog fills them. Step B: SQL Query, OpenAI, SQL Prompt edited to
   `"MARKER-PRO"`. Close the file.
2. **W** — `read:script` that script with 0.11.0.
3. **P** — Save a Copy as XML of the throwaway file. Also export the current Ooe, if no export matches
   the reference's 2026-08-30 label.
4. **R** — In the export, compare the `Step[@id=226]` elements of the fm-authored test script against
   the Pro-authored one: which `Calculation` elements hold the prompts, and under which
   discriminators.

**Outcomes.**
- **B reads back with no `sqlPrompt`:** the author is the cause. Step 4 then shows where Pro stores
  the prompts and where fm looks, which is the reproduction to send Claris. The `step:226` rows stay
  open, with that reproduction in `knownFrom`.
- **B reads back `MARKER-PRO`:** the author is not the cause, so it is something about Ooe's steps.
  Diff Ooe's export against the test file's in step 4, and do not report anything until that names
  the difference.
- **A reads back with no prompt but B does:** 0.11.0 does leave out FileMaker's defaults on
  Pro-authored steps. That contradicts the fm-authored t3, so read step 4 before concluding anything.

## 2. Is the same author dependence behind the other values "sent nowhere"?

**Claim, not yet made.** Item 1's result may extend to every Pro-authored value 0.11.0 dropped.
Finding out decides whether the Claris report lists four gaps or one bug with four symptoms.

**Rests on.** Nothing yet.

**Procedure (W).** For each case below, write a step to the throwaway file with fm 0.11.0, using the
key its help documents, then read it back:
- **Truncate Table:** `table` is documented, and the corpus steps send only `tableSelection: 1`.
- **Import Records** from an XML source with an XSL file given by variable: check
  `filemaker help script steps "Import Records"` for the key; the corpus sends neither path.
- **Configure Region Monitor Script:** help documents no parameter key at all. Writing one is
  expected to be refused, and a refusal confirms a gap in the documented surface itself.

**Outcomes.** If fm-authored values round-trip while the Pro-authored corpus values do not, file them
under item 1's bug. If fm also loses them, each stays a separate gap.

## 3. Broken references — the claim already overturned

**Overturned claim.** "A consumer looking for broken references can no longer find a broken field
reference from a read." It appears in the v0.11.0 commit message, which is pushed and cannot be
amended. The register, backlog, docs and code comments have been corrected.

**What was measured (R, done).** `read:script` returns `problems`, FileMaker's own
unresolved-reference check, as one JSON Pointer per step. On script 55 it lists 105 steps, and 17 of
the 18 that print `<Table Missing>` are among them. The one it misses is the MBS plug-in step.

**Still open.**
1. **W** — Which reference does `problems` flag? Make a table with a field, then write three steps:
   a Set Field naming the field, a Set Field naming no field, and a Set Field whose calculation uses
   the field. Delete the field and read the script. Expected: steps 1 and 3 are flagged and step 2 is
   not, which would make "flagged, and reports no `field`" a usable test for `<Table Missing>`.
2. **Answered by 3.1: do not pass `problems` to the renderer.** It would not help. `problems` flags a
   deliberately fieldless Set Field or Cut exactly as it flags a broken one (measured on fm-authored
   steps; a Pro-authored fieldless step is worth one look in the same session), so printing
   `<Table Missing>` on "flagged and no field" would print it on intact steps. What remains is two
   things. The deleted-target case, where fm sends ids, is the renderer's to fix on its own, once
   FileMaker's own text for it is known (see "Waiting on you"). The id-0 case reads exactly like no
   field, by any route, so those lines render without the placeholder.
3. **R** — Why the plug-in step is not flagged. Low priority.

## 4. `collapsed` cannot be read, but survives a write

**Claim.** 0.11.0 does not report whether a block is collapsed. Its help says the state is kept on a
write that claims the step by `uuid`.

**Rests on.** The help text, and the corpus: `collapsed: true` on one If and one Else If under 0.10.0,
absent under 0.11.0. The "kept on write" half is untested.

**Procedure.**
1. **P** — In the throwaway file, add an If … End If through Pro, collapse it, and close the file.
2. **W** — Read it and confirm no key says it is collapsed. Then `update:script` with an `edits` `set`
   on a different step.
3. **P** — Reopen the file in Pro. Is the block still collapsed?

**Outcomes.** Still collapsed: the register rows stay open (a read gap only), and the help is right.
Expanded: a write loses it too, which is a worse gap to report.

## 5. Save a Copy as XML's options calculation — "not exercised"

**Claim.** 0.11.0 sends `optionsJson` only while `specifyOptionsAsJson` is on. The register row says
"not exercised".

**Rests on.** One probe instance with the switch off. No instance with it on has been read.

**Procedure.** **W**: write the step with the switch on and an `optionsJson`, then read it. **P**:
author one through Pro with the switch on, then read it.

**Outcomes.** Both read back: the row's reading stands. Only the fm-authored one: it joins item 1.

## 6. The 17 slot rows marked "unmeasured"

**Claim.** None: these rows say only that no instance read so far shows which named key carries the
value, because the corpus has no instance of the slot. They are on Replace Field Contents (3),
Convert File, Perform SQL Query by Natural Language and Generate Response from Model (2 each), AVPlayer
Play, AVPlayer Set Options, Execute SQL, Install OnTimer Script, Perform Script on Server, Configure
Region Monitor Script, Insert Image Caption and Perform Semantic Find (1 each). The last is a
four-way tie in the corpus rather than an absence.

**Procedure (R).**
1. Read every script in Ooe with 0.11.0, not just the two corpus scripts.
2. For each row, take the instances of its step type.
3. Read the value at the row's SaXML path out of a current Ooe export (item 1, step 3).
4. Look for a 0.11.0 key holding that value on every instance: the same matching used to map the 21
   rows the corpus could settle.

**Outcomes.** One key on every instance: set `fmKey`. No key: the value is dropped, so the row opens
and is checked against item 1. Ambiguous: the row stays unmeasured, with the candidates listed.

## 7. Go to Related Record's `From table: <unknown>`

**Claim, held by the catalog.** When `from` is absent, FileMaker prints `<unknown>`. The catalog
prints it unconditionally, which is the pattern you ruled out for Set Field.

**Rests on.** 2 corpus examples. Whether a Go to Related Record can lack a table on purpose, or
`<unknown>` always means a broken reference, is not known.

**Procedure.** **P**: in Pro, try to save a Go to Related Record with no table chosen. **W**: read any
such step, and one whose table occurrence was deleted, and check whether `problems` flags each.

**Outcomes.** Only reachable as a broken reference: keep the placeholder, and add it to
`BROKEN_REFERENCE` handling once item 3.2 is decided. Reachable on purpose: needs your ruling, as Set
Field did.

## 8. Two bit rows resting on weak readings

- **Execute SQL, bit 0x4000** (open). It does not follow `sql`. Its meaning is unknown, so it is
  unclear whether anything is lost. **P**: toggle each Execute SQL option in Pro on a throwaway step,
  then **W**: read after each toggle.
- **AVPlayer Play, bit 0x4000** (`wontfix`: "probably not an option of its own"). The `<Active
  Object>` reading follows neither `source` nor `objectName` exactly, 3 of 13. Same procedure. If an
  option turns out to be lost, the row reopens.

Low priority: neither changes a printed line in the corpus.

---

## Already measured, not open

These were checked during the intake and need no test: the launcher; `behaviour` (no change); the
21 slot rows and 7 bit rows mapped by matching every corpus instance; the 8 slot rows whose value
the corpus shows 0.11.0 carrying nowhere (AVPlayer's ids, Get File Exists/Size's target variable); `tags` (every TagList in Ooe
is empty); `createFolders` on Append PDF and Open PDF (FileMaker Pro Help lists no such option); the
consumer-impact figures (the 0.10.0 catalog prints 149 more values by the baseline on 0.11.0 data);
and the broken-reference rule on 0.10.0 data (the three steps join bit 0x1).
