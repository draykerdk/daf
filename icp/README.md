# ICP preparation

**Nothing in this folder is deployed, and nothing in DAF depends on it.** No canister has been created, no cycles have been spent, and no part of the federation runs on the Internet Computer.

## What this is

[DAF-001 §7](../dafp/daf-001-phase-0-github-federation.md#7-when-phase-0-stops-being-enough) names ICP as the probable provisional substrate for a later DAF phase that experiments with units of account. It is not a deployment, a date, a final dependency or a destination. The conditions in §7 decide whether that phase is needed at all, and DAF itself is expected to dissolve into [PAP](https://pap.drayker.org) as PAP matures.

This folder prepares for that possibility. It contains a Motoko reading of the canonical event log v1 ([DAF-002 §6](../dafp/daf-002-phase-0-instruments.md), `tools/lib/events.js`), and its tests show that the event log v1 can be reproduced byte for byte in Motoko: the same preimages, hashes and head as the JavaScript reference, and the same standing per holder. It commits the federation to nothing.

| File | What it is |
| --- | --- |
| `src/Sha256.mo` | SHA-256 over bytes, pure. |
| `src/Event.mo` | The event type, its preimage text, its hash, the shape checks and the chain rule. |
| `src/Ledger.mo` | The standing of each holder, folded event by event, with the same rules as `foldEvents`; it does not compute the reference's totals. |
| `src/main.mo` | A canister that would hold the log: wiring only. |
| `federation.did`, `federation.most` | The canister's Candid interface and stable signature, generated and checked by the tests. |
| `test/` | The vectors derived from the reference and the tests that run against them. |

Run the checks with `cd icp && npm ci && npm test`. The same runs in `.github/workflows/icp-check.yml`.

## What would move

- **The event log v1**, every event with its fields and hash. A canister would not take the hashes on trust: it recomputes each preimage and hash, checks `seq` and `prev`, and rejects a whole batch at the first error.
- **The certified head.** The canister certifies the 32 bytes of the head, the hash of the last event, after each batch and again after an upgrade. It also certifies it at install, so the head of the empty log (64 zeros, 32 zero bytes) is certified before any event is appended.

Nothing else. The standing (`ledger()`) is a convenience recomputed from the events; it is not certified and adds no information the events do not carry. It is not stored either: the only stable data is the event list, its count, the head and a reserved appender field, and the standing is folded again from the events at install and after an upgrade.

`ledger()` returns, for each holder, the fields `id`, `kind`, `points`, `joined` and `active`, sorted as the reference sorts them. `kind` is the value of the holder's latest `unit.recorded` and `joined` its cycle; both are empty texts for a holder that appears in the log without a `unit.recorded`, where the reference gives `null`. The totals that the reference also computes (holders, points, active points, assemblies) and its `asOf` are not returned.

Like the reference, the canister folds every event it accepts: a delivery, module bonus or penalty for a holder with no earlier `unit.recorded` lists that holder, and a vote alone lists no one but counts as activity if the holder is listed later. Only the shape and chain checks reject a batch.

## What does not move

- **No transferable instrument, no currency, no treasury.** The log records points, which are federative standing; the canister holds no balance and moves no value.
- **No veto records.** The kinds accepted are exactly the eight of v1. Veto records are never ingested by this canister: the UID specification says the veto chain is "carried by the Drayker architecture rather than by an external token network", and DAF-002 §6.3 says the log does not carry vetoes.
- **No identity.** UID is specified separately ([uid.drayker.org](https://uid.drayker.org)). Holders appear in the log by their unit id only. Internet Identity gives a person a different principal for each frontend origin, so any later mapping from principals to holders must allow several principals per holder. That mapping is not decided here.

## How a client verifies

1. Call `head()`. It returns `seq`, `head` and a certificate.
2. Check the certificate against the Internet Computer root key, and check that its `certified_data` for this canister equals the 32 bytes of `head`.
3. Fetch the events with `events(from, limit)` (at most 100 per call), recompute every preimage and hash from genesis (64 zeros), and confirm that the last hash equals the certified `head`. For a canister with no events, `seq` is 0 and the certified `head` is the genesis value itself.
4. If the standing matters, fold the replayed events, or run `node tools/daf.js` on the repository at the matching commit, and compare the per-holder fields with `ledger()`; the totals have to be computed on the client side.

A head computed from the repository and a head certified by a canister either match or they do not; the log needs nothing more to be checked.

## The later pull path

This preparation has no HTTPS outcalls. If the phase is ever started, the expected path is:

- a canister timer fetches the log for a fixed commit SHA from `raw.githubusercontent.com` by a replicated HTTPS outcall;
- a transform function strips the response headers so that every replica agrees on the response;
- responses are capped at 2,000,000 bytes, so a log larger than that is fetched in pages, one assembly at a time;
- the canister holds no GitHub credential of any kind; the repository is public and read anonymously.

One gap is already known: today the log is published with the site as `data/events.log` (DAF-002 §6) and is not committed to the repository, so there is no file at a commit SHA to fetch. Either the log is committed, or the canister derives it some other way. That is left open.

## Toolchain

- **Target.** DFINITY's current command line is icp-cli (`icp`, project file `icp.yaml`; v1.6.0 on 2026-09-25). dfx is being deprecated. Neither is used here, and no `icp.yaml` exists, because nothing is deployed.
- **What CI uses.** The tests compile and interpret with the Motoko compiler bundled in the npm package `motoko` 5.0.0 (node-motoko) and its `core` library 2.6.2. `mops.toml` pins the same `core`. This is not necessarily the compiler that would deploy, so a deploy must rerun the vectors under the deploying toolchain first.
- **What is not run.** The canister's wasm (wasm64, enhanced orthogonal persistence) is compiled and its Candid and stable signature are checked, but it is not executed in CI. The interpreter cannot run `CertifiedData.set`, so the tests exercise the pure modules (`Sha256`, `Event`, `Ledger`), including the batch rule the canister uses.
- **Before any mainnet use**, a PocketIC run measures instructions per event and per 500-event batch, and checks `append`, the paging of `events` and the certificate end to end.
- **Accepted compiler warnings**, listed in `test/run.mjs`: `postupgrade` is marked deprecated in favour of migration functions (the hook refolds the standing and re-sets the certified data after an upgrade, as the actor body does at install), and `appender` is unused (reserved for a later, narrower appender than the controllers).

## Cost notes

Snapshots that will drift. Source: Internet Computer documentation, "Cycles costs" (docs.internetcomputer.org/building-apps/essentials/gas-cost), read on 2026-10-08.

| Item | Figure |
| --- | --- |
| Creating a canister (13-node subnet) | about 500 billion cycles |
| Starting balance commonly suggested | 1 to 2 trillion cycles (not stated on the page above) |
| Storage (13-node subnet) | about 329 billion cycles per GiB per month |
| Exchange | 1 trillion cycles = 1 XDR |
| HTTPS outcall response cap (default) | 2,000,000 bytes |

The log is small: events in the test fixtures average about 300 bytes of preimage each.

## Open questions

- **Which phase may use ICP.** [GOVERNANCE §1](https://github.com/draykerdk/.github/blob/master/GOVERNANCE.md) says "The initial phase of the DAF may use an external substrate such as ICP provisionally, to experiment with units of account", while [DAF-001 §2 and §7](../dafp/daf-001-phase-0-github-federation.md#2-phase-map) place ICP in a later phase, after Phase 0 on GitHub. Which reading holds is open.
- **Whether ICP may ever anchor veto entries.** This preparation assumes it may not, and rejects any kind outside the eight of v1.
- **Points at dissolution.** DAF-000 §9 says federative points are to be frozen and archived as historical evidence at the transition into PAP, and leaves the dissolution protocol unspecified. The log preserves attribution, so the archive can be built from it, and so could any later recomputation the federation decides on.
- **The dormancy parameter.** The canister builds in `dormant_after_assemblies = 3` from `federation/parameters.yml`. The log does not carry parameters, so a change of that value would need a new build or a way to carry parameters, which is not specified.
- **Where the canister reads the log from**, given that `data/events.log` is not committed (see above).
