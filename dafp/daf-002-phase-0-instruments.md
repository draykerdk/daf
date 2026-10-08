# DAF-002. Phase 0 instruments: recomputation, drafting and a portable record

**Status:** proposal · **Type:** process · **Created:** 2026-10-08 · **License:** CC BY 4.0
**Discussion:** https://github.com/draykerdk/daf/issues/2

## Abstract

[DAF-000 §8](./daf-000-federation-constitution.md#8-transparency) says that a decision that cannot be recomputed from the public record did not happen. [DAF-001](./daf-001-phase-0-github-federation.md) puts that record in this repository. This proposal adds the instruments that do the recomputing. They read `federation/`, check its structure and arithmetic, regenerate the ledger, draft an assembly report from the claims of a cycle, compute the arithmetic of a vote for the person who writes the report, and export the record as an ordered, hash-linked event log that any later substrate can replay.

It changes no rule of DAF-000 and no step of the cycle in DAF-001 §4. Where those documents are silent, the instruments say so and stop. They do not choose for the federation.

## 1. What the instruments are for

Phase 0 asks people to do by hand what a chain would enforce: count, sum, compare and keep the order of events. The instruments take over the arithmetic and the transcription, so that the first assemblies measure what the rules cost to operate (DAF-001 §8), not what copying tables costs.

They are also how the record stays portable. DAF-001 §7 expects the history in `federation/` to survive a move to another substrate with its attributions intact. That only works if the history can be read the same way by anything that reads it. §6 gives that reading a fixed form.

## 2. What they do not do

- **They do not judge.** Whether a delivery happened, whether it is one function or several, and whether a request is justified are argued by people, in public (DAF-001 §2).
- **They do not decide.** No instrument merges, labels, closes or approves anything. The vote table in an assembly report is still written by a person and merged by a person.
- **They do not run on their own.** The tally is a workflow someone dispatches for one pull request. Checks run on pull requests and report. Nothing reacts to a comment by itself.
- **They do not vote.** A vote is posted by the holder, or by someone the holder's record lists as able to speak for it. A tool, or anyone acting on another's behalf, never casts one.

## 3. The instruments

Everything lives in [`tools/`](../tools) and runs with Node and nothing else installed.

| Command | What it does |
| --- | --- |
| `node tools/daf.js check` | Validates unit records, assembly reports, resource requests and parameters; checks the point arithmetic of every report; checks that `LEDGER.md` is exactly what the assemblies produce. Runs on every pull request. |
| `node tools/daf.js ledger --write` | Regenerates `federation/LEDGER.md` from the assemblies. |
| `node tools/daf.js draft YYYY-MM` | Writes a draft report for a cycle from its cycle issue and its claim issues, with the outcome left `pending`, and a record stub for each holder that has none. Claims that fail the structure are listed at the top of the draft, not dropped silently. |
| `node tools/daf.js tally …` | Computes the vote on an assembly report. Run by the **Federation tally** workflow, which a person dispatches with the pull-request number. It writes the result to the run summary, or to one comment on the pull request when asked. |
| `node tools/daf.js close YYYY-MM …` | After the window, writes the vote tables and the outcome into the report, sets `joined` on the records the assembly accepts and regenerates `LEDGER.md`. It changes files. It commits nothing. |
| `node tools/daf.js snapshot` | Builds the data the site reads, `data/federation.json`, plus the event log. Run by the site workflow. |
| `node tools/daf.js events` | Exports the event log of §6. |

`node --test tools/test` runs the tests. They use fictional records, kept in `tools/test/fixtures/`, which are never published on the site.

## 4. Parameters

The numbers of DAF-000 and DAF-001 are kept in [`federation/parameters.yml`](../federation/parameters.yml) so that every instrument reads them from one place: one point per function, the module bonus, the 30% quorum and the base it is computed on, the seven-day window, and the three assemblies after which a holder is dormant.

The file is not a second constitution. `check` fails whenever it disagrees with the text of DAF-000 or DAF-001, so a number changes only in the same pull request that changes the document, by the procedure in DAF-000 §5.

## 5. Readings the instruments apply

DAF-001 leaves a few operational details implicit. The instruments need an answer to run, so they apply the readings below. Each is a proposal of this document, and each can be changed the same way as any other rule.

- **The window** opens at 00:00:00 UTC of the day it opens and closes at 23:59:59 UTC of the day it closes, so both days count.
- **Who can vote for a holder.** A vote counts when its author is listed in the holder's `speaks_for`. GitHub logins are compared without regard to case. A vote by anyone else is listed, with the reason, and not counted.
- **Edited votes.** A vote comment edited after the window closes is listed and not counted.
- **Where votes go.** Votes are conversation comments on the report's pull request. A vote written in a review or on a line of the diff is listed and not counted.
- **Weight** comes from the assemblies held before the cycle, which is the ledger as it stood at the previous assembly (DAF-001 §4, step 5).
- **A failed assembly** awards nothing: its deliveries, bonuses, penalties and new records do not enter the ledger. Its votes still count as activity, because DAF-000 §3.4 makes a holder active when it casts a vote.
- **Concentration is stated.** The tally shows each holder's share of the base, and says so when one holder alone reaches the quorum or the majority. DAF-000 §5.4 already says the founding steward's share is a majority while the total is small; the tally says it at the moment it decides something.

## 6. The event log

The event log is the record of the assemblies written as a sequence of events, each linked to the one before it by its hash. It is derived from the files in `federation/`, never edited by hand, and published with the site as `data/events.json` and `data/events.log`.

### 6.1 Events

For each assembly, in order of cycle, the events are emitted in this order:

| Kind | When | Holder | Points | Value |
| --- | --- | --- | --- | --- |
| `unit.recorded` | passed | the new holder | 0 | `participant` or `unit` |
| `function.delivered` | passed | the holder | the points awarded | |
| `module.completed` | passed | the holder | the bonus | |
| `penalty` | passed | the holder | the points removed, negative | |
| `request.decided` | passed | the requesting holder | 0 | `approved`, `returned` or `rejected` |
| `vote.cast` | always | the holder | its weight | `for`, `against` or `abstain` |
| `steward.intervention` | when recorded | | 0 | |
| `assembly.closed` | always | | 0 | `passed` or `failed` |

A report whose outcome is still pending emits nothing. Every event names the file it comes from and the links that evidence it. Events taken from an assembly report also carry the report's git blob hash, which binds them to its exact text. Unit records and resource requests can change after they are accepted, for example when a unit updates who can speak for it, so their events name the file without a hash.

### 6.2 The exact form

An event is hashed from a fixed text, so that any implementation, in any language, gets the same bytes:

```text
daf-event/1
seq=<1, 2, 3 …>
kind=<kind>
cycle=<YYYY-MM>
holder=<id, or empty>
points=<integer>
value=<token, or empty>
ref=<path of the source file in the repository>
blob=<git blob hash of the assembly report, or empty>
evidence=<number of evidence lines>
evidence=<url>
prev=<hash of the previous event; 64 zeros for the first>
```

Each line ends with a newline. Values use printable ASCII without spaces; anything else stops the export with the file and row that caused it. The hash of an event is the SHA-256 of that text, in lowercase hexadecimal. The head of the log is the hash of the last event.

The first line names the version of the derivation. Any change to how events are derived from the files changes that line, and the tools of the earlier version remain at the commit that used them, so an old head can always be recomputed.

### 6.3 What the log gives, and what it does not

Anyone can check out the repository at a commit, run `node tools/daf.js events`, and compare the head with a copy held anywhere else. If they match, the copy is complete and unaltered. A later substrate can import the log, recompute every hash and replay the ledger, and arrive at the same numbers from the same history.

The hashes identify content. They are not signatures and do not say who wrote anything. They do not change the limits in DAF-001 §6: the founding steward still controls the repository, and someone able to rewrite the history can rewrite the log with it. What the log adds is that any copy taken earlier will then disagree.

The log carries the assemblies. It does not carry vetoes or any other record that the federation has not specified.

## 7. What stays unspecified

The instruments stop where the documents stop. Two such places matter now.

**The founding assembly.** Weight comes from the assemblies before the cycle, and before the first assembly there are none. No holder has weight, so no participation can be computed. DAF-000 and DAF-001 do not say how the first assembly is decided. The tally reports the outcome of that case as *undetermined*, lists the votes it found, and stops. The decision belongs to a change in DAF-001 §4, not to a tool.

**Corrections.** The record's README says a mistake in a past assembly is corrected by a later assembly, not by editing the original. `check` warns when a merged report is modified and names the file, and it does not block the change. Whether that should become a hard rule is left to the federation.

## 8. What merging this proposal decides

That the instruments of §3 become the way the record is checked and maintained in Phase 0; that `federation/parameters.yml` holds the numbers and must agree with the documents; that the readings of §5 apply until changed; and that the event log of §6, in version 1, is the portable form of the record. Nothing else in DAF-000 or DAF-001 changes.

---

Part of [`dafp/`](./README.md). Content licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
