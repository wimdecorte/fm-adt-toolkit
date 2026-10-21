# What the fm 0.12.0 intake left open, and how to close each item

The fm 0.12.0 (42) intake renamed about 80 register rows and made a handful of claims that a rename
does not settle. This document records the ones already measured and lists the three that still rest
on less than a measurement, with the test that settles each. Same kinds as
[fm-0.11.0-open-checks.md](fm-0.11.0-open-checks.md):

- **R**: read-only against `fmnet://localhost/ooe`. An agent can run it.
- **W**: writes only to a throwaway file `filemaker --create` made. An agent can run it.
- **P**: needs a person at FileMaker Pro. The person does that part; the reading back is R or W.

The 0.11.0 items are not repeated here. One part of its item 2 closed with this build (below); the
rest read as they did.

## Measured during the intake (2026-10-20)

- **The relation's right side (W).** Ooe's ten relationships have no right-side flag set, so
  `rightRecords` = 0.11.0's `leftToRight` rested on elimination. Written into a scratch file:
  `create:relation` Parents -> Kids with `rightRecords: {createRelated: true, cascadeDelete: true}`
  reads back so, and fm's `effects` say records are created in, and deleted from, Kids. 0.12.0 names
  the table a flag applies TO, as Save as XML does, and the direction inversion 0.11.0 had is gone.
- **Configure Region Monitor Script's `parameter` (W, closes half of 0.11.0's item 2).** 0.11.0
  refused it on a write (`unknown_step_option`) and sent it nowhere on a read. 0.12.0 writes
  `"P-MARKER"` and reads it back, and sends `"1"` on all five Pro-authored corpus steps.
- **A custom menu's base menu (R).** 0.12.0 dropped `baseMenuID` and reports `baseMenu` by name:
  `saveSendRecords` on id 6, `gotoRequest` on id 14, absent on MyCustomMenu, which has no base. The
  register's "base menu name" gap closed; its "base menu id" row became wontfix.
- **`detail` beside an address (R).** Sent with `name` or `id`, `detail: true` is refused with
  `invalid_field` ("'detail' is not accepted when 'name' is also given") on script, valueList, table,
  tableOccurrence, customFunction, privilegeSet, account, customMenu, relation, field and theme. 0.11.0
  accepted it. Layouts still take it, and so does a list (`read:field` by table, `read:theme`,
  `read:externalDataSource`). A read by name is at full depth without it.

## 1. A popover's stored position is derived from its button (P)

**Claim** (register `layout-object:popoverpanel`, rows "position and size", "left edge", "top edge",
now wontfix): FileMaker Pro places a popover beside its button each time it opens, so the position
Save as XML writes is a by-product, and 0.12.0 losing it loses nothing.

**Rests on:** fm's help ("A popover has no position to set: Pro draws it beside its button each time
it opens, so `bounds` is refused on it"), FileMaker Pro Help offering only the direction it opens in,
and arithmetic on Ooe's only popover: left 989 is 11 pt past the button's right edge (758 + 220),
and its vertical centre, 479.5, is the button's, 479. One instance.

**Procedure:** in FileMaker Pro, on a copy of Ooe, move MyPopoverButton (id 57) by a known offset,
change its popover to open on top, and Save a Copy as XML. Compare popover 58's `Bounds` with the
2026-08-30 export.

**Outcome:** if the bounds moved with the button and to its new side, the claim holds and the rows
stay wontfix. If they stayed put, or a popover can be dragged to a position of its own, the
position is a stored fact fm no longer reports: drop the wontfix on all three rows and report it.

## 2. Where Save as XML keeps `fixedWidth` (W, then P)

**Claim** (register `layout-object:text`, row "label keeps a fixed width (fm only)"): new in 0.12.0,
true on the probe label, and with no SaXML path yet. `Text/Options`, which no build decodes, is the
candidate.

**Procedure:** in a scratch file, place two labels with `create:layout` that are identical apart
from `fixedWidth` (true and false), and read them back (W). Open the file in FileMaker Pro and Save a
Copy as XML (P). Diff the two `LayoutObject` elements.

**Outcome:** the one attribute or bit that differs is the row's `path`: rewrite the row from
"(fm only)" to that path. If nothing differs, FileMaker stores it somewhere the export does not
write, and the row stays "(fm only)" with that said.

## 3. Whether a file can still hold the Spelling option 0.11.0 called `flash` (P)

**Claim** (register `file-options`, row "beep on questionable spellings (fm only)"): 0.12.0's boolean
`beepOnQuestionableSpellings` replaces 0.11.0's enum `spellAsYouType` (`off`, `beep`, `flash`)
without loss, because the Spelling tab offers only Off and Beep.

**Rests on:** FileMaker Pro Help's Spelling tab table (Off; Beep on questionable spellings; the
separate underline checkbox). Ooe reads `off` and `false`, so it exercises neither of the other two.
0.11.0 documented a third stored value it called `flash`; where FileMaker sets it, if anywhere
today, is not known.

**Procedure:** set Beep on questionable spellings on a copy of Ooe in FileMaker Pro, then
`read:fileOptions` with 0.12.0 (R). Do the same with any file found whose Spelling option is neither
Off nor Beep.

**Outcome:** Beep must read `true`. A flash-set file reading `false` means 0.12.0 folds a stored
value into "off"; note it on the row and in the Claris report. Reading `true`, or no such file to
be found, leaves the row as it is.
