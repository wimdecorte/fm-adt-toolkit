# What is still wrong with the way we write out a script step

This is the open work on `src/catalogs/fm-step-display.json` — the file that describes how
FileMaker Pro's Script Workspace writes each script step, so this app can write the same text
from what the Claris ADT `fm` CLI reports.

It exists because everything else about this work lives under `.superpowers/`, which is not
committed and therefore never reaches `main`. This is the part that survives.

**Everything below is measured against 1203 real script steps**, each held twice over in
`fm_scripts/`: the CLI's own JSON for the step, and the text FileMaker's Script Workspace draws
for that same step. Nothing here is a guess about FileMaker, and where the evidence is thin it
says so.

**One standing rule, before anything else.** FileMaker hides a password value in its step text
and the CLI does not. No value of a hidden option is ever printed — not on screen, not in a
report, not in this document.

It got WIDER this round rather than looser. Printing values the catalog cannot place (section 0.1)
means printing keys nobody measured, so a key whose NAME contains a masked one — `edit password`,
`open password`, `smtp password`, nine of them in your two scripts — is now masked as well, wherever
it appears. Word by word and not by substring, so `threshold` and `create folders` are untouched, and
never on a measured option: `Add Account [ … ; Expire password ]` prints FileMaker's own wording for
a switch that carries no value at all.

## How to re-run everything

Two commands, in this order, both of them, every time:

```bash
node scripts/derive-step-display.mjs      # rebuilds src/catalogs/fm-step-display.json
node scripts/roundtrip-step-display.mjs   # measures it, and fills in the per-step verified flag
```

The first cannot know whether a step comes out right, so it writes `verified: false` everywhere;
only the second may set it. Running the first alone therefore leaves the catalog looking changed.
The pair reproduces the committed file byte for byte. The second one also writes an HTML report to
`.superpowers/sdd/2026-09-13-fm-step-display/roundtrip.html`, which quotes your own script text
and is deliberately not committed.

Neither command touches your file. Nothing in this repo runs the `fm` CLI.

## Where the numbers stand

1203 steps, four outcomes, one denominator, never blended into a single accuracy figure:

| Outcome | Steps | Was |
|---|---|---|
| Comes out exactly right | 917 | 947 |
| Different, but you have already ruled the difference does not matter | 84 | 55 |
| Still different | 94 | 93 |
| Cannot be written at all from what the CLI sends | 108 | 108 |
| **Total** | **1203** | **1203** |

**The exact count FELL this round, by 30, and that is the point of the round rather than a
regression.** Section 0 is why. In short: we were printing nothing at all for 105 values the CLI
sends, because the catalog could not say confidently how FileMaker phrases them. 104 now print; the
105th is `cURL options specified`, whose claim gained the evidence it was missing instead — 0.2.
On 30 of those lines FileMaker prints no such option, so those 30 steps move out of "exactly right"
and into your column, on your own ruling — *"any weAddAnOption is not a problem, FM does not always
show all configured options so if we do then that is fine."*

**The two kinds of movement are kept apart, and that is a standing rule of this work rather than a
nicety.**

- **Fixed by rendering: 0.** Nothing came out exactly right this round that did not before. This
  round did not make lines match; it stopped throwing data away.
- **Settled by your rulings: 29.** 30 steps into your column, 1 back out — a step that now differs
  BOTH in spacing (your ruling) and by an option we add (your ruling), and the report has no bucket
  for a row two of your rulings settle at once. It is counted as still different rather than quietly
  folded in.
- 16 step types lost their `verified` flag (136 of 209, was 152). Same trade, seen per step type.

The honest denominator is smaller than 1203. **361 of those steps are ones FileMaker printed with
no options at all** — a comment, a block ender, a step with empty brackets — of which 221 are an
empty comment. Reproducing one of those means reproducing a name. 357 of the 361 come out right.

**So the real work is the other 842 steps, the ones that actually carry options, and 560 of those
come out exactly right** (589 before this round).

**If you read one section, read section 0**, and then section 7 — the order to do the remaining work
in, each item with what it costs and what it buys in steps.

Of the 917: 886 are character-for-character identical with no allowance made at all; 891 after the
two the design spec permits (FileMaker's truncation marker, and the arrow-and-globe marker you
confirmed is meaningless here); 917 after your ruling on the spacing round a colon. That last step
rescues nothing — all 26 steps it decides differ only in spacing, which your whitespace ruling
settles anyway (measured by ablation: with it off, exact 891, your column 110, still different 94).

---

# 0. The one decision waiting on you

**We hold 660 more values that we still print nothing for, and only you can say whether they should
appear.** They are the keys the derivation measured FileMaker never showing — more than one example
each, no example against them. That is real evidence and we have not overridden it.

But it is the one claim in this whole catalog whose scope is *this corpus* rather than its own
count (section 6): *"FileMaker never shows this key"* really means *"never shown in the option
combinations these two scripts happen to contain."*

Measured, so the choice is a number rather than a feeling. If those 660 were printed too:

| | Now | If the 660 print |
|---|---|---|
| Comes out exactly right | 917 | 774 |
| Settled by your rulings | 84 | 227 |
| **Still different** | **94** | **94** |
| Cannot be written at all | 108 | 108 |
| Values on screen | 2813 | 3409 |

**It costs no correctness at all — "still different" does not move by one step.** It costs 143 steps
moving from exact into your column, and it costs legibility. This is what the worst of it looks like
(`Save Records as PDF`, script 55 step 547) — FileMaker's line, then ours:

```
Save Records as PDF [ Save to: File ; Create folders: Off ; With dialog: On ]
Save Records as PDF [ Create folders: Off ; With dialog: On ; Records being browsed ;
                      Calc 4: 1 ; Calc 5: 1 ; Calc 6: 1 ; Numeric 1: 1 ; Numeric 4: 2 ;
                      Numeric 5: 4 ; Numeric 6: 1 ; Numeric 7: 1 ; Numeric 8: 2 ;
                      Numeric 9: 1 ; Numeric 10: 7 ]
```

Those are the PDF security and metadata settings, which the CLI sends as numbers with no names. So
the question for you is narrow: **would you rather see a value the CLI sent under a label we made up,
or not see it at all?** Our recommendation is to leave the 660 hidden and to reduce them instead by
widening the data — the same key seen in another file with another option set is what would turn a
universal negative into a conditional one. Nothing is blocked on the answer.

---

# 0.1 Why we were hiding data at all — the root cause

You said, of one step printing no option because FileMaker's text and the CLI's differ by one
letter's case: *"this feels like a needless complexity, gating that prevents simple things from
happening. So look at the root cause for this."*

**You were right, and it was structural rather than local.** The catalog exists to answer *what does
FileMaker render, and how* — measured, with every doubt recorded beside the fact. That part is
sound and unchanged. The defect was that the renderer used the same answer to decide *what am I
allowed to print*. Those are different questions, and conflating them turned every recorded doubt
into a decision to withhold a value we were holding, in two places at once:

1. **the accounting set.** A key the catalog `ignored` on ONE example, or listed as `unresolved`
   because it could not settle it, counted as "answered" — so the pass that prints an unaccounted
   key skipped it. The `unresolved` list is the clearest case: the derivation wrote down exactly why
   it could not place the value, and the renderer printed nothing.
2. **the segment's own render.** A segment whose measured kind could not produce FileMaker's text —
   a display form these scripts never showed, a value the catalog marks as one it cannot reproduce —
   returned a gap, and the line assembly dropped it. The label was known and the value was in hand;
   only FileMaker's *word* for it was missing, and all three went unprinted.

Neither was a bug in a rule. There was no code path whose job was "print what we have": printing
was a privilege granted only by a corroborated measurement.

**It is now inverted.** A baseline prints every value the CLI sends; the catalog is an enhancement
that supplies FileMaker's label, order and display form where it measured them. A `gap` still gets
reported — the round-trip still asks what FileMaker's phrasing is — but it no longer erases the
value. What is still withheld is only the catalog's *strong* evidence: `ignored` at `measured`
confidence (section 0), a measured `hiddenWhen`, a value measured to print nothing, and a flag
that is off.

**What that was costing, measured over the 1203 examples.** Of 3460 values the CLI sends (excluding
its own bookkeeping keys and the 81 steps it cannot read at all), 2419 were printed and 1041 were
not. **105 of the 1041 were withheld on a recorded doubt rather than on a measurement, and 104 of
those now print** — the 105th being the one whose claim gained evidence instead (0.2). The last two
rows of the table are the populations that stay, and the remaining 266 are values a measured fact
accounts for — a flag that is off, a repetition of 1, an option FileMaker was measured to drop while
another is set:

| Why nothing was printed | Values | Example | Now |
|---|---|---|---|
| `ignored` at `low` confidence, with a printable value | 71 | `Trigger Claris Connect Flow`'s authentication | prints |
| `unresolved` — refuted, withdrawn, or its label owned elsewhere | 16 | `Perform JavaScript in Web Viewer`'s `arg 1`/`arg 2`, whose values FileMaker's own line SHOWS | prints |
| a segment's display form was missing | 16 | `Truncate Table [ With dialog: Off ]`, where the CLI sent a table id | prints the id |
| the catalog marks the text unreproducible | 1 | `Set Error Logging`, your example | prints the calculation |
| `ignored` at `low` confidence, value `false` | 11 | an off switch, which FileMaker does not print either | still nothing, correctly |
| `ignored` at `measured` confidence | 660 | `Save Records as PDF`'s security settings | **your decision — section 0** |

Two things that reading of the numbers gets wrong, and both were in our own first pass:

- **"64 values have no catalog entry at all" was wrong: there are none.** A key the catalog does not
  mention anywhere has been printed by the convention since an earlier round, and on this corpus that
  fires zero times. Nothing was blocked there.
- **Your own example was in none of those buckets.** `Set Error Logging` is the fourth row —
  a segment the catalog holds with the right label, the value in hand and a measured note that
  FileMaker's text cannot be produced from it. Fixing only that step would have left the other 104.

**Three more things the count above does not capture**, found while measuring it:

- **A file list prints its first entry only, on 33 steps.** That is measured for a path (your ruling:
  *"FM does not print the prefix"*), and it is a real omission for `Send Mail`'s two attachments,
  where FileMaker writes `2 Attachments`. Not fixed; it needs your word on the rule.
- **15 steps print an empty bracket while the CLI sends keys.** 13 are right — FileMaker prints `[]`
  there too, because every key it sent is an off switch. Two are not (`Perform AppleScript`,
  `Send DDE Execute`); both are in the difference list below.
- **A wrong label is worse than an inferred one.** The baseline first printed
  `Configure AI Account [ … ; Spelling Language: 0 ]`, because one step type labels the CLI's generic
  `stepValue` that way and no other labels it at all. A global label now needs no step type
  rendering the key with NO label — eight render `stepValue` bare, which is disagreement, not
  agreement. 12 keys withdraw and no measured line moves.

**Exactly four allowances are made anywhere in the comparison** — the design spec's two (the
truncation marker and the arrow-and-globe marker), your colon ruling and your whitespace ruling. A
fifth would be a defect, and the one that would have bought the `Set Error Logging` row is the one
you declined: see 2.1. Still four after this round, and the way that row keeps its place without a
fifth is described there.

---

# 0.2 The one thing the baseline printed that it should not have — closed

The baseline briefly printed `Insert from URL`'s `cURL options specified` on the one step where it is
true. **That is the key that has already caused a real defect in this project**, on the one step type
the app itself generates: reading it as the *Specify cURL options* checkbox silently dropped the
method and headers from working scripts, because a FileMaker-authored step reads it back `false`
while its options render. `CLAUDE.md` records that at length. An option reading `cURL options
specified` on a rendered line invites exactly that conclusion again, so this one was worth the
trouble when the other 94 differences are not.

**Closed in the derivation, not in the renderer.** A carve-out in the renderer would put back the
coupling section 0.1 removed — the renderer deciding what may print. Instead the claim gained the
evidence it was missing. It read `low` for one reason: 7 of its 8 examples report the key and show
nothing for it, and the 8th was set aside by hand, which made the claim depend on a judgment. A
withdrawal may now name an EXTERNAL SOURCE, and one that does answers that dependence rather than
carrying it: the claim reads `measured` on its 7 observations plus the named source, which travels
into the catalog beside it so nothing reads as corpus-measured that is not.

**The mechanism is general and the effect is one entry, and that is the honest split rather than a
compromise.** Two other claims are withdrawal-dependent and both keep their doubt, because their
withdrawals argue from this corpus rather than from outside it:

- `Perform Semantic Find`'s `return count` predicts the option perfectly in all 10 examples — 5 true
  and shown, 5 false and not — and its withdrawal moves only the option's TEXT to the key that
  supplies it. The switch really does decide whether FileMaker shows the option, so *never shown* is
  a claim the data argues against.
- `Go to List of Records`'s unnamed member key is set aside by a derived rule with no source at all.

And the same test refuses to rescue the one that qualifies on corpus evidence alone: its value is
`true` in exactly the one example that shows the phrase, so the correlation inside this data is
perfect and no measurement here can break it. That is precisely why an external source is the honest
instrument, and why no derived rule was invented to reach the answer.

**No count moves: 917 / 84 / 94 / 108, before and after.** The row is a difference either way —
FileMaker prints `Do not automatically encode URL` and the CLI sends no key for it, a confirmed gap
(section 5) — so it simply reads as the missing option it is instead of as a text disagreement. One
value stops printing and nothing else does: 104 by the baseline, from 105.

---

# 1. The bitmask flags word — your hypothesis, measured

You wrote: *I think some of the missing options that we don't display are hidden in the bitmask
flags section.*

**You are right, and it is now measured rather than suspected.** This section says how much it is
worth, which bits can be trusted, and — just as important — what it cannot do.

## 1.1 The decisive test

Group the 1203 steps so that each group holds steps whose CLI JSON is **identical except for the
step's own unique id and its `flags` number**, then look at whether FileMaker drew them
differently. If it did, `flags` is the only thing left that could have caused it.

**15 such groups exist. In 14 of them the `flags` numbers differ.** The cleanest is `Page Setup`,
which FileMaker displays as `Print Setup`. Four steps, identical JSON apart from the id and the
number, three different texts:

| flags | What FileMaker shows |
|---|---|
| `0x8000` | `Print Setup [ With dialog: On ]` |
| `0x2008000` | `Print Setup [ Restore ; With dialog: On ]` |
| `0x2008080` | `Print Setup [ Restore ; With dialog: Off ]` |

Two bits, two options, no other input. That is the whole hypothesis in one step type.

## 1.2 What it is worth — the number that decides whether to build it

Measured strictly: a bit counts only where it supplies an option FileMaker prints, whose text is
FileMaker's own fixed wording (a number cannot hold a file name or a calculation), and where **no
key the CLI already sends carries the same information**.

| | Steps | Of which `flags` supplies every option we are missing |
|---|---|---|
| Still different (93) | 2 touched | **0** |
| FileMaker shows something the CLI never sends (26) | 9 touched | **9** |
| CLI cannot read the step at all (81) | 81 touched | **8** |

**Read the first row carefully, because it is the disappointing one: `flags` settles none of the
remaining differences.** Two of them contain an option a bit predicts, and in one of those
the CLI already sends the value under a key of its own — so at most one step, resting
on a single example, and even that one would still be wrong for a different reason. Re-measured
against the smaller 93 rather than carried over from the 122: the figure is unchanged.

**That row's denominator is the 93 of the previous round, not the current 94, and it is deliberately
not re-run here.** The two rows that matter — 9 of the 26 and 8 of the 81 — are about steps `flags`
would make writable, and neither the baseline in section 0.1 nor anything else this round touched
those populations. The first row's answer is zero, and a zero measured against 93 steps that overlap
the current 94 in 93 of them cannot become non-zero.

**The payoff is entirely in the 108 we currently cannot write at all: 17 of them (9 + 8) would go
from unwritable to complete.** That is where the work is worth doing.

Three cautions on that 17.

- **Only 10 of the 17 rest on bits the evidence actually supports.** 6 more need one of the thin
  readings in 1.3 (3 steps on `Save Records as JSONL`, 3 on `Page Setup`) and 1 is better fixed as an
  absent-key default than as a bit at all (2.4). So the number to plan against is **10**, with 7 more
  available if the thin readings are later corroborated. **The per-step-type redo in 1.8 re-counts this
  as 7, on a stricter rule** — it demands recurrence inside the step type rather than consistency
  across step types — and moves the `Save Records as JSONL` three from thin to measured. The 17 total
  is unchanged.
- The measurement asks whether `flags` supplies every option FileMaker prints that we print nothing
  for. Whether the finished text then matches also depends on getting the option order right. **1.8
  measures that: the order already agrees in all 17.**
- A bit helps with all 81 unreadable steps but only 8 become complete — the other 73 gain an option
  and stay unwritable, because what is still missing is a file name, a text encoding or an import
  action, and no bit holds any of those.

## 1.3 The bits, and how far each can be trusted

Same standard as the rest of the catalog: more than one example, no counterexample, and no two
meanings for one bit inside a step type.

**This table is the record of the pass that looked for global rules, kept because it is what the
numbers in 1.2 were computed from. 1.8 supersedes its rows for `0x8000`, `0x2000000`,
`0x20000000`/`0x40000000` and `0x4000`**, and `docs/fm-step-flags-reference.md` is the attribution to
build from.

| Bit | What it says | Where | Evidence | Trust |
|---|---|---|---|---|
| `0x1` | the field or table this step points at is gone, so FileMaker prints its missing-reference placeholder | 11 step types | **already shipped** — the only bit the catalog reads today | measured |
| `0x80` | the dialog option is off | 28 step types | 125 steps report a dialog key of their own, and the bit is set in exactly the 125 where it is off — no exception. 27 further steps have the bit and no key at all | **measured** |
| `0x10000` and `0x20000` | `0x10000`: this step's on/off state is carried in the number rather than in a key. `0x20000`: that state — set is On, clear is Off | 7 step types | 16 steps. On the 4 step types that also report a state key, bit and key agree in 11 of 11. On the 3 step types where `0x10000` is clear the state IS in a key and `0x20000` is clear whatever the state — which is why the first bit is part of the fact and not decoration | **measured** |
| `0x8000` | the step carries a find, sort or filter sub-object | 7 step types | set in exactly the 15 steps that report the CLI's `spec` key, and in the 14 unreadable `Insert File` steps where FileMaker prints `Filters` | measured for the bit. **The word `Filters` is `Insert File` only** — none of the other 15 prints it |
| `0x10000000` | certificates are verified | 4 step types | 23 of 23 steps that report the key agree, no exception; one further unreadable step has the bit and no key | **measured** |
| `0x800` | the object is stored as a reference | the 4 Insert-an-object steps | 23 of 23 steps that report the key agree | measured here. The same bit carries an unrelated meaning on other step types — see 1.5 |
| `0x1000` | select the whole contents first | 12 step types | 41 steps print it with the bit set, 29 do not with it clear | measured. Also carries other meanings elsewhere |
| `0x20000000` / `0x40000000` | open the file afterwards / attach it to a mail | `Save Records as JSONL` | 3 and 2 steps | **thin, and contradicted**: two `Export Field Contents` steps have both bits set and print neither option |
| `0x2000000` | `Restore` on `Page Setup` | `Page Setup` | 3 for, 1 against | **thin**: the same bit is set on more than 40 steps that print no `Restore`, and `Adjust Window` prints `Restore` with it clear |
| `0x100` | `External` on `Go to Related Record` | 1 step type | 1 step | **thin**: one example, and this bit is the sole predictor of eight unrelated options on unrelated step types |
| `0x4000` clear | the active object, on `AVPlayer Play` | 1 step type | 1 step | **thin, and better read another way** — see 2.4 |

The four rows marked thin are recorded so nobody has to rediscover them; none of them should be
implemented on this evidence alone.

Of the rest, **five hold their meaning across the whole corpus** — `0x1`, `0x80`, `0x8000`,
`0x10000000`, and the `0x10000`/`0x20000` pair — and those are the ones worth building. `0x800` and
`0x1000` are measured too, but only inside their own step types, and both duplicate a key we already
read, so neither adds a step we cannot already write.

## 1.4 Most of the number is a copy of things the CLI already tells us

This is the finding that caps the payoff. **54 separate facts about a key the CLI reports are
predicted exactly by a bit** — 52 of them by whether the key is sent at all, 2 by its value. Most of
`flags` is therefore a duplicate of data we already have under a name, and a bit that duplicates a
key is not a new source of anything.

That is also what makes the five measured bits above trustworthy: each was checked against the key
that duplicates it, with zero disagreements — `0x80` over 125 steps, `0x10000000` and `0x800` over
23 each, `0x8000` over 15, the on/off pair over 11. The bit and the key say the same thing wherever
both are present, which is why the bit can be believed on the steps where the key is absent.

And that is exactly where the value is. The five step types the CLI cannot read at all
(`Import Records`, `Export Records`, `Insert File`, `Print`, `Page Setup`) send no keys, so the
number is the only thing we have; and three more step types (`Set Layout Object Animation`,
`Allow Formatting Bar`, `Set Revert Transaction on Error`) send no state key even when readable.

## 1.5 A bit is a position in the step's own word, not a global flag

Do not read a bit as having one meaning across FileMaker. Measured: bit `0x100` is the sole
predictor of eight unrelated options on unrelated step types; `0x200` of eight; `0x1000` of six.
The same position means something different depending on the step.

Only five positions hold one meaning across the whole corpus — `0x1`, `0x80`, `0x8000`,
`0x10000000`, and the `0x10000`/`0x20000` pair. Everything else must be recorded per step type.

Inside a single step type the rule does hold: of 55 candidate facts, 51 are unambiguous and 4 are
not, and those 4 are options that always appear together in these two scripts, so nothing separates
them. `Automatically open` and `Create email` are the clean illustration — inseparable on
`Export Records`, separable on `Save Records as JSONL`, which is how they got their own bits at all.

## 1.6 What the number cannot explain

`flags` is not a complete answer, and the same test that proved it carries information proves the
limit. **In 8 groups of steps, two steps share an identical `flags` value and FileMaker still draws
them differently.** No reading of the number can tell those apart. (At whole-group level only one of
the 15 groups in 1.1 carries a single `flags` value throughout — `Add Account` — but that
understates it: the sharper test is per value inside a group, and it fires eight times.)

| Step type | Steps sharing one flags value | Different texts | What actually differs |
|---|---|---|---|
| `Import Records` | 16 | 11 | the source file name and type |
| `Import Records` | 13 | 12 | the import action and the text encoding |
| `Export Records` | 11 | 9 | the text encoding |
| `Insert File` | 9 | 9 | whether the file is inserted or referenced, and how it is displayed |
| `Import Records` | 3 | 3 | the source file name |
| `Import Records` | 3 | 3 | the source file name |
| `Insert File` | 2 | 2 | how the file is displayed |
| `Add Account` | 2 | 2 | the privilege set name |

The pattern is plain: **`flags` carries FileMaker's checkboxes and two-state options. It does not
carry names, file paths, calculations, or a choice from a long list.** The nine text encodings on
`Export Records` are all one `flags` value; the privilege set on `Add Account` is a name and could
never be in a number.

## 1.7 The one thing the number is known not to carry

`CLAUDE.md` records that a step's **disabled** state is a top-level key of its own and is *not* in
`flags` — the number is byte-identical between a disabled and an enabled step. That still stands,
and this corpus cannot confirm or contradict it: **none of the 1203 steps is disabled**, so there is
nothing here to test it against. The claim rests on the earlier measurement, not on this data.

## 1.8 Redone per step type, on your instruction — and what it changed

You read 1.5 and said: *"Surely the approach is to just figure out the bitmasks for each script step
instead of trying to find global rules."* **You were right about the method, and everything in 1.3
above was measured the wrong way round.** It has been redone with `(step type, bit)` as the unit of a
fact, and a `(step type, bit)` attribution is now never rejected because the same bit means something
else on another step type.

**The whole attribution now lives in its own document, `docs/fm-step-flags-reference.md`**, written to
be usable outside this repo — keyed by step type, with each bit's evidence count and confidence, its
own limits, and the commands that reproduce every figure. The rest of this section is only what the
redo changes about the numbers here.

**18 `(step type, bit)` facts, on 15 step types: 7 measured, 11 low.** Against the global pass's 5
corpus-wide bits plus 2 step-type-local ones. So the redo finds substantially more *facts*.

**It finds no more steps.** The payoff is identical, to the step:

| | Global pass | Per step type |
|---|---|---|
| Of those still different | 0 | **0** |
| Of the 26 FileMaker shows and the CLI never sends | 9 | **9** |
| Of the 81 the CLI cannot read | 8 | **8** |

That is not a coincidence and it is the useful finding: the ceiling is set by what a number can hold,
not by how the number is attributed. Three specific things the redo settles, all of which correct 1.3:

- **`0x2000000` is a per-step-type predictor of `Restore` on nine step types, and a NEW source on
  one.** On seven of the nine the CLI sends a `restore` key of its own and the catalog already writes
  the option from it; on `Print` the bit says the option is there while FileMaker prints a printer's
  name after the label, which no number holds. Only `Page Setup` gains anything. 1.3's two objections
  were both cross-step-type and are withdrawn — and `Adjust Window [ Restore ]` was never a
  counter-example at all: that is a window state, from the `state` key, a different option that
  happens to share a word.
- **`0x20000000` / `0x40000000` on `Save Records as JSONL` are measured, not thin.** The
  `Export Field Contents` objection in 1.3 was cross-step-type. What is true is narrower and stays
  recorded: on `Export Records` the two options always appear together, so both bits predict both
  options and injectivity refuses all four combinations there.
- **`0x8000` earns `Filters` on `Insert File` outright** — 14 of the 14 unreadable steps have the bit
  and print the word, the 17 readable ones have it clear and none does.

And two costs of the stricter method, which are worth knowing before anyone assumes per-step-type is
simply better:

- **A step type with one example is unreachable.** `Set Revert Transaction on Error` has exactly one
  step here, so no bit can be split against anything, and the corpus-wide `0x10000`/`0x20000` pair
  remains its only route. It is why the two payoff columns above have the same total from different
  steps.
- **Less data per test means more coincidences.** The broken-reference bit `0x1` is recovered on nine
  of the eleven step types that ship it, and refused on `Insert Calculated Result` and `Insert Text`
  because inside each of those another key's *value* happens to split the same examples. Only looking
  across step types separates them.

## 1.9 Recommendation

**Unchanged by the redo, and re-derived from its numbers rather than carried over.** The eight items
marked **ours** in section 3 came first, and most of them are now done — see section 3 for what
closed and what did not. Then `flags`.

The `flags` work is worth **17 steps moving from unwritable to complete** (9 + 8), of which **7 rest
on the `measured` facts alone**; 73 more unreadable steps gain an option and stay unwritable; and
**none of the remaining differences is settled**. Re-measured after this round's work, not carried
over: the three figures are identical. Three of the 18 facts describe an option the
catalog already writes correctly by another rule — `Exit Script`, `Save a Copy as Add-on Package` and
`Perform JavaScript in Web Viewer`, all empty slots or absent-key defaults — so they are not
opportunities at all.

A named key beats a bit even where both work, because the bit is step-local and the key is not. That
is now measured rather than asserted: **177 distinct `(step type, bit)` pairs duplicate a key the CLI
already sends by name.**

Where it would go: the catalog already has a place for this. `whenAbsent.flagBit` in
`src/shared/adt/step-display-types.ts` is the field that reads one bit, and it is what makes the
missing-reference placeholder work today. An option that exists only in `flags` needs a slightly
wider version of the same idea, plus a two-state form for the bits that carry `On`/`Off`.

**The full order of work is section 7.**

---

# 2. Already settled — please do not re-open these

Recorded so nobody re-asks you.

## 2.1 Your rulings, all implemented

- **We may print an option FileMaker does not.** Your words: *FM does not always show all
  configured options so if we do then that is fine.* 75 steps sit in the settled column on this, up
  from 42: this is the ruling the baseline in section 0.1 rests on, and 30 of the 33 rise are steps
  that used to come out exactly right and now carry a value we were dropping.
- **We do not care about spacing differences**, including the spacing round a colon. 7 steps settled
  on the general form, 26 more on the colon. Read narrowly: a space inside a quoted value is content,
  not spacing, so a difference there is still ours. One step lost this settlement because it now also
  carries an option we add: both differences are yours, and nothing here folds two of your rulings
  into one bucket.
- **The CLI's placeholder for a plugin function it cannot resolve is printed as we see it**, because
  the CLI cannot use FileMaker plugins. 1 step.
- **A repetition of 1 is not printed.** Your words: *FM does not print the rep number if it is 1.*
- **A file option prints the file name only**, not the path or scheme. Your words: *FM does not print
  the prefix.* This closed 15 differences to zero.
- **The empty brackets are your indifference, honoured**: *FM is very inconsistent with this so I'm
  ok with whatever we do here.*
- **An option with no value set is printed anyway.** Your words: *FM is inconsistent here but often
  does print an option with no value set. So we should.* Ten steps came out right on it, including
  five the previous pass had declined rather than invent a default for. It costs two steps where
  FileMaker prints no such slot and we now print one — they move to this column, on your general
  ruling about an option we print and FileMaker does not. Deliberately NOT extended to FileMaker's
  broken-reference placeholder: printing `<Table Missing>` on a step that merely has no field would
  be inventing a broken reference, so that one still needs unanimous evidence.
- **The case format of a value is not worth normalising.** Your words: *I don't understand why this
  is an issue; we're just reading so who cares what the case format is. There's no reason to
  normalize and make things more complex.* So no fifth allowance was added to the comparison, and
  the one step sits in this column instead of the difference list. **The part of this your ruling did
  not settle is now fixed**: the effect used to be that we printed nothing at all for that option,
  because the case difference is why the derivation refused to attribute it. It prints the whole
  calculation now, with the CLI's own spelling, and the step stays in this column — see section 0.1.
  That was your `Set Error Logging` question, and it turned out to be one instance of 105. **No fifth
  allowance was added to get there**: the bucket that records this ruling used to be keyed on the
  shape of the difference, and it is now keyed on the catalog's own note that FileMaker's text here
  cannot be produced from the CLI's value. Nothing is case-folded and no match is claimed — without
  that re-anchoring the step would have moved INTO the difference list for showing you more.
- **The broken-reference placeholder is now printed**, on 11 keys across 11 step types. This was the
  first use of a `flags` bit and it is the precedent section 1 builds on.
- **The CLI's unnamed values are now reachable.** 146 steps carry a bag of values the CLI does not
  name, holding 319 of them; 61 are placed by a measured fact, 256 are recorded as never shown, 2 are
  unsettled. 73 steps now write at least one of them out, up from 43: the baseline prints an unnamed
  value the catalog could not place under the CLI's own word for its KIND (`Calc 5:`, `Text:`), with
  the slot number added only when a step holds more than one of that kind. That label is ours and
  visibly so — the CLI did not name the value, so no label for it can be FileMaker's.

## 2.2 Two things we deliberately do not reproduce

FileMaker cuts a long calculation off with an ellipsis because its rows are one line high. Ours wrap,
and hiding data is worse, so we print the whole thing and compare on the prefix. And the
arrow-and-globe marker on the seven steps that schedule a script for later is stripped, on your
confirmation that it means nothing for our purposes.

## 2.3 Closed and not coming back

- The repetition FileMaker appends to an option is **not in the CLI's output in any form** — see section 5.
- The privilege set name is **not in the CLI's output in any form** — see section 5.
- `cURL options specified` is not a gate on `cURL options`; see `CLAUDE.md`. **And it is not an
  option either**, on the same source: the catalog's never-shown claim for it now carries that
  attestation and reads `measured`, so nothing prints it whichever way it reads. Closed in 0.2.

## 2.4 Two items that look like `flags` and are not

Both were turned up by the `flags` investigation and are cheaper to fix without it. Both are about
what FileMaker prints when the CLI sends **no** key:

- `Close File` with no file key prints `Close File [ Current File ]`; we print the name alone.
- `AVPlayer Play` with no object-name key prints the active-object placeholder; we print nothing.

Each has exactly one example here, so each is thin, and each is an absent-key default rather than a
bit. **Ours to settle, not yours.**

---

# 3. The 94 remaining differences, grouped by shape

94 steps, **12 shapes**, worst first. Grouped by shape rather than one row per step, because a
shape is one decision. The numbering is not stable between runs of the measuring script — treat it
as an index into this document only.

**Read the movement in this section as re-shaping rather than as progress or regression.** 16 of
these steps changed shape this round without changing column, because a value we used to print
nothing for now appears on the line: `Truncate Table` moved from "we print nothing for this option"
to "we both print it and the text differs", which is the same step with more of the CLI's data on
screen. Two shapes read HARSHER for the same reason — a row that only omitted an option now also adds
one — and that is the honest reading rather than a spun one.

Each shape says whose call it is. **Ours** means the answer is in the CLI's JSON and we simply have
not read it properly; you should not have to look at those. **Yours** means only you know what
FileMaker does. You wrote: *that's an impossible question for me, I don't know the cli output by
heart. Either that option is there and you're looking for it by the wrong name, or the option is not
there and it is a CLI defect.* Every shape below has been put through exactly that fork.

| # | Steps | The difference | Step types | What would settle it | Whose |
|---|---|---|---|---|---|
| 1 | 15 | both print the option, and FileMaker adds a bracket we do not | Generate Response from Model, Insert Image Captions in Found Set, Perform Semantic Find | The bracket holds a repetition number that is **in no key and in no unnamed value**. Confirmed CLI gap — see section 5 | **closed** |
| 2 | 14 | FileMaker prints an option with no label and we print nothing for it | Convert File, Go to Layout, Insert from URL, Move/Resize Window, Perform SQL Query by Natural Language, Save Records as Excel, Send Event, Send Mail | Seven unrelated causes sharing one shape. Each needs the same fork applied one step type at a time: is the value in the JSON under a name we did not recognise, or absent? Two fewer than last round, and `Insert from URL` stays: what FileMaker adds there is `Do not automatically encode URL`, which the CLI sends under no name at all (0.2) | mixed, mostly **ours** |
| 3 | 10 | a different set of options altogether | Convert File, Go to Related Record, Install Menu Set, Perform SQL Query by Natural Language, Perform Script on Server with Callback, Save Records as Excel, Save Records as PDF, Send Mail | Nine shapes each under three steps. `Save Records as PDF` is the pattern: FileMaker prints `Save to: File` and we print the record-set option instead, so FileMaker is choosing a different set of options depending on one of them | mixed |
| 4 | 8 | a different set of options altogether | Add Account | FileMaker prints a privilege set name; the CLI sends it nowhere. Confirmed CLI gap — see section 5. The rest of this step type is now right | **closed** |
| 5 | 8 | both print the option, with different text in it | Install Menu Set, Perform AppleScript, Perform Script on Server, Set Zoom Level, Show Custom Dialog, Truncate Table | Five shapes each under three steps. **`Truncate Table` and `Install Menu Set` are a lookup we cannot do**: both report a numeric internal id where FileMaker prints a name, so the name comes from the file's schema and not from the step. We now print the id, which is why they read as a text difference rather than a missing option. See section 5 | mixed, and mostly closed |
| 6 | 8 | FileMaker adds a bracket we do not, plus options only one side prints | Configure Regression Model, Generate Response from Model, Perform Semantic Find | Same bracket as shape 1, on step types that also disagree about something else. The bracket half is closed | mixed |
| 7 | 7 | both print the option, with different text under the same label | Go to List of Records, Go to Related Record, New Window, Replace Field Contents, Set Window Title | **Four of the eight are one CLI gap**: when FileMaker names a layout it writes the layout's base table after it in brackets, and that table is nowhere in the step. See section 5. The other four need the fork | mixed, and now mostly **closed** |
| 8 | 7 | FileMaker prints an option and we print nothing for it | Add Account, Configure Regression Model, Execute SQL, Go to Related Record, Insert from Device | Five shapes each under three steps. `Insert from Device` prints `Flash: Auto` and the CLI sends no flash key on any of the eight steps that show it — a CLI gap. The others need the fork | mixed |
| 9 | 5 | FileMaker prints three options and we print nothing for them | Perform Script on Server with Callback | FileMaker prints how each of two scripts was chosen, plus an empty parameter slot each. **The pieces are all in the JSON and the corpus still cannot say which key is which**: four keys split these six examples identically, so nothing distinguishes the script's `Specified:` from the callback's. Left open rather than guessed — see below | **ours, and stuck** |
| 10 | 4 | both print the option, with different text in it, plus options only one side prints | Export Field Contents, Perform JavaScript in Web Viewer, Send Event, Show Custom Dialog | Three shapes each under three steps. Needs the fork per step type | mixed |
| 11 | 4 | different text under the same label, plus options only one side prints | Go to List of Records | The layout's base table again (shape 7), on the four steps that ALSO configure a new window. `New window` itself is now printed on `Go to Related Record`; on this step type the deciding key cannot be identified — see below | mixed, and blocked |
| 12 | 4 | different text under the same label, plus options only one side prints | Send Mail | FileMaker names the transport (`Send via SMTP Server`) where we print the server value the CLI sends. The transport is a fixed phrase and the value is not, so this needs the fork: which key does FileMaker read to choose that phrase? | **ours** |

**Two of the 12 are closed outright, and three more are closed in part** by a gap in the CLI that
was proved rather than assumed. Counted by steps: **28 of the 94 cannot be fixed from our
side at all**, 5 are ours and stuck on a tie the corpus cannot break, and the rest need the fork
applied per step type.

## What closed this round, and what did not

Eight shapes were marked **ours** in the previous count, covering 42 steps. Five of them are done:

| Was | Steps | Outcome |
|---|---|---|
| `Insert File`'s third storage setting | 6 | **done.** FileMaker writes `Insert` for a value sharing no word with it, so nothing in one line connected them; it is derived across examples now |
| `Perform Semantic Find`'s return count | 3 | **done.** The label spells a boolean switch and the text is a second key's value. The switch could not produce a calculation, so the option was rendered not at all |
| `New window` on `Go to Related Record` | 5 | **done**, and it needed a false fact withdrawn first: in five examples you named the window `"new window"`, so the value looked like FileMaker's own word for it |
| The CLI's word against FileMaker's | 3 | **done** on `Set Zoom Level` (`zoomIn` -> `Zoom In`) and `Configure Region Monitor Script` (`geoLocation` -> `Geofence`) |
| The empty option slot | 10 | **done on your ruling** — section 2.1 |

And three did not, each for a reason worth having in writing rather than rediscovering:

- **`New window` on `Go to List of Records` (4 steps, shape 11).** Blocked twice over. The four rows
  also carry the layout's base table, which is a CLI gap (section 5); and where `Go to Related
  Record` offers five keys that are all reported together — one window configuration under five
  names, so any of them describes it — this step type offers **seven that are not**, including the
  layout and the window style, which are there for other reasons. That is a real disagreement about
  the rule, not a choice of name, so it declines.
- **`Perform Script on Server with Callback` (6 steps, shape 9).** FileMaker prints `Specified: From
  list` for the script and `Callback script specified: From list` for the callback. Four keys —
  the script name, the callback, the callback-by-name and the parameter — are present in exactly the
  same one of the six examples, so nothing in this step type says which decides which. The script
  half is settled on two OTHER step types where the same key does the same thing, but the callback
  half has no precedent anywhere in the corpus.
- **The remaining value lookups (2 + 1 steps, shape 8).** `Truncate Table` reports
  `table selection: 1` and an internal id; FileMaker prints a table NAME. `Install Menu Set` reports
  an internal id; FileMaker prints a menu set name. The previous note in this document said the name
  "sits in the bag of unnamed values" — **that was wrong, and it is corrected here**: the bag holds
  the id, not the name. Two of the three names FileMaker prints are its own built-in ones and could
  be mapped; the third is yours, and no id-to-name table exists in the step.

---

# 4. The 108 we cannot write at all

Three different reasons, kept apart because averaging them into one accuracy number would hide what
each actually is.

## 4.1 81 steps the CLI cannot read — and what that means

The CLI reads the step, finds a **structured sub-object it does not understand**, and instead of
guessing it returns the step with no options at all and says so in its own words. Here is one,
verbatim, as one element of the `body` array a `read:script` returns:

```json
{
  "stepID": 42,
  "step": "Page Setup",
  "uuid": "75AEB62C-FC54-4546-BB7C-F49108FD9D9D",
  "opaque": true,
  "editable": false,
  "reason": "the page setup is a structured sub-object this CLI cannot read; a write carries it across unchanged",
  "flags": 32768
}
```

FileMaker draws that step as `Print Setup [ With dialog: On ]`. Everything we would need to write
that is in the number at the end, and nowhere else. All 81 report `editable: false`, and each of the
five step types has its own wording:

| Step type | Steps | The CLI's own reason |
|---|---|---|
| `Import Records` | 38 | the field mapping and data-source options are a structured sub-object this CLI cannot read; a write carries them across unchanged |
| `Export Records` | 15 | the field mapping and output options are a structured sub-object this CLI cannot read; a write carries them across unchanged |
| `Insert File` | 14 | the step carries a structured sub-object this CLI cannot read |
| `Print` | 10 | the print settings are a structured sub-object this CLI cannot read; a write carries them across unchanged |
| `Page Setup` | 4 | the page setup is a structured sub-object this CLI cannot read; a write carries it across unchanged |

Two things follow. **This is a CLI limitation, not ours** — the sub-object is carried across
unchanged on a write, so nothing is lost when we push a script; it is only invisible when we read
one. And **`flags` is the only material we have for these 81**: it would complete 8 of them and add
an option to the other 73 without completing them (section 1.2).

## 4.2 26 steps where FileMaker shows something the CLI never sends

The step reads fine, and FileMaker still prints an option the CLI reports in no key and in no
unnamed value.

| Step type | Steps | What FileMaker shows | Status |
|---|---|---|---|
| `Insert from Device` | 6 | a flash or flashlight setting | CLI gap: no flash key on any step that shows it |
| `Perform SQL Query by Natural Language` | 5 | a fixed table-list wording | **ours, and now measured**: the key's presence predicts it in 7 of 8 examples and its absence in the eighth. The derived rule for exactly this shape (item 1 in section 7) demands three examples of each state and declines on one, so this needs either that threshold argued down with evidence or one sentence from you |
| `Save Records as JSONL` | 3 | open the file afterwards, attach it to a mail | **`flags`, measured per step type** (1.8) |
| `Set Layout Object Animation` | 2 | On or Off | **`flags`, measured** (1.3) |
| `Allow Formatting Bar` | 2 | On or Off | **`flags`, measured** (1.3) |
| `Add Account` | 2 | a privilege set name | CLI gap, closed (section 5) |
| `Save Records as Snapshot Link` | 2 | attach it to a mail | no bit survives the test |
| `Set Revert Transaction on Error` | 1 | Off | `flags`, but **corpus-wide only** — one example, so no per-step-type test (1.8) |
| `Close File` | 1 | the current file | **ours** — an absent-key default (2.4) |
| `Re-Login` | 1 | the current file | unresolved |
| `AVPlayer Play` | 1 | the active object | **ours** — an absent-key default (2.4) |

So of the 26: **8 are answerable from `flags`, 7 from data the CLI already sends, 8 are genuine CLI
gaps, and 3 are unresolved** (the two `Save Records as Snapshot Link` steps and the `Re-Login` one).
Section 1.2 counts 9 on the `flags` side rather than 8, because a bit also predicts the
`AVPlayer Play` one; it is listed here under the reading that is cheaper and safer to build.

## 4.3 One step named by an installed plugin

FileMaker draws the plugin's registered name; the CLI reports the generic external-step name and the
plugin's four-byte code. The displayed name is a lookup against what is installed on the machine, so
it cannot be derived from the script at all. Recorded, not fixable.

---

# 5. Confirmed gaps in the CLI

Each of these has been checked against the CLI's own output for the step, in every form — a key of
its own, a nested value, the bag of unnamed values. Not there.

1. **A repetition FileMaker appends to an option.** FileMaker writes an option and then a repetition
   number in brackets after it. The step reports one repetition, its value is 0, and 0 means *not
   specified*, which FileMaker draws as empty brackets — that part now comes out right. The number
   appended to the *other* option is in no key and in no unnamed value. 14 steps, plus 7 more that
   also disagree about something else. Your ruling that skipping it is not acceptable stands; there
   is nothing to stop skipping with.
2. **A privilege set name on `Add Account`.** Everything else about that step type is now worked out
   from the values the CLI sends — the authentication method, the switch between the two names for
   the account option, the password option disappearing for an external account. The privilege set is
   in no key and in no unnamed value. 10 steps.
3. **A flash or flashlight setting on `Insert from Device`.** FileMaker prints it on eight steps and
   the CLI sends no key for it on any of them. Two step configurations that *do* report a light key
   are ones where FileMaker prints nothing, so it is not a matter of the wrong name.
4. **The base table of a layout FileMaker names.** Wherever FileMaker prints a layout by name it
   writes that layout's base table after it in brackets — `Using layout: "<layout>" (<table>)`. The
   step reports the layout name and nothing else, so the table is a lookup against the file's own
   schema. Confirmed on the two step types where nothing else differs: `Go to List of Records` reports
   `{layout, name, width, height, left, top, animation, row list, style}` and no table anywhere, and
   `New Window` the same. 9 steps. **`Go to Related Record` is the exception that proves it is a
   lookup**: that step type reports the table under its own name (`from`), because the step needs it
   for a different reason, and there the option comes out right.
5. **A menu set's or a table's name behind an internal id.** `Install Menu Set` reports a number and
   FileMaker prints a menu set name; `Truncate Table` reports a number and FileMaker prints a table
   name. Two of the three menu set names in these scripts are FileMaker's own built-ins and could be
   mapped from the id; every other name is a lookup against your file. 4 steps. An earlier version of
   this document said the name was in the bag of unnamed values — it is not, and that is corrected.

---

# 6. What this data cannot tell us, at any sample size

One limit is invisible from inside the corpus and no count makes it visible.

**The catalog contains claims of the form *FileMaker never shows this key*.** They are the boldest
thing in it, because a consumer acts on one by printing nothing. Every one is drawn from these 1203
steps, from one file, so what it really says is: *never shown in the option combinations these two
scripts happen to contain.* A key FileMaker reveals only when some other option is set will read as
never shown however many examples sit behind it.

Nothing detects that from inside. Only wider data, or a check against FileMaker itself, narrows it.
The limit applies to those never-shown claims specifically; every other fact in the catalog is scoped
by its own evidence and carries its own count.

The same scoping applies to the `flags` findings in section 1. *No bit predicts this* means *no bit
predicts it across these two scripts* — which is why 1.6 names the eight groups where the number
provably cannot help, rather than resting on an absence.

---

# 7. The order to do the rest in

You asked: *"You say 'don't spend the flags work first.', but what is the todo list then in what
priority order?"* This is it. Ordered by measured payoff per unit of work, not by preference, and every
count in it comes from somewhere earlier in this document.

**Items 1 and 2 are done**, so this is the order for what is left, re-derived from the new numbers
rather than carried over. **How the 94 divide, so the items below can be checked against a total:**
28 cannot be fixed from our side at all, 5 are ours and stuck on a tie the corpus cannot break, and
61 are mixed and need the fork applied per step type. 28 + 5 + 61 = 94.

## The order

| # | What | Costs | Buys | Waits on |
|---|---|---|---|---|
| 1 | Option *presence* from key presence on the AI steps | one derivation rule; the machinery it needs now exists and has been used twice | reduces **27 of the 94**, closes fewer — see below | nothing |
| 2 | The `flags` work, per `docs/fm-step-flags-reference.md` | a wider `whenAbsent.flagBit`, plus a two-state form | **17 steps unwritable → complete**; 0 of the 94 | nothing |
| 3 | Two absent-key defaults (2.4) | two one-line rules | **2 of the 26** | nothing |
| 4 | The fork, per step type, on the 61 mixed steps | one decision per step type, about 20 of them | unknown until each is looked at; shapes 2, 3, 5, 10 and 12 are where they are | nothing |
| — | Everything in *Not worth doing* | — | — | — |
| — | Five confirmed CLI gaps (section 5) | nothing we can spend | nothing available to us | Claris |

**Why the order changed.** The eight **ours** shapes were item 1 and are now section 3's
"what closed this round". Your two answers were item 2 and are now section 2.1. The AI-step lead rises
to the top because nothing else waits on nothing; `flags` stays behind it for the reason it always
did, which is that it settles none of the differences you are reading about.

## Item 1 — the AI-step lead, and its honest limit

**Measured while redoing the `flags` attribution:** on FileMaker's newer AI-related steps, which
option *slots* appear is predicted exactly by which keys the CLI reports. 23 bits looked like they
predicted an option's presence; **21 of the 23 are predicted just as exactly by a reported key**, on
`Generate Response from Model`, `Perform Semantic Find`, `Configure Regression Model`,
`Perform SQL Query by Natural Language`, `Insert Embedding`, `Perform Find by Natural Language`,
`Perform RAG Action` and `Insert Image Captions in Found Set`.

**27 of the 94 sit on those eight step types** — `Generate Response from Model` 11,
`Configure Regression Model` 7, `Insert Image Captions in Found Set` 4,
`Perform SQL Query by Natural Language` 3, `Perform Semantic Find` 2. Re-counted after this round
rather than carried over: the total moved by one and the split inside it moved more, because printing
a value we were holding changes which shape a step falls under without changing its column.

**The limit, stated before anyone plans on 27:** 23 of those 27 also carry the repetition bracket that
is a confirmed CLI gap (shapes 1 and 6), so the rule reduces the difference on them without making the
line agree. Read this item as "reduces 27, closes at most 4". It is genuinely less certain than
anything in section 3's closed list.

**One thing this round supplies that it did not have before**: a route for exactly this shape now
exists and is measured. An option whose text follows from WHETHER a key is reported, rather than from
any value, is derived on `Go to Related Record` and `Send Mail`; the conditions it applies — a
FileMaker display phrase, both states recurring three times, exactly one key reported in exactly the
examples that show it — are the ones this item needs. It fires twice on 1203 examples and declines
twenty-one times, so it is tight rather than eager.

## Item 2 — `flags`, and why it is still not first

The recommendation to defer this was made on the global numbers, re-derived from the per-step-type
numbers, and re-measured again after this round's work. **It has not reversed once.** 18 facts on 15
step types, 7 measured, and the payoff is identical every time: 0 of the remaining differences,
9 of the 26, 8 of the 81.

- Build the **7 measured facts** first: 3 of the 26 and 4 of the 81 become complete. Six step types.
- The **11 low facts** would add 6 and 4 more, and each rests on one example. Three of them
  (`Exit Script`, `Save a Copy as Add-on Package`, `Perform JavaScript in Web Viewer`) describe an
  option the catalog already writes correctly by another rule, so they buy nothing at all.
- `Set Revert Transaction on Error` needs the corpus-wide `0x10000`/`0x20000` pair, because it has one
  example and per-step-type evidence cannot reach it.

`docs/fm-step-flags-reference.md` is the whole attribution, keyed by step type, with the reproduction
commands. Read its opening section before implementing anything: there is no global bit table and a
consumer who builds one from a partial reading will manufacture facts.

## Item 4 — the fork, and the two ties it will run into

The 59 mixed steps are the long tail: about twenty step types, one decision each, and the decision is
always the same fork — is the value in the JSON under a name we did not recognise, or absent? Two of
them are already known to end in a tie rather than an answer, and they are worth knowing before anyone
spends the time:

- **`Perform Script on Server with Callback`** (6 steps). Four keys split its six examples identically,
  so nothing says which decides the script's `Specified:` and which the callback's. The script half is
  settled on two other step types by the same key; the callback half has no precedent in the corpus.
  It needs either wider data or one sentence from you about which key FileMaker is reading.
- **`Go to List of Records`** (4 steps, plus 1 more). Seven keys explain its animation-suppression
  equally well and they are NOT all reported together, so unlike `Go to Related Record` this is a real
  disagreement about the rule. The rows are blocked by a CLI gap in any case.

## Not worth doing

- **A global bit table.** `0x4000` lines up perfectly with 39 unrelated options across the corpus,
  `0x80` with 36, `0x100` with 27. Decoding the word globally would manufacture facts wholesale.
- **Reading a bit where a key already says it.** 177 distinct `(step type, bit)` pairs are in that
  position. The key is not step-local and carries a value rather than one bit of state.
- **Implementing any `low` fact on its own evidence.** 11 of the 18. They are recorded so nobody
  rediscovers them, not so they can be built.
- **Chasing the 73 unreadable steps that gain an option and stay unwritable.** What is still missing on
  those is a file name, a text encoding or an import action, and no bit holds any of those.
- **Reproducing FileMaker's truncation or the arrow-and-globe marker.** Settled in 2.2.
- **Adding a fifth allowance to the comparison.** Exactly four are made and you declined the fifth
  yourself. A comparison that forgives more is not a better renderer.
- **Re-opening anything in section 2.** Your rulings, all implemented.

## What cannot be fixed from our side at all

Five confirmed gaps in the CLI, each checked against its output in every form — a key of its own, a
nested value, the bag of unnamed values (section 5):

1. **The repetition FileMaker appends to an option.** 16 steps, plus 7 more that also disagree about
   something else.
2. **The privilege set name on `Add Account`.** 9 steps.
3. **The flash setting on `Insert from Device`.** 8 steps, 2 of them in the difference list.
4. **The base table FileMaker prints after a layout it names.** 9 steps, on `Go to List of Records` and
   `New Window`.
5. **A menu set's or a table's name behind an internal id.** 4 steps.

And one that is not a CLI gap but is equally unreachable: **the step FileMaker names from an installed
plugin** (4.3). The displayed name is a lookup against what is installed on the machine, so it cannot
be derived from a script at all. One step.

Together these bound the work: **28 of the 94** and 8 of the 26 are closed, and no amount of effort on
our side moves them.
