# DAFP. Federation proposals

Proposals that specify how the federation works. A proposal here is a document under review, not a deployed rule: what governs Drayker today is [`draykerdk/.github/GOVERNANCE.md`](https://github.com/draykerdk/.github/blob/master/GOVERNANCE.md).

| Proposal | Title | State |
| --- | --- | --- |
| [DAF-000](./daf-000-federation-constitution.md) | Minimal constitution of the federation | draft |
| [DAF-001](./daf-001-phase-0-github-federation.md) | Phase 0: the federation on a repository | draft |

**DAF-000** is substrate-independent: participants and units, how a federative point is earned, how points become voting weight, quorum and majority, how a resource request is judged against the last-resort rule, penalties and exit.

**DAF-001** is the initial version, the MVP, running on this repository, with no chain and no token. It also states what is deliberately deferred to later phases, so that the small thing running now is not confused with the whole design.

Both are drafts of the same consolidation, and both leave things open on purpose. What neither settles is listed in [DAF-000 §9](./daf-000-federation-constitution.md#9-what-this-document-does-not-settle).

## Proposing a change

Open an issue, argue it in the thread, then send a pull request to `master`. The same path applies to a new numbered proposal and to a correction of an existing one. A number is assigned when the draft is opened as a pull request.

A change to these documents is itself subject to them once the federation is running.
