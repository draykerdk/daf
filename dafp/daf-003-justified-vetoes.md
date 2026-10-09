# DAF-003. Justified vetoes in Phase 0

**Status:** draft · **Type:** process · **Created:** 2026-10-08 · **License:** CC BY 4.0

## Abstract

Voting in the federation is transitional ([DAF-000 §1](./daf-000-federation-constitution.md#1-what-the-federation-is)). It holds until the mechanisms of version 1.0 can be reproduced and tested, and each one that is replaces part of the vote. This proposal reproduces the first of them, the justified veto, in the only form Phase 0 can carry: a public record, kept in this repository, of a veto with its grounds and of the triage that examined it.

The mechanism is the one [UID](https://uid.drayker.org) specifies for the veto chain. UID names Phase 0 as its closest working precedent. This document says which parts of that mechanism a repository can carry now, which it cannot, and what happens to a federation decision while a veto against it is being examined.

## 1. What a justified veto is

A justified veto contests one decision of the federation and carries its real grounds:

- **intention and motives**: why the person vetoes, and what they want to protect;
- **scope**: which action is contested, who is affected, and what interrupting it would cost others;
- **facts or conditions**: what the veto rests on, with evidence wherever it exists;
- **standing**: the person's relation to the decision and to the context it affects.

A veto without grounds is not a veto under this proposal. It can still be argued in the thread like any other comment.

A veto is criticism of a decision, and it is held to the deliberation standard every discussion in Drayker follows ([CONTRIBUTING](https://github.com/draykerdk/.github/blob/master/CONTRIBUTING.md)): kind to people, relentless with ideas. Its grounds are tested with the same rigor as the decision it contests, and a veto that does not pass does not cost its author the place to keep contributing.

Vetoes are not counted like votes. Their grounds are weighed: what each one shows, each person's relation to the decision, the certainty on each side, and what several vetoes reveal in common. A person counts once. Many vetoes that repeat the same grounds add weight to those grounds, not new information. One veto can be enough: when its grounds bring information beyond what was considered before the decision, it can lead by itself to an adjustment.

## 2. What it can contest

Anything the federation decides under [DAF-000 §5.1](./daf-000-federation-constitution.md#51-what-is-voted-on): an award or penalty in an assembly report, a resource decision, the acceptance of a unit record, or a change to the federation's documents. A veto names the decision exactly, by link to the line or file and the commit it contests. In Phase 0 that link is a content hash, the closest thing a repository has to the signed address the veto chain uses.

## 3. How it is filed and recorded

1. **Filing.** The veto is opened with the [justified veto form](https://github.com/draykerdk/daf/issues/new?template=veto.yml), against a decision that is open or already recorded.
2. **Recording.** The veto is copied into `federation/vetoes/<issue-number>.md`, from [`federation/vetoes/TEMPLATE.md`](../federation/vetoes/TEMPLATE.md), by pull request, like every other part of the record. The triage is appended to the same file as it happens, and the file stays even when the veto does not pass.
3. **Triage.** The grounds pass through the five steps UID specifies: verification of the facts claimed, interpretation of what they mean for this decision, detection of error, misunderstanding or manipulation, proportion (a bounded test or a temporary exception before a general change), and human recourse.
4. **Outcome.** The triage ends in one of two ways, each written with its reasons, so whoever vetoed can see how their grounds were read:
   - **adjustment**: an exception, a narrower scope, a new test, or the revision of the rule;
   - **not passed**: the decision stands. The veto stays in the record and can be reconsidered when new evidence appears.

## 4. What a veto does to the decision it contests

A decision against which a justified veto is open, with no triage outcome, is not executed. In Phase 0, executing means merging: an assembly report, a resource decision or a document change is not merged while a veto against it awaits triage, and the assembly report lists the vetoes against its decisions and their state.

If a merge happens anyway, the assembly report records it as an override: who merged, when, and why, in full. DAF-000 §5.4 does not cover it, because the steward's intervention is limited to misalignment with Drayker's published values and purpose, fraud, spam and attacks, and overriding a pending veto is none of those. Whether such an override can ever be legitimate is left open (§9). The record then shows both the veto and the action that did not wait for it.

## 5. What Phase 0 cannot carry

These are limits of the substrate, stated as [DAF-001 §6](./daf-001-phase-0-github-federation.md#6-what-phase-0-does-not-give-you) states the others:

- **Anonymity.** The design lets the author of a veto stay anonymous while the entry proves their standing. A repository cannot do that: a veto filed here is public and attributed. Anyone for whom filing publicly is a risk should not file here. That a well-founded veto went unfiled because of this is itself the condition DAF-001 §7 names as a reason to leave Phase 0, and saying so, in any channel, is useful to the federation.
- **Sealed details.** Grounds that touch someone's body, home or private context cannot be sealed here. They should not be written here.
- **Signatures.** A veto here is a comment from a GitHub account, not a signed entry.
- **Councils.** The fifth triage step, human recourse to a council convened for the question, has no venue in Phase 0 ([DAF-001 §2](./daf-001-phase-0-github-federation.md#2-phase-map)). Until it does, a contested triage stays open and visible in the record. It is not closed by default.

## 6. Who triages

Whoever decided cannot be the only one to examine their own decision. A triage record names everyone who wrote it and states whether any of them is a party to the contested decision: its author, a holder it awards or penalizes, or the founding steward when the decision passed by the steward's weight.

Phase 0 does not yet have enough participants to guarantee that someone who is not a party can always triage. §9 leaves that question open.

## 7. What it replaces

DAF-000 §1 says each reproduced mechanism replaces part of the vote. With this one, a decision that reaches the quorum and the majority can still be revised on grounds the vote did not weigh. Which part of the vote that replaces in practice is what using it will show.

## 8. What it does not change

This proposal adds a condition to [DAF-001 §4](./daf-001-phase-0-github-federation.md#4-the-cycle), step 6: a report, request or document change is not merged while a justified veto against one of its decisions awaits triage. Points, weights, quorum and majority in DAF-000 stay as they are. A veto is never added to a tally and never subtracted from one. The event log of [DAF-002 §6](./daf-002-phase-0-instruments.md#6-the-event-log) does not carry vetoes: their record here is the set of files in `federation/vetoes/`, and how they enter a later substrate is not specified.

## 9. What this proposal does not settle

- **Standing.** Who may file a veto against a federation decision: any participant, only holders, or anyone the decision affects.
- **Triage when everyone is a party.** Who examines a veto when every available person is a party to the decision, as can happen while the federation has one active contributor.
- **Councils.** How a council is convened for a contested triage, and what its conclusion binds, once [`advices`](https://advices.drayker.org) specifies it for the federation.
- **Routine operations.** Whether operational work that is not a federation decision, such as maintaining the site, can be vetoed under this procedure.
- **Indefinite suspension.** A decision can wait without end when every available person is a party to it or its triage is contested and no council exists. How long a decision may wait, and what happens then, is not settled.
- **Overrides.** Whether a merge over a pending veto can ever be legitimate, and who may make it.

---

Part of [`dafp/`](./README.md). Content licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
