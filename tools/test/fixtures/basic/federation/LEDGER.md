# Ledger

Current standing, summed from the assemblies in [`assemblies/`](./assemblies). Those are the source of truth. If this file disagrees with them, this file is wrong.

**As of:** assembly 2026-03.

| Holder | Kind | Points | Active | Joined |
| --- | --- | --- | --- | --- |
| `example-delta` | unit | 4 | yes | 2026-01 |
| `example-cedar` | participant | 1 | yes | 2026-02 |
| `example-river` | participant | 1 | yes | 2026-01 |

| | |
| --- | --- |
| Units and participants | 3 |
| Points issued | 6 |
| Active points (quorum denominator) | 6 |
| Assemblies held | 3 |

## Reading this

**Points** are delivered functions and completed modules, never bought and never transferred. They do not decay ([DAF-000 §3.3](../dafp/daf-000-federation-constitution.md#33-decay-and-dilution)). A share falls only because other people deliver.

**Active** means the holder voted or delivered in one of the last three assemblies. Dormant holders keep every point and leave the quorum denominator, so an abandoned unit cannot freeze the federation ([DAF-000 §3.4](../dafp/daf-000-federation-constitution.md#34-points-and-voting-weight)). Voting or delivering makes a holder active again, with no readmission procedure.

**Weight in a vote** comes from this ledger as it stood at the *previous* assembly, so the awards under vote cannot change the votes that approve them.

## State

3 assemblies held. The assemblies in [`assemblies/`](./assemblies) are the record; this file is generated from them by `node tools/daf.js ledger --write`.
