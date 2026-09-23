# What the fm CLI does about FileMaker plug-ins

Measured against **fm 0.8.0 (29834929)**, with contrasts against **0.8.0-beta.0 (29827611)** where
the two differ. Claims are marked MEASURED (a command in this repo produced it) or DOCUMENTED (fm's
own `help --json --all` says it). **On this topic the two disagree, so the distinction is not
pedantry** — see [Where fm's own help is wrong](#where-fms-own-help-is-wrong).

The machine these measurements come from has four plug-ins installed. That is not incidental — see
[Plug-ins make some results machine-dependent](#plug-ins-make-some-results-machine-dependent).

## The short version

| question | answer on GA | how |
|---|---|---|
| Does a plug-in's own function validate? | **Yes** | MEASURED |
| Does `External( … )` validate? | **No** — `calc_unknown_function` | MEASURED |
| Is a plug-in call in a calc read back intact? | **Yes, verbatim** | MEASURED |
| Does `references` name a plug-in call? | **No** — it is omitted from the array | MEASURED |
| Is a plug-in *script step* identified? | **Yes**, and it joins to the harvest | MEASURED |

So the gap is narrow and specific: **fm reads and preserves a plug-in reference perfectly well, and
declines to tokenise it.** It is not that plug-in references are lost or unreadable.

## Plug-in functions validate; `External()` does not

MEASURED, all on GA against a hosted Ooe:

| formula | `valid` | `references` | error |
|---|---|---|---|
| `BE_Version` | `true` | `[]` | — |
| `MBS ( "Version" )` | `true` | `[]` | — |
| `External ( "BE_Version" ; "" )` | **`false`** | key absent | `calc_unknown_function` |
| `<a field> & BE_Version` | `true` | the field only | — |
| `Length ( <a field> )` (control) | `true` | the field only | — |

The reason `External()` behaves differently is measurable rather than a guess: `--harvest-plugins`
lists `BE_Version` and `MBS` in its inventory and does **not** list `External`. fm registers the
functions the installed plug-ins declare; `External` is FileMaker's legacy generic entry point,
declared by no plug-in, so nothing registers it.

Note the fourth row. A plug-in call does not prevent the rest of the formula being tokenised — the
field still comes back in `references`. The plug-in call is simply absent from the array.

## Where fm's own help is wrong

DOCUMENTED. `fm help calculation validate` carries this note:

> PLUG-IN FUNCTIONS ARE THE ONE GAP. `External()` and a third-party plug-in's own functions are not
> registered here, so a formula using one is `valid:false` with `calc_unknown_function` even though
> FileMaker Pro with that plug-in installed accepts it.

The `External()` half is correct. **The "third-party plug-in's own functions" half is contradicted
by measurement** on a machine where those plug-ins are installed: `BE_Version` and `MBS ( … )` both
validate `true`.

This is worth recording as a method point, not just a fact. An earlier draft of this document
predicted — from that note alone — that GA had reverted the beta's behaviour, and that four
`plugin-call-sites` register rows written from the beta would need reverting. **The measurement
showed the opposite: nothing needed reverting.** This repo's usual rule is that `fm help` is the
authoritative surface because a probe only notices a change once something breaks. That rule holds
for which catalogs, ops and keys EXIST. It does not hold for behaviour that depends on machine
state, and plug-in registration is exactly that.

## Plug-in references survive reading intact

MEASURED, and this confirms what the ADT developers said. Two real call sites in Ooe, read with
`read:script` and returned verbatim inside the calculation text:

- a `Set Variable` step in script 55 whose formula assigns `BE_CurlTrace` to a `Let` variable;
- a `Set Variable` step in script 39 whose formula calls `MBS( "SyntaxColoring.RemoveTag" ; … )`.

Neither is rewritten, flagged or dropped. fm hands back the formula as text, plug-in calls included,
whatever the evaluator can or cannot register. So a caller who wants a formula's plug-in call sites
can find them in the text fm already returns.

The **editability** half of the developers' claim is not tested here, and cannot be: every op this
repo sends is read-only (`assertReadOnly` gates all of them), so nothing writes a calc back.

## Plug-in script steps are identified, and join to the harvest

MEASURED. An MBS script step in script 39 reads back as:

```json
{"stepID":186,"step":"ExternalStep","plugin":"4d425350","externalID":2,
 "parmTypes":[1,1,1,1,1,1,1,1,1,1],"pluginStep":"MBS",
 "pluginDescription":"Calls MBS Plugin function as script step.",
 "arguments":{"Function":"$Command","P1":"$P1", … },
 "slots":{"calc":{"0":"$Command","1":"$P1", … }},"flags":20737}
```

`pluginStep`, `pluginDescription` and `arguments` arrived in 0.8.0-beta.0. The useful part is that
`plugin` + `externalID` are a **joinable key** into `--harvest-plugins` output, whose `steps` entry
for this step is `{"plugin":"4d425350","id":2,"name":"MBS", "definition":"<PluginStep>…"}`. So a
plug-in step read out of a script can be resolved to the plug-in's own declaration of it, including
its parameter definition.

`arguments` is absent on instances that have none, so treat it as optional.

## `--harvest-plugins=<path>`, new in GA

DOCUMENTED, from `fm --help`:

> load the installed FileMaker plug-ins and write what functions and script steps they offer to
> `<path>` as JSON, then exit without opening a database. Ordinary runs do this for themselves, in a
> separate process, and answer from a cache — so this is here to be READ rather than needed: it is
> how you see what this tool can make of the plug-ins on the machine. It is also the one mode that
> runs plug-in code, which is why a plug-in that crashes ends this command and not your others.

Two properties matter before wiring it into anything: it **opens no database**, so it needs neither a
hosted file nor credentials (it was the only fm capability still usable here while Ooe was down);
and it **runs third-party plug-in code**, which ordinary runs also do, but in a process whose crash
does not take your batch with it.

MEASURED on this machine — `{functions, steps, plugins}`:

| | count |
|---|---|
| plug-ins, all `status: "available"` | 4 |
| functions | 151 |
| script steps | 1 |

Functions per plug-in id: BaseElements (`47794245`) 144, 2empowerFM (`44726755`) 6, MBS
(`4d425350`) 1. Each carries `{plugin, id, name, prototype, description, minArgs, maxArgs,
typeFlags}`:

```json
{"plugin":"47794245","id":655,"name":"BE_ArrayChangeValue",
 "prototype":"BE_ArrayChangeValue ( array ; valueNumber ; newValue )",
 "description":"Array Change Value|Modifies the value in the array at valueNumber …",
 "minArgs":3,"maxArgs":3,"typeFlags":65280}
```

Three data-quality notes, all MEASURED:

- **Three BaseElements functions harvest with numeric names** — `140`, `300`, `301` carry their id as
  `name`, `prototype` AND `description`. An unresolved string resource in the plug-in, not an fm
  defect, but anything treating `name` as a label must tolerate it.
- **MBS reports one function, not thousands.** Correct, not a truncated harvest: MBS exposes a single
  dispatcher function plus its script step.
- **2empowerFM_Developer_Assistant loads but declares nothing**, so `plugins` has four entries while
  only three plug-in ids appear across `functions`.

## Ordinary runs still load plug-ins

MEASURED, both builds. Every ordinary batch emits one stderr line naming what it scanned and loaded;
GA adds a `harvested` field:

```json
{"type":"plugins","scanned":["…/FileMaker Pro/26.0/Extensions","…/FileMaker/Extensions"],
 "loaded":["BaseElements.fmplugin","MBS.fmplugin","2empowerFM.fmplugin",
           "2empowerFM_Developer_Assistant.fmplugin"],
 "declined":[],"failed":[],"harvested":false}
```

Read with the flag documentation above, `harvested: false` reads as "this run did not harvest; it
answered from the cache".

## `references` is absent, not empty, when a formula does not parse

DOCUMENTED, and a trap worth quoting because the two states mean opposite things:

> THE `references` KEY IS ABSENT WHEN THE FORMULA DID NOT PARSE, and that is the difference between
> "refers to nothing" and "could not be read". An empty array means a formula that parsed and refers
> to nothing; no array at all means `valid` is false and there was no tree to read. Never treat a
> missing array as an empty one.

MEASURED and consistent: `External( … )` (invalid) returns no `references` key at all, while
`BE_Version` (valid) returns `references: []`. A consumer reading missing-as-empty would conclude the
`External()` formula is reference-free when in fact it was never read.

## What this does to the `plugin-call-sites` gap

The register's gap row stays a gap, and this build lets it be stated far more sharply than "fm
cannot recover a formula's plug-in call sites".

What fm does: registers the plug-in's functions, so the formula VALIDATES; returns the formula text
verbatim, so the call site is visible in it; publishes the whole plug-in function inventory via
`--harvest-plugins`; and resolves a plug-in script step to its declaration.

What fm does not do: name the plug-in call in `references`, the one place a caller would look for a
machine-readable answer. So the ask to Claris is that fm already holds every piece — it knows the
function names on the machine, it accepted the call as valid, and it walks the formula to build
`references` — and simply does not emit that one kind of token.

## Plug-ins make some results machine-dependent

The durable point, independent of build.

`plugin-call-sites`' evidence is a function of **which plug-ins are installed on the machine that
ran `fm-gaps check`**. With BaseElements installed the probe formula validates; without it, the same
probe on the same file and the same build would answer `calc_unknown_function` — which is what fm's
own help describes, and is probably why the help says what it says.

The register has no field recording this. `gaps/intake.json` names the fm version, build and date;
nothing names the plug-in set. Two runs of `check` can disagree about this entry and both be
faithful, and the register cannot say why. Worth considering:

- record the loaded-plug-in list (or the harvest counts) alongside the evidence, so an entry whose
  outcome depends on it can be read honestly; and
- for the four fm-only rows on `plugin-call-sites` that are about `validate:calculation`'s general
  shape (`for`, `valid`, `error`, `warnings`) rather than about plug-ins, prefer a probe formula that
  does not depend on the plug-in set, so those rows stop moving whenever this behaviour or the
  machine changes. The gap row itself should keep the plug-in formula — that IS its subject.

## Reproducing this

```sh
FM="$HOME/Library/Application Support/ADT/MCP/fm-cli/fm-cli"   # 0.8.0 installs here, not /usr/local/bin
"$FM" --harvest-plugins=/tmp/harvest.json && python3 -m json.tool /tmp/harvest.json | head -40
```

The behaviour half needs a hosted file:

```sh
printf '%s\n' \
  '{"op":"validate:calculation","calculation":"BE_Version","references":true}' \
  '{"op":"validate:calculation","calculation":"External ( \"BE_Version\" ; \"\" )","references":true}' \
  > /tmp/ops.ndjson
"$FM" --file=fmnet://localhost/ooe --username=admin --keychain --no-prompt /tmp/ops.ndjson
```
