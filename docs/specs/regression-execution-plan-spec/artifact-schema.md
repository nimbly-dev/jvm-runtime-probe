# Artifact Schema (Normative)

This document is normative for run artifacts written under:

```text
.mcpjvm/regression/<regression_name>/runs/<run_id>/
```

Terms:

- `MUST`: required behavior
- `SHOULD`: recommended behavior
- `MAY`: optional behavior

## File Set

Each run folder MUST contain:

- `context.resolved.json`
- `execution.result.json`
- `evidence.json`

## Run ID

`<run_id>` MUST use sortable timestamp format:

```text
YYYY-MM-DDTHH-mm-ssZ_<seq>
```

Example:

```text
2026-04-17T09-42-11Z_01
```

## context.resolved.json

Purpose: resolved non-secret context used in this run.

Required fields:

- `resolvedAt` (ISO-8601 string)

Rules:

- non-secret resolved values MAY be persisted (for example `tenantId`, `postId`)
- secret values MUST NOT be persisted
- auth metadata MAY be persisted as presence-only:
  - `auth.scheme`
  - `auth.provided`

## execution.result.json

Purpose: canonical run outcome and preflight gate state.

Required top-level fields:

- `status`
- `preflight`
- `startedAt`
- `endedAt`
- `steps`

Allowed `status` values:

- `pass`
- `fail`
- `blocked`

Required `preflight` fields:

- `status`
- `reasonCode`
- `requiredUserAction`

Allowed `preflight.status` values:

- `ready`
- `needs_user_input`
- `stale_plan`
- `blocked_ambiguous`
- `blocked_invalid`

Rules:

- replay execution MUST NOT start unless `preflight.status = ready`
- blocked runs MUST set `startedAt = null` and `endedAt = null`
- `steps` MUST be an array (empty when blocked before execution)

## evidence.json

Purpose: enough evidence to diagnose run outcome without replay.

Required fields:

- `targetResolution` (array)

Recommended fields:

- `resolvedRecipe` (protocol/transport shape actually executed)
- `authMode` (scheme + provided/redacted state only)
- `probe` (when runtime verification enabled)

Rules:

- `targetResolution` entries SHOULD include selector details used at execution time:
  - `fqcn`
  - `method` (if method-scoped)
  - `signature` (if overload-scoped)
  - `sourceRoot` (if used for disambiguation)
- probe evidence MUST NOT include secrets

## Redaction Rules

- bearer tokens, passwords, API keys, and secret headers MUST NOT be written
- if needed, persist secret presence only (`provided=true/false`)
- examples and real writers MUST follow same redaction policy

## Write Order

Writers MUST persist artifacts in this order:

1. `context.resolved.json`
2. `execution.result.json`
3. `evidence.json`

If a write fails, writer MUST fail closed and MUST NOT mark run as complete.

## Compatibility

- artifact reader/writer MUST be compatible with `metadata.json.specVersion`
- unknown additional fields MAY be ignored by readers
- missing required fields MUST fail validation

