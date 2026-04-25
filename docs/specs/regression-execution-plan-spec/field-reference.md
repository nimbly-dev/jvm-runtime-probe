# Field Reference

## Package layout

```text
.mcpjvm/
  regression/
    <regression_name>/
      metadata.json
      contract.json
      plan.md
  runs/
    <run_id>/
      context.resolved.json
      execution.result.json
      evidence.json
```

## `metadata.json`

Required fields:

- `specVersion` (string): spec compatibility marker
- `execution.intent` (string): execution intent. Current value: `regression`
- `execution.verifyRuntime` (boolean): whether runtime probe verification is required
- `execution.pinStrictProbeKey` (boolean): whether strict probe key must be explicitly pinned
- `execution.discoveryPolicy` (string): prerequisite discovery policy (`disabled` or `allow_discoverable_prerequisites`)

Notes:

- `verifyRuntime=false`: no runtime probe verification
- `verifyRuntime=true` and `pinStrictProbeKey=false`: strict probe key is auto-resolved
- `verifyRuntime=true` and `pinStrictProbeKey=true`: strict probe key must be provided by plan contract

## `contract.json`

### `targets[]`

- `type` (string): `class_method`, `class_scope`, or `module_scope`
- `selectors.fqcn` (string): primary deterministic selector
- `selectors.method` (string, optional): required for method-targeted execution
- `selectors.signature` (string, optional): required only for overload disambiguation
- `selectors.sourceRoot` (string, optional): source-root disambiguation in multi-module workspaces
- `runtimeVerification.strictProbeKey` (string, optional): explicit `FQCN#method:line` pin used only when `pinStrictProbeKey=true`

### `prerequisites[]`

- `key` (string): context key required by one or more steps
- `required` (boolean)
- `secret` (boolean)
- `provisioning` (string): `user_input` or `discoverable`
- `discoverySource` (string, required for `provisioning=discoverable`): `datasource` or `runtime_context`
- `default` (string/number/boolean/object, optional): default value used only when runtime input is absent; do not use for secrets

Deterministic resolution status values:

- `provided`
- `default_applied`
- `discoverable_pending`
- `needs_user_input`

### `steps[]`

- `order` (number): strict execution order (`1..N`)
- `id` (string): stable step identifier
- `targetRef` (number): zero-based index into `targets[]`
- `protocol` (string): protocol classification (`http`, `grpc`, `kafka`, `custom`, etc.)
- `transport` (object, required): protocol-specific execution details under `transport.<protocol>`
- `extract` (array, optional): extraction mapping from output into run context

Validation rule:

- `protocol` must map to exactly one key in `transport` with the same value (for example `protocol=http` requires `transport.http`).
- mismatched or missing transport key fails closed.

`extract` semantics:

- `extract[].from`: output path to read from current step result
- `extract[].as`: context key to store for subsequent steps

### `expectations[]`

- `stepOrder` (number, optional): scoped assertion for a specific step
- `type` (string): assertion type (for example `http_status`, `probe_hit`, `outcome_status`)
- assertion fields such as `equals`, `min`, `matches` depending on `type`

## `plan.md`

Human-readable deterministic plan.

Expected sections:

- `Purpose`
- `Targets`
- `Prerequisites`
- `Steps`
- `Expected Outcomes`

Expected style:

- numbered steps
- allowed action verbs only
- concise, deterministic statements

## `.mcpjvm/runs/<run_id>/context.resolved.json`

Resolved run-time context for a specific run.

Examples:

- extracted IDs (`postId`)
- resolved non-secret keys (`tenantId`)
- metadata timestamps

## `.mcpjvm/runs/<run_id>/execution.result.json`

Canonical run result for a specific run.

Expected fields:

- `status`
- `startedAt`, `endedAt`
- `preflight` block
- per-step result list
- failure reason when applicable

## `.mcpjvm/runs/<run_id>/evidence.json`

Supporting evidence for result interpretation.

Examples:

- resolved target selectors
- probe verification details
- diagnostics summary

