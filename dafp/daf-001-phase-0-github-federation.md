# DAF-001. Phase 0: the federation on a repository

**Status:** draft · **Type:** process · **Created:** 2026-08-11 · **License:** CC BY 4.0
**Discussion:** https://github.com/draykerdk/daf/issues/1

## Abstract

[DAF-000](./daf-000-federation-constitution.md) says what has to be true. This document says how it runs in Phase 0: on this repository, with no chain, no token, and no cost to operate.

Phase 0 is the smallest thing that is a real federation rather than a description of one. It records real units, real deliveries, and real decisions, and it is auditable by anyone with `git`. It buys none of the guarantees a chain buys, and §6 says so plainly.

## 1. Why a repository first

The federation has no operating budget, no deployed contract, and, at the time of writing, one active contributor. Every earlier draft targeted a chain: Aragon on Ethereum, then DAOhaus on Optimism, then canisters on ICP. Each was abandoned before deployment, and the reason was never the design. It was that a chain deployment demands funding, tokenomics, and an audience before the federation has produced a single recorded decision.

Meanwhile the thing the federation actually needs, a public, tamper-evident, ordered log of who delivered what and what was decided, is what a Git repository already is.

So Phase 0 inverts the order. Run the rules first on infrastructure that already exists and already works. Learn what the mechanics get wrong while getting it wrong is cheap. Move to a chain when there is something whose value justifies the guarantee, and let the migration carry a real history instead of a whitepaper.

## 2. Phase map

What belongs to this MVP, and what is deliberately deferred:

| Concern | Phase 0, this document | Later phases |
| --- | --- | --- |
| **Substrate** | This repository. Git history is the ledger. | ICP is the stated direction, on the conditions in §7. |
| **Units** | Records in `federation/units/`, one file each. | Linked by contract or canister. |
| **Points** | Integers in the assembly ledger, recomputable from history. | Non-transferable on-chain records, migrated with their history. |
| **Voting** | Declared votes on the assembly pull request, tallied in the open. | Enforced by the substrate. |
| **Treasury** | None held. Requests are decided and recorded. Any actual disbursement happens outside and is reported. | Federation-held funds under the decided rules. |
| **Transferable instrument** | Does not exist ([DAF-000 §6.1](./daf-000-federation-constitution.md#61-what-is-not-in-scope-here)). | Out of scope until a substrate and a review permit it. |
| **Automated evaluation of functions** | None. Humans judge, in public. | Proposed for the Dk platform. Not specified anywhere. |
| **Anonymous participation** | Not supported. Participation is a public account. | Open problem across the drafts. Unsolved. |
| **Councils** | Not represented. Review is public and open to anyone. | [`advices`](https://advices.drayker.org), unspecified. |

The right-hand column is not a roadmap and carries no dates. It is a record of what was deliberately left out, so that Phase 0 is not mistaken for the whole design and the rest is not mistaken for work in progress.

## 3. What Phase 0 is made of

```text
federation/
  units/<unit-id>.yml        one record per participant or unit
  assemblies/YYYY-MM.md      the report, the ledger, and the decisions of one cycle
  requests/<n>-<name>.md     resource requests under evaluation
  LEDGER.md                  current standing, generated from the assemblies
```

Nothing here is a database. Each file is readable on its own, and `LEDGER.md` is a convenience: if it ever disagrees with the assemblies, the assemblies are right.

**A unit record** states its id, what it is, its founding function, who can speak for it, and where its work is. Nothing about its internal governance, its members' identities, or its finances belongs in the federation's records.

**An assembly report** is the record of one cycle: what was delivered, what was decided, which points were awarded and removed and for which delivery, and what the federation would change about itself. It is written as one pull request.

## 4. The cycle

1. **Open.** A cycle opens with an issue listing what is up for decision: the deliveries claimed since the last assembly, any resource requests, any proposed changes.
2. **Claim.** Anyone who delivered a function links the issue that declared it and the merged result. Claims are made in public and can be contested by anyone in the thread.
3. **Draft.** The assembly report is opened as a pull request against `master`, with the proposed awards, penalties, and decisions written out and each one attributed to a specific delivery.
4. **Review.** The pull request stays open for a fixed window of **seven days**, during which anyone can argue with any line of it.
5. **Vote.** Holders vote on the pull request, one comment per holder, in the format below. Weight comes from the ledger as it stood at the *previous* assembly, so that the awards being voted on cannot change the votes that approve them.
6. **Tally and merge.** The tally is written into the report: active points, participation, votes for and against, and the outcome against [DAF-000 §5.3](./daf-000-federation-constitution.md#53-quorum-and-majority). Merging records the result. A proposal that fails to reach quorum is recorded as failed for lack of participation, and the report says so rather than quietly omitting it.

A vote is a single comment, so it can be found and counted mechanically:

```text
VOTE: for | against | abstain
AS: <unit-id or participant-id>
```

Anything else in the comment is discussion. A holder's last comment of this form is the one that counts, so a vote can be changed by voting again before the window closes.

## 5. Resource requests in Phase 0

The federation holds no treasury in Phase 0. A request is still filed, evaluated against [DAF-000 §6](./daf-000-federation-constitution.md#6-resources), and decided in the assembly. An approval is a decision to support, not a transfer. Any money that actually moves, moves outside this repository and is reported back into the assembly that follows, with what was spent and what it produced.

This is stated so that no one reads an approved request as funds received. Approvals that never became disbursements stay visible in the ledger. A federation that hides its unfunded approvals learns nothing from them.

## 6. What Phase 0 does not give you

- **No censorship resistance.** The founding steward controls the repository and can merge, revert, or restrict. GOVERNANCE.md already says so. What the steward cannot do quietly is rewrite the record: history is public, and force-pushing `master` is outside the declared exception.
- **No cryptographic guarantee.** A GitHub account is not a key, a vote comment is not a signature, and the tally is computed by a person. Everything is verifiable by reading. Nothing is enforced by math.
- **No sybil resistance beyond judgment.** Points require delivered, public work reviewed by people, which raises the cost of a fake identity but does not make it impossible.
- **No anonymity.** Participation requires a public account. The drafts describe contributors who cannot participate publicly. Phase 0 has no answer for them, and pretending otherwise would put them at risk.
- **No custody.** No funds are held.

These are the limits of the substrate, not defects in the design. They are the argument for Phase 1, and the reason to know exactly what the federation is worth before paying for it.

## 7. When Phase 0 stops being enough

Phase 0 should be replaced when it is failing at something specific, not when a chain becomes affordable. Concretely, when any of these is true:

- **Custody is required.** The federation is offered resources it must hold itself rather than route.
- **The steward's control becomes the binding constraint.** A decision the federation reached cannot be trusted precisely because one account could have altered it.
- **Participation outgrows the manual tally.** Counting votes by hand becomes the reason decisions are late.
- **A contributor is put at risk by publicity.** Anonymous participation stops being theoretical.

None of these is reached by adding features. Each is reached by the federation actually working. That is why the migration is a consequence of Phase 0 succeeding, not a prerequisite for starting it. When one is reached, the substrate is chosen against the requirement that caused it, and the history in `federation/` migrates with it.

**The stated direction is ICP**, for reputation and resource management that a repository cannot carry. That is a direction, not a deployment and not a date: it says where the work is expected to go, and the conditions above still decide when it goes there. Naming it early is useful. It lets the record in `federation/` be designed to survive the move, and it is exactly the claim that three previous attempts got wrong by treating the platform as the starting point rather than the consequence.

## 8. Status

The structure in §3 exists, at [`federation/`](../federation), with the templates for a unit record, a resource request and an assembly report. **Nothing is running in it.** No unit is recorded, no points have been issued, and no assembly has been held.

The next function is the first assembly: open the cycle, claim a delivery that already happened, and take the record through the procedure in §4 to see where it breaks. It is deliberately small, because the point is to find out what these rules cost to operate before anyone else is asked to live under them.

The federation begins at that assembly, not at the commit that created the folders.

---

Part of [`dafp/`](./README.md). Content licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
