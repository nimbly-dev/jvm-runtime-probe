# Regression Execution Plan

This document describes the structure and design of a reusable regression plan package.

## Package Layout

Each regression plan lives under:

```text
.mcpjvm/regression/<regression_name>/
```

| File / Folder | Purpose |
|---|---|
| `metadata.json` | Plan-level execution settings |
| `contract.json` | Authoritative machine contract |
| `plan.md` | Human-readable execution plan |
| `runs/<run_id>/...` | Immutable outputs for each run (plan-local run history) |
| `artifact-schema.md` | Normative run artifact contract (`MUST/SHOULD/MAY`) |


## Design Principles

A few intentional constraints that apply across all regression plans:

- **Deterministic selectors and execution order** — no ambiguity in what runs or when
- **Protocol-agnostic** — not limited to HTTP
- **Fail-closed** — ambiguous or incomplete required context stops execution rather than guessing
- **No hardcoded secrets** — credentials must never appear in plan artifacts

## Writing `plan.md`

Plans use a fixed vocabulary to keep steps unambiguous and machine-parseable.

**Step verbs:**

| Verb | Use for |
|---|---|
| `Executes` | Triggering an action |
| `Captures` | Recording output |
| `Uses` | Referencing an input or dependency |
| `Sets` | Assigning a value |
| `WaitsFor` | Blocking until a condition is met |
| `Verifies` | Asserting an expected state |

**Outcome verbs:**

| Verb | Use for |
|---|---|
| `Returns` | Expected response |
| `Emits` | Expected event or signal |
| `Produces` | Expected artifact or output |
| `Matches` | Comparison against a reference |
| `Passes` | Assertion success |

## Execution Order

Steps are numbered `1..N` and executed strictly in listed order. The orchestrator does not reorder steps implicitly — what you write is what runs.
Run artifacts are persisted under the plan package:

```text
.mcpjvm/regression/<regression_name>/runs/<run_id>/
```

## Artifact-Derived Results Summary

Regression results summaries SHOULD be rendered from persisted artifacts, not transient logs.

Required tabular columns:

- `Endpoint`
- `Status`
- `HTTP Code`
- `Duration (ms)`
- `Probe Coverage`

`Probe Coverage` enum values:

- `verified_line_hit` (strict line key confirmed)
- `http_only_unverified_line` (HTTP-level validation only)
- `unknown` (coverage state not deterministically available)

`Memory (bytes)` MUST be included only when memory metrics are explicitly contract-defined.
