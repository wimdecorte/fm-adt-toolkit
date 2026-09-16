# The Claris ADT `fm` CLI's `flags` word, step type by step type

A reference for anyone — another tool, another developer, an agent's context — reading the
`flags` integer that the Claris ADT `fm` CLI reports on a script step, and trying to work
out what FileMaker Pro's Script Workspace will print for that step.

Every statement here was measured against 1203 real script steps, each held twice over: the
CLI's own JSON for the step, and the line FileMaker's Script Workspace drew for that same
step. Nothing is a guess about FileMaker, and where the evidence is one example it says so.
Every figure below is printed by one script, so nothing here is asserted only in prose —
[how to reproduce every figure](#how-to-reproduce-every-figure) is at the end.

The key names are fm 0.7.0's (build 29823677), which respelled every multi-word option key
in camelCase — `with dialog` became `withDialog`. Only the spellings moved: on the same 1203
pairs re-read with 0.7.0 every count below is what 0.6.0 gave, but for one group. 0.6.0 spelt
`verify SSL certificates` and `verify SSL Certificates` as two different keys and 0.7.0 spells
both `verifySslCertificates`, so their two redundancy groups are now one and the group total
is 225 rather than 226.

---

## Read this before anything else: there is no global bit table

**A bit is a position in the step's own word, not a flag with one meaning.** The same
position means unrelated things on unrelated step types, and a table of the form
"`0x100` = …" cannot be written. If you take one thing from this document, take that.

Measured, on the perfect predictors this corpus contains — a bit whose set/clear split
exactly matches whether FileMaker printed some option, with the option's text being
FileMaker's own fixed wording:

| Bit | Distinct (step type, option) claims |
|---|---|
| `0x4000` | 39 |
| `0x80` | 36 |
| `0x1000` | 28 |
| `0x100` | 27 |
| `0x1` | 25 |
| `0x2000000` | 21 |
| `0x20` | 20 |
| `0x200` | 19 |
| `0x20000` | 18 |
| `0x800` | 16 |

`0x100` alone lines up perfectly with 27 different options across 14 step types —
`Skip data entry validation` on one, `Wait for completion: Off` on another, `External` on a
third, `Append` on a fourth, `Allow Folder Creation` on a fifth. Only one of those 27 is a
fact this document records; the rest are either a duplicate of a key the CLI already sends
by name, or a coincidence. **So the unit of a fact here is `(step type, bit)`, and a
`(step type, bit)` attribution is never rejected because the same bit means something else
on another step type.** That is expected, and it is the structure of the data.

The corollary matters as much: a bit's meaning on a step type this corpus does not cover is
unknown. Do not extrapolate a row of the tables below sideways.

---

## What is in here, and how each entry is evidenced

Three kinds of statement, kept apart because they are worth different things to a consumer:

1. **A fact** — a `(step type, bit)` pair that supplies an option FileMaker prints, in
   FileMaker's own fixed wording, which no key the CLI sends already carries. 18 of these,
   on 15 step types. These are the only rows worth reading a bit for.
2. **A redundancy** — the bit lines up perfectly, and so does a key the CLI already sends
   by name. 177 distinct `(step type, bit)` pairs. **Prefer the key.** It carries a value
   rather than one bit of state, and it means the same thing on every step type that sends it
   — which is exactly what a bit does not do.
3. **A presence** — the bit says an option is *there* without saying what it says. 2 of
   these. Useful for deciding whether to print an option slot; useless for filling it.

Each fact carries:

- **condition** — `always`, or `when <key> is absent`. The second is the shape FileMaker's
  broken-reference placeholder needs: the CLI reports no key at all for a broken field
  reference, exactly as for a step with no field, and the bit is the only thing that tells
  the two apart. It is also the only shape available on a step whose keys are all absent.
- **evidence** — how many examples of that step type carried the option, out of how many
  the condition scopes. Read both numbers: `3 of 4` means one single step is doing all the
  discriminating.
- **confidence** — `measured` when every state of the option recurs (two or more examples
  inside that step type); `low` when any state rests on exactly one example. A single
  example is never `measured`: one transposed pair invents a fact, and neither recurrence
  nor injectivity catches that.

Facts are also injective inside a step type: no two bits for one option, no two options for
one bit. 23 candidate attributions were dropped for failing that, and they are listed, so
nobody re-finds them and believes them.

---

## The facts, keyed by step type

### `Allow Formatting Bar`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x20000` | always | set → `On`, clear → `Off` | 1 and 1, of 2 | **low** (single example each way) |

This step type has **two examples in the whole corpus**, one of each state. The CLI reports
no key at all for the state, so the bit is the only thing there is — and one example per
state is exactly as much evidence as that sentence sounds like.

### `AVPlayer Play`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x4000` | always | clear → `Object Name: <Active Object>` | 1 of 14 | **low** (single example) |

One example of 14. **Better read another way**: FileMaker prints the active-object
placeholder when the CLI reports no object-name key, which is an absent-key default and
needs no bit. Prefer that reading.

### `Close File`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x10` | always | clear → `Current File` | 1 of 2 | **low** (single example) |

Two examples in the corpus. As with `AVPlayer Play`, the cheaper reading is an absent-key
default: FileMaker prints `Current File` when the CLI reports no file key.

### `Exit Script`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x4000` | always | clear → `Text Result:` with nothing after it | 1 of 3 | **low** (single example) |

An empty option slot. FileMaker appears to print the label of an option it has no value
for, on this and five other step types, and that rule explains all of them without a bit.
Treat this row as a curiosity rather than a mechanism.

### `Export Field Contents`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x1` | when `field` is absent | set → `<Table Missing>` | 1 of 3 | **low** (single example) |

The same broken-reference bit described under
[the one bit a consumer may already be reading](#the-one-bit-a-consumer-may-already-be-reading).
The catalog that consumes this reads it on eleven step types; this is a twelfth, where it does
not.

### `Export Records`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x80` | always | set → `With dialog: Off`, clear → `With dialog: On` | 12 and 3, of 15 | **measured** |

Every `Export Records` step in this corpus is one the CLI cannot read — it reports
`{opaque, editable, reason}` and no options at all — so the number is the only material
there is, and this bit is the one thing in it that pays.

### `Go to Related Record`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x100` | always | set → `External` | 1 of 23 | **low** (single example) |

One example of 23. Note that `0x100` is the position with 27 unrelated claims across the
corpus, so a single example on it is the weakest kind of row in this document.

### `Import Records`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x80` | always | set → `With dialog: Off`, clear → `With dialog: On` | 8 and 30, of 38 | **measured** |
| `0x10000000` | always | set → `Verify SSL Certificates` | 1 of 38 | **low** (single example) |

All 38 are steps the CLI cannot read. `0x10000000` carries the same meaning on three
readable step types, where a key the CLI sends says the same thing — see
[redundancies](#bits-that-duplicate-a-key-the-cli-already-sends).

### `Insert File`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x8000` | always | set → `Filters` | 14 of 31 | **measured** |

A clean split: the 14 steps the CLI cannot read all have the bit and all print `Filters`;
the 17 it can read have it clear and none of them does. **`Filters` is `Insert File` only**
— `0x8000` also marks the presence of a find/sort/filter sub-object on other step types,
and none of those prints that word.

### `Page Setup` (FileMaker displays this step as `Print Setup`)

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x80` | always | clear → `With dialog: On`, set → `With dialog: Off` | 3 and 1, of 4 | **low** (one example for the `Off` state) |
| `0x2000000` | always | set → `Restore` | 3 of 4 | **measured** |

Four steps, three different lines, and the JSON is identical apart from the step's own id
and this number — so the number is provably the only cause. This is the cleanest single
demonstration that `flags` carries display information at all.

### `Perform JavaScript in Web Viewer`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x4000` | always | clear → `Object Name: <Active Object>` | 1 of 2 | **low** (single example) |

Two examples. Same shape and same caveat as `AVPlayer Play`: an absent-key default is the
cheaper reading.

### `Print`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x80` | always | clear → `With dialog: On`, set → `With dialog: Off` | 4 and 6, of 10 | **measured** |

All 10 are steps the CLI cannot read. `Print` also has a `Restore` option that `0x2000000`
predicts on 8 of the 10 — but there FileMaker prints a printer's name after the label, and
no number holds a name, so that is a [presence](#presence-without-text), not a fact.

### `Save a Copy as Add-on Package`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x4000` | always | clear → `Window name:` with nothing after it | 1 of 4 | **low** (single example) |

Another empty option slot; see `Exit Script`.

### `Save Records as JSONL`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x20000000` | always | set → `Automatically open` | 3 of 4 | **measured** |
| `0x40000000` | always | set → `Create email` | 2 of 4 | **measured** |

These two options are separable here and nowhere else in the corpus: on
`Export Records` they always appear together, so both bits predict both options and
injectivity refuses all four combinations. That is why the pair earns two facts on this
step type and none on that one — and it is also why the two bits must not be carried across
to a step type where nothing separates them.

### `Set Layout Object Animation`

| Bit | Condition | What FileMaker prints | Evidence | Confidence |
|---|---|---|---|---|
| `0x20000` | always | set → `On`, clear → `Off` | 1 and 1, of 2 | **low** (single example each way) |

Two examples, one of each state, no key reported for the state. Same standing as
`Allow Formatting Bar`.

---

## The one bit a consumer may already be reading

`0x1`, when the key naming a field is **absent**, means the field reference is broken and
FileMaker prints its placeholder — `Go to Field [ <Table Missing> ]`. The step reports no
field key at all, exactly like a step with no field, and this bit is the only thing that
distinguishes them.

`src/catalogs/fm-step-display.json` reads it on **eleven** step types today. This
per-step-type measurement recovers **nine** of the eleven, each on one example inside that step
type: `Clear`, `Copy`, `Cut`, `Go to Field`, `Insert from Index`, `Insert from Last Visited`,
`Paste`, `Relookup Field Contents`, `Set Next Serial Value`. It also finds a **twelfth** step
type carrying the same bit that the catalog does not read — `Export Field Contents`, in the
facts above.

**It cannot credit the remaining two of the eleven** — `Insert Calculated Result` and
`Insert Text`. On each, another key's *value*
happens to split those examples the same way (`value` on one, `select` on the other), and
inside a single step type nothing separates the two explanations. Only looking across step
types does, because the coincidence does not repeat. **That is the honest cost of
per-step-type attribution: it is stricter evidence with less of it, so a coincidence is
likelier and a step type with one example is unreachable.** Both directions of the trade
are real; neither method dominates.

---

## Presence without text

The bit lines up with whether an option appears, and the text under that option is
something no number can hold. Useful for deciding whether to print the slot at all.

| Step type | Bit | The option | Evidence |
|---|---|---|---|
| `Print` | `0x2000000` set | the `Restore` option appears | 8 of 10 — but two different texts under that label, each a printer's name |
| `Execute SQL` | `0x4000` clear | the `SQL Text` option appears | 2 of 3 |

There were 23 candidates for this list. **21 of them are predicted just as exactly by
whether the CLI reports some key**, mostly on FileMaker's newer AI-related steps
(`Generate Response from Model`, `Perform Semantic Find`, `Configure Regression Model`,
`Perform SQL Query by Natural Language`, `Insert Embedding`, `Perform Find by Natural
Language`, `Perform RAG Action`, `Insert Image Captions in Found Set`). On those, read the
key.

---

## Bits that duplicate a key the CLI already sends

**177 distinct `(step type, bit)` pairs**, 360 claims in 225 groups. Every one of them is a
bit that lines up perfectly with an option FileMaker prints — and so does a named key, which
is why none of them is a fact. A consumer should read the key.

The largest groups, by number of claims:

| Bit | Option | Claims | Step types | The key that already says it |
|---|---|---|---|---|
| `0x80` | `With dialog` | 44 | 23 | `withDialog` |
| `0x1000` | `Select` | 14 | 13 | `select` |
| `0x2000000` | `Restore` | 7 | 7 | `restore` |
| `0x1000000` | `Pause` | 6 | 3 | `pause` |
| `0x4000` | `With dialog` | 6 | 3 | `withDialog` |
| `0x1` | `With dialog` | 4 | 2 | `withDialog` |
| `0x200` | `Create folders` | 4 | 2 | `createFolders` |
| `0x20000` | `On` | 3 | 3 | `on` |
| `0x20000` | `Off` | 3 | 3 | `on` |
| `0x800` | `Specified` | 3 | 3 | the presence of `scriptName` |
| `0x2000000` | `Specified` | 3 | 3 | the presence of `scriptName` |
| `0x8` | `Using layout` | 3 | 3 | `target` |

`0x2000000` is the instructive one, because it looks like a win and mostly is not. Per step
type it predicts `Restore` perfectly on nine step types — `Constrain Found Set`,
`Enter Find Mode`, `Extend Found Set`, `Page Setup`, `Perform Find`, `Print`,
`Save Records as Excel`, `Save Records as PDF`, `Sort Records`. On **seven** of the nine the
CLI sends a `restore` key of its own and the option is already written from it. On `Print`
the bit only says the option is there. Exactly **one** of the nine, `Page Setup`, is a step
type where the bit is the only source — and `Page Setup` is one of the five step types the
CLI cannot read at all. Note also that `Adjust Window [ Restore ]` is a different option
entirely (a window state, from the `state` key) and is not a counter-example to any of this.

---

## What `flags` demonstrably does not carry

`flags` carries FileMaker's checkboxes and two-state options. **It does not carry a name, a
path, a calculation, or a choice from a long list**, and the same test that proves it carries
information proves that limit: group the steps by `(step type, flags value)` and look for a
group where one value of the number goes with more than one FileMaker line. **113 such
groups exist.** No reading of the number can tell those lines apart.

Three measured counter-examples, chosen because what differs inside each is exactly the kind
of thing a number cannot hold:

| Step type | One `flags` value | Different lines | What actually differs |
|---|---|---|---|
| `Export Records` | 11 steps | 9 | the text encoding — nine of them on one value of the number |
| `Import Records` | 13 steps | 12 | the import action **and** the text encoding |
| `Add Account` | 11 steps | 11 | a privilege set name |

The `Add Account` row is the plainest: a privilege set is a name, and a name could never be
in a number.

The counterpart figure is worth stating beside it. Of 1203 steps, **883 report a `flags`
value and 320 report none at all.**

---

## What this data cannot tell you

Five limits, each of which a consumer can act on wrongly if it is not stated.

1. **The corpus is two scripts from one FileMaker file.** 1203 steps covering 209 step
   types, written by one person. **A bit unobserved here is unknown, not absent.** Nothing
   detects that from inside the data; only wider data, or a check against FileMaker itself,
   narrows it.

2. **None of the 1203 steps is disabled.** `CLAUDE.md` records that a step's disabled state
   is a top-level key of its own and is *not* in `flags` — that the number is byte-identical
   between a disabled and an enabled step. **This data can neither confirm nor contradict
   that**, because it contains no disabled step to test it with. That claim rests on a
   separate, earlier measurement, and this document adds nothing to it either way.

3. **A `low` row is one example.** It is recorded so nobody has to rediscover it, not so it
   can be implemented. Eleven of the eighteen facts are `low`, and five of those are on step
   types with two or three examples in total.

4. **"No bit predicts this" means "no bit predicts it across these two scripts."** Where the
   number provably cannot help, this document says so with the 113 collision groups rather
   than resting on an absence.

5. **Two guards stand between a lined-up bit and a fact here, and they are not
   infallible.** An automated bit search finds coincidences: an earlier pass credited a
   `Set Error Logging` option to a bit when the whole difference was one letter's case in a
   value the CLI does send, and credited `Filters` to a key when none of the 15 steps
   carrying that key prints `Filters`. So before crediting a bit, this measurement requires
   that the text is not derivable from data the CLI sends by name, and that no reported key's
   presence or value predicts the same split. Those guards throw away true facts as well as
   false ones — see the two `0x1` instances under
   [the one bit](#the-one-bit-a-consumer-may-already-be-reading) — and the direction of that
   failure is deliberate.

One more, about the numbers rather than the facts. The funnel from "a bit lines up" to "a bit
is a fact" is steep, and the shape of it is the real result:

| | Count |
|---|---|
| perfect predictors inside a step type | 2615 |
| one claim per (bit, option text, polarity) | 885 |
| — text is not FileMaker's own fixed wording | 464 |
| — already read by the catalog that consumes this | 9 of the 11 instances it ships |
| — redundant with data the CLI sends by name | 360 |
| — same text, narrower scope than another claim | 3 |
| — survive both guards | 49 |
| dropped for injectivity | 23 |
| **facts** | **18** (7 `measured`, 11 `low`) |

## What the 18 facts are worth

Measured against the three groups of steps that a consumer of this cannot currently write
correctly. **Complete** means every option FileMaker prints that would otherwise be missing
is supplied by a fact above, and nothing extra is printed — so the option *set* agrees. It
does not promise the finished line matches, which also needs the option order right; here
the order happens to agree in every case that completes.

| Group | Steps | Gain an option | Become complete | With `measured` facts only |
|---|---|---|---|---|
| The line comes out different | 122 | 2 | **0** | 0 |
| FileMaker shows something the CLI never sends | 26 | 9 | **9** | 3 |
| The CLI cannot read the step at all | 81 | **81** | **8** | 4 |

Read the first row first, because it is the disappointing one: **`flags` settles none of the
122 lines that come out wrong.** The payoff is entirely in the 107 steps (26 + 81) that
cannot be written at all, and it is 17 of them (9 + 8).

The nine that complete in the middle row are `Save Records as JSONL` ×3,
`Set Layout Object Animation` ×2, `Allow Formatting Bar` ×2, `Close File` ×1,
`AVPlayer Play` ×1. The eight in the last row are `Page Setup` ×4, `Print` ×2,
`Import Records` ×1, `Insert File` ×1.

All 81 unreadable steps gain an option and 73 stay unwritable, because what is still
missing on those is a file name, a text encoding or an import action — and no bit holds any
of those.

---

## How to reproduce every figure

Two commands, from the repository root. Neither opens a FileMaker file and neither runs the
`fm` CLI; both halves of every pair are committed under `fm_scripts/`.

```bash
# 1. Pair all 1203 steps with FileMaker's own text, classify each one, and hand over the
#    rows. Write them OUTSIDE the repo: they quote the source scripts verbatim.
FMAI_ROUNDTRIP_ROWS=/tmp/rows.json npm run roundtrip:step-display

# 2. Attribute the flags word per step type and print every figure in this document.
node scripts/measure-step-flags.mjs /tmp/rows.json

# Every redundancy group rather than the top 20:
FMAI_FLAGS_TOP=all node scripts/measure-step-flags.mjs /tmp/rows.json
```

The first command is the existing round-trip. It also rewrites `verified` in
`src/catalogs/fm-step-display.json`, so it can dirty a clean tree the moment a verdict
moves; on the committed data it does not. The second reads those rows and the committed
catalog and writes nothing.

`scripts/measure-step-flags.mjs` deliberately does not re-implement the round-trip's
classification. A second copy of it would make the figures in this document claims about
different steps from the four counts in `docs/fm-step-display-backlog.md`, which is the
document this one was split out of.

## Related

- `docs/fm-step-display-backlog.md` — the open work on writing a step out, including the
  prioritised list this measurement fed into.
- `src/catalogs/fm-step-display.json` — the catalog that describes how each step type
  renders, and the one consumer reading a `flags` bit today (`whenAbsent.flagBit`).
- `src/shared/adt/step-display-types.ts` — that catalog's schema, fully commented,
  including what each evidence field means.
- `CLAUDE.md` — the ADT CLI's contract, including the `disabled` claim this data cannot test.
