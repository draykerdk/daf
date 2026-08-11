# The federation record

This directory is the federation. Not a description of it — the record itself, as specified in [DAF-001](../dafp/daf-001-phase-0-github-federation.md).

Everything here is plain text under version control, so that any claim about who delivered what, who holds how many points, and what was decided can be checked by reading, and disputed with evidence.

```text
units/         one record per participant or unit
assemblies/    one report per cycle — the decisions, the awards, the tally
requests/      resource requests under evaluation
LEDGER.md      current standing, generated from the assemblies
```

## How to read it

**The assemblies are the source of truth.** Each one records what was delivered in a cycle, which points were awarded and removed and for which specific delivery, which requests were decided, and how the vote fell. They are append-only in practice: a mistake in a past assembly is corrected by a later one that says what was wrong, not by editing the original.

**`LEDGER.md` is a convenience.** It is the sum of the assemblies. If it ever disagrees with them, the assemblies are right and the ledger is a bug.

**A unit record says what a unit is, not how it works.** Its id, its founding function, who can speak for it, where its work is. Internal governance, member identities and finances are the unit's own business and do not belong here.

## How to add to it

Nothing in this directory is edited directly on `master`. Every change arrives as a pull request:

- **Joining** — add your record to `units/`, from [`units/TEMPLATE.yml`](./units/TEMPLATE.yml), in the same pull request that claims your first delivered function.
- **Requesting resources** — add a file to `requests/`, from [`requests/TEMPLATE.md`](./requests/TEMPLATE.md). Read [DAF-000 §6](../dafp/daf-000-federation-constitution.md#6-resources) first: a request that does not say what was tried before it is returned without being judged.
- **Running an assembly** — open the cycle as an issue, then the report as a pull request, from [`assemblies/TEMPLATE.md`](./assemblies/TEMPLATE.md). The procedure is [DAF-001 §4](../dafp/daf-001-phase-0-github-federation.md#4-the-cycle).

## State

Empty. No unit is recorded and no assembly has been held.

The structure exists so that the first delivery has somewhere to be written down. The federation starts at the first assembly that records real work — not at the commit that created these folders.
