# DAFP. Federation proposals

Proposals that specify how the federation works. A proposal here is a document under review, not a deployed rule: what governs Drayker today is [`draykerdk/.github/GOVERNANCE.md`](https://github.com/draykerdk/.github/blob/master/GOVERNANCE.md).

| Proposal | Title | State |
| --- | --- | --- |
| [DAF-000](./daf-000-federation-constitution.md) | Minimal constitution of the federation | draft |
| [DAF-001](./daf-001-phase-0-github-federation.md) | Phase 0: the federation on a repository | draft |
| [DAF-002](./daf-002-phase-0-instruments.md) | Phase 0 instruments: recomputation, drafting and a portable record | proposal |

**DAF-000** is substrate-independent: participants and units, how a federative point is earned, how points become voting weight, quorum and majority, how a resource request is judged against the last-resort rule, penalties and exit.

**DAF-001** is the initial version, the MVP, implemented now on this repository, with no chain and no unit of account. No unit has been recorded and no assembly has been held yet. It also states what is deliberately deferred to later phases, so that the small thing implemented now is not confused with the whole design.

**DAF-002** adds the instruments that keep the Phase 0 record: checks of its structure and arithmetic, a generated ledger, a drafting tool for assembly reports, the arithmetic of a vote for the person who writes the report, and an event log that a later substrate can replay. It changes no rule of DAF-000 and no step of DAF-001.

DAF-000 and DAF-001 are drafts of the same consolidation, and both leave things open on purpose. What neither settles is listed in [DAF-000 §9](./daf-000-federation-constitution.md#9-what-this-document-does-not-settle).

## Proposing a change

Open an issue, argue it in the thread, then send a pull request to `master`. The same path applies to a new numbered proposal and to a correction of an existing one. A number is assigned when the draft is opened as a pull request.

A change to these documents is itself subject to them once the first assembly has been held.
