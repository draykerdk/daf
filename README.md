DAF is the alliance basis between Drayker's DAOs and DACs. The organizational and governance layer of the ecosystem, and the reason Drayker has no head office.

## Why this exists

Drayker is a way of working where people keep creating, discovering and learning while intelligence carries the rest, and what results reaches the work that produced it. DAF is the organizational half of that: how decisions and resources move when there is no head office to move them.

The argument in full is on the [manifesto](https://drayker.org/manifesto/). The [economy page](https://drayker.org/economy/) states plainly what contributing here earns and what it does not.

## How a unit joins

Anyone, a person, a team, a project or an initiative, can link their own unit to the federation. Over time, units accumulate **federative points** and voting power over federation resources and federation decisions.

The federation's shared interface and public record are maintained in English so every assembly has one auditable reference. A unit may organize around a particular language, region or nationality, and may work internally in that language. It only needs to submit its unit record, claims, requests and assembly evidence to the federation in English. Language or nationality never changes how points are earned or how a vote is weighted.

Weight follows delivered work. It is not appointed, and it cannot be bought. A point records one delivered [function](https://dfmp.drayker.org), it is non-transferable, and it does not decay. Influence moves only as other people deliver.

The mechanics are specified in [DAF-000](./dafp/daf-000-federation-constitution.md).

## How resources work

The initial DAO is funded by grants and side projects. **All support requests must be made in situations where there are no other alternatives**. Resource efficiency matters here, and the major projects are the priority.

That rule is published on purpose. A federation that treats its shared resources as a first resort stops being able to fund anything that matters.

It is also enforceable rather than decorative: a request that does not say what was tried first is returned unjudged, and funding is granted one function at a time, each grant evaluated against the evidence of the last.

## How it fits the whole

DAF is where the ecosystem's autonomous units cooperate without being absorbed into one organization: [projects](https://dfmpproject.drayker.org), [councils](https://advices.drayker.org), initiatives and the [volunteers portal](https://drayker.org) all connect through it, while keeping their own scope and their own decisions.

It sits above the same layers everything else does. Contribution is attributable through [UID](https://uid.drayker.org) — federative points record delivered work, and identity is what makes a point non-transferable. The [value unit](https://value.drayker.org) overlaps the federative points, and the funds of the [economy](https://drayker.org/economy/) feed the resources the federation governs. Councils validate what enters; the federation decides how shared resources are held. Drayker has no head office, and DAF is the reason: a federation of autonomous units can outgrow whoever started it without anyone owning it.

## The specification

[`dafp/`](./dafp) holds the proposals that specify the federation.

- **[DAF-000](./dafp/daf-000-federation-constitution.md)**. The minimal constitution, independent of any platform: participants and units, how a point is earned, how points become voting weight, quorum and majority, how a resource request is judged, penalties and exit.
- **[DAF-001](./dafp/daf-001-phase-0-github-federation.md)**. Phase 0, the initial version: the federation designed to run on this repository, with no chain and no token, and an explicit account of what is deferred to later phases.

The record itself lives in [`federation/`](./federation): unit records, assembly reports, resource requests and the ledger, in plain text under version control, so that any claim about who delivered what can be checked by reading.

## State of this documentation

The point mechanics and the voting procedure are now specified, as drafts open to argument, and the structure that would hold the record exists. **Nothing is running in it**: no unit is recorded, no points have been issued, no assembly has been held, and there is no deployed contract. Phase 0 begins at the first assembly that records a real delivery, not at the commit that created the folders.

Several things are still unspecified on purpose. The substrate beyond Phase 0 is decided — **ICP** (Internet Computer Protocol) — but the transferable instrument the earlier drafts describe, the authority of councils, and how federative points convert into [`uid`](https://uid.drayker.org) reputation remain open. They are listed in [DAF-000 §9](./dafp/daf-000-federation-constitution.md#9-what-this-document-does-not-settle). Anyone can write them.

## Contributing

Open an issue. Issues small enough for one person to finish carry the `open-function` label and appear on the board at [drayker.org](https://drayker.org/fn/).

Run `node tools/render-check.js` before opening a site change. It exercises the empty, snapshot, malformed-snapshot and offline states without sending any external action.

Related: [`dfmp`](https://dfmp.drayker.org) (how proposals are validated) · [`uid`](https://uid.drayker.org) (identity and contribution) · [`advices`](https://advices.drayker.org) (councils)

---

Drayker is a volunteer, non-profit organization. Content licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
