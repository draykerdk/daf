# DAF-000 — Minimal constitution of the federation

**Status:** draft · **Type:** process · **Created:** 2026-08-11 · **License:** CC BY 4.0
**Discussion:** https://github.com/draykerdk/daf/issues/1

## Abstract

The DAF README states that units accumulate federative points and voting power over federation resources and decisions. This document specifies what a unit is, how a point is earned, how a decision is taken, and how a resource request is judged against the rule that federation support is a last resort.

It is a proposal. Nothing here is deployed, and no part of it overrides [`draykerdk/.github/GOVERNANCE.md`](https://github.com/draykerdk/.github/blob/master/GOVERNANCE.md), which describes the governance actually in force during the founding phase. Where this document and that file disagree, that file wins.

The rules below are substrate-independent: they say what has to be true, not which platform enforces it. [DAF-001](./daf-001-phase-0-github-federation.md) specifies how they run today, on a repository, with no chain and no token.

## 1. What the federation is

The federation is the layer where autonomous units cooperate on Drayker's main projects without being absorbed into one organization. It has no head office and no staff. It holds shared resources, it recognizes delivered work, and it decides what it funds.

It is not a company, not a legal person, and not a fund with a return. Contribution earns recognition and voting weight inside the federation. It does not earn a wage, equity, or a claim on anything outside the federation.

## 2. Participants and units

**A participant** is one person, identified by a public account that can sign work — during the founding phase, a GitHub account. One human, one participant record.

**A unit** is any group that links itself to the federation: a team, a project, a cooperative, a DAO. A unit declares a founding function — the single purpose it exists to serve — and every later contribution of that unit hangs off it. A unit governs itself internally however it wants; the federation judges its deliveries, not its bylaws.

Both participants and units hold points and vote. Joining a unit is not required, but the federation's work is modular, and a unit is what lets several people carry one module together.

A unit exists in the federation from the moment its record is accepted (§7) and it delivers its first function.

## 3. Federative points

Points are the record of delivered work. They are **non-transferable**: they represent the history of an identity, personal or collective, and cannot be bought, sold, delegated, or moved between holders.

### 3.1 What counts as delivered work

The unit of account is the **function**, as defined by [DFM](https://dfmp.drayker.org): a piece of work small enough that one person can finish it and defined enough that the result composes with the rest.

A function counts as delivered when all of the following hold:

1. it was declared in public before the work was accepted as complete — an issue, a proposal, or a line in a funded module;
2. its result is public and inspectable — merged code, a published document, a translation, a review, a design, an operational task with a record;
3. it closes. Ongoing effort with no completion is not a function.

A **module** is a set of functions declared in advance as delivering one whole. A module completes when all of its functions are delivered and the whole works.

Nothing about this is limited to code. Writing a paper, translating documentation, running an assembly, reviewing someone else's proposal, and maintaining infrastructure are all functions.

### 3.2 How many points

- One delivered function: **1 point**.
- Completing a declared module: **1 additional point for each function in it**, awarded to the unit or participant that carried the module to completion.

The module bonus exists because integration is the part that gets abandoned. Without it, the incentive is to farm easy functions and leave the whole unfinished.

The bar for what counts as one function **rises over time**. As tooling and automation improve, work that used to be a function becomes part of one. This is deliberate: it rewards contributors who arrive while the work is hard, and it pushes the federation to automate what it has already learned to do.

Both the award values and the rising bar are starting parameters. They are changed by the procedure in §5, not by anyone's discretion.

### 3.3 Decay and dilution

**Points do not decay.** History is not deleted, and a contributor who steps away does not lose the record of what they did.

Influence still moves, by dilution: as new work is delivered, new points are issued, and every existing holder's share of the total falls unless they keep contributing. An early holder with a large share who stops working watches that share shrink. This is the mechanism by which founding weight is meant to disperse — not an amnesty schedule, but continued work by other people.

Points are removed only as a penalty (§6).

### 3.4 Points and voting weight

One point is one vote. A unit votes with the points it holds; how it decides its own position is internal to the unit and is not the federation's business.

A holder is **active** if it cast a vote or delivered a function in any of the last three assemblies. Holders who are neither are **dormant**: they keep every point, and their points are excluded from the denominator when quorum is computed (§5.3). Without this, an abandoned unit's points would make quorum unreachable and freeze the federation.

A dormant holder becomes active again by voting or delivering, with no readmission procedure.

## 4. Proposals

A proposal is how anything enters the federation: a resource request, a unit's recognition, a change to these rules.

Every proposal states, in this order:

1. **What is delivered.** The function or module, defined so that a stranger can tell whether it was done.
2. **Why the federation.** What this serves in Drayker's main projects.
3. **What it depends on.** The functions it builds on, by reference. A proposal that continues previous work must name it.
4. **What it costs.** Resources requested, or an explicit statement that none are.
5. **How it will be reported.** What evidence will exist when it is finished.

Proposals compose the way functions do. When a function has been funded, later proposals must reference it, so a project accumulates a visible tree: unsatisfied deliveries become bad references, and everything hanging off them is harder to approve. A record of finished work makes the next proposal easier to pass. That feedback loop is the federation's fraud resistance, and it is the reason funding is granted per function rather than per project.

Proposals should be small. A participant with a single function is better served by proposing it to a unit already working in that area than to the whole federation; the federation reviews with more rigor than any one person can satisfy, and a unit can absorb a beginner's mistakes without them becoming a public failure.

## 5. Decisions

### 5.1 What is voted on

- **Resource requests** (§6).
- **The monthly ledger**: point awards, penalties, and unit records for the period.
- **Changes to this constitution** and to the documents it governs.

### 5.2 What is not voted on

- Anything internal to a unit. The federation does not govern its members' work.
- Anything that contradicts Drayker's published values and purpose. This is not a matter of majority.
- Anything requiring authority the federation does not have — legal, financial, or contractual obligations of any kind.

### 5.3 Quorum and majority

A proposal passes when both hold:

- **participation of at least 30%** of active points (§3.4), counting all votes cast, including abstentions and votes against; and
- **a simple majority of the votes cast** — 50% + 1.

Below 30% participation nothing passes, whatever the split. The threshold is deliberately a participation floor rather than an approval floor: a federation that cannot get a third of its weight to look at a decision has no business making it.

### 5.4 The founding steward

During the founding phase, the authority the drafts call the Embassy is exercised by the founding steward described in [GOVERNANCE.md](https://github.com/draykerdk/.github/blob/master/GOVERNANCE.md). While the total number of points is small, that steward's share is a majority by construction, because the steward has done most of the delivered work. This is stated rather than hidden.

The steward's intervention is limited to proposals that are misaligned with Drayker's published values and purpose, and to fraud, spam, and attacks on the federation. It is not a preference veto, and every use of it is recorded with its reason.

The way out is §3.3: other people delivering functions. There is no automatic date, and this document cannot create one — the transition is governed by GOVERNANCE.md and changes only there.

### 5.5 The assembly

Decisions are taken in a monthly cycle. Each cycle produces one public report: what happened, what was delivered, what is blocked, which proposals were decided, which points were awarded and removed, and what the federation would change about itself.

The report is the record. Every award and every penalty in it is attributable to a named delivery, and anyone can recompute the ledger from the history.

## 6. Resources

The federation is funded by grants, donations, and side projects. It is non-profit, and it holds no reserve it is not prepared to justify.

**Support is requested only where there is no alternative.** This rule is published deliberately: a federation that treats shared resources as a first resort stops being able to fund anything that matters. The main projects are the priority, and resource efficiency is a condition of every request, not an aspiration.

A resource request is evaluated only if it states:

1. **what was tried first**, and why no other route exists — the applicant's own resources, the unit's treasury, a side project, an external grant;
2. **which main project this serves**, concretely;
3. **the function or module tree** it funds, with the previous deliveries it builds on;
4. **the amount, and what happens at partial funding** — what gets delivered with less, or why less delivers nothing;
5. **how the result will be evidenced**, and by when.

A request missing any of these is not judged on merit; it is returned.

Funding is granted per function or per module, in sequence. The next grant is evaluated against the evidence of the last one. Undelivered work does not merely fail to earn points — it degrades every proposal that references it.

### 6.1 What is not in scope here

The earlier drafts describe a second, **transferable** instrument representing a claim on the treasury, convertible to local currency and later to the ecosystem's unit of value. That design is not specified in this document and is not issued. It cannot exist on the current substrate, and a transferable claim on pooled funds is a financial instrument with obligations the federation is not in a position to carry. It stays out until there is a substrate that can hold it and a review that says it may exist. The drafts are preserved; they are not in force.

Federative points are the only instrument this constitution creates, and they are not tradable.

## 7. Joining, penalties, and leaving

**Joining.** A participant or unit submits a record — who it is, its founding function, how to reach it — and delivers a first function. The record and the first award are accepted in the same assembly. There is no fee and no invitation.

**Penalties.** A unit that commits to a function and does not deliver it loses points, in proportion to what was committed and what the federation had already granted. Where collusion or fraud is established, the holder loses its accumulated points entirely. A member's failure is the unit's failure: how a unit distributes that internally is its own affair, and units that govern themselves well are visibly the ones whose proposals keep passing.

Every penalty is proposed, justified against a specific commitment, and voted like anything else. Absence of activity is never a penalty — a dormant holder loses no points (§3.4).

**Leaving.** A unit may leave at any time by saying so. Its points remain in the record: the history of delivered work is not erased by departure. Resources granted for functions it will not deliver are returned, or the outstanding amount is recorded in the ledger, where it stays visible.

## 8. Transparency

Everything this document governs is public and versioned: unit records, point awards, penalties, resource decisions, and assembly reports. A decision that cannot be recomputed from the public record did not happen.

Where a rule is unspecified, the federation says so rather than filling the gap with practice. Undocumented custom is how a structure without an owner acquires one.

## 9. What this document does not settle

- **The substrate beyond Phase 0.** [DAF-001](./daf-001-phase-0-github-federation.md) runs on a repository. Which platform holds the federation when a repository is no longer enough, and what triggers the move, is stated there as open.
- **The transferable instrument** (§6.1).
- **Where councils fit.** [`advices`](https://advices.drayker.org) is the proposed council layer, and specialist review before a federation vote is described across the drafts. Neither the composition of a council nor its authority over a proposal is specified anywhere.
- **The relationship to UID.** [`uid`](https://uid.drayker.org) is meant to carry contribution history, and federative points are meant to convert into it. No conversion is specified.

These are open functions, not oversights. Anyone can write them.

---

Part of [`dafp/`](./README.md). Content licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
