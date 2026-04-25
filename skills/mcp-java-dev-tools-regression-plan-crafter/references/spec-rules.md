# Regression Plan Spec Rules

This file defines the normative rules used by the craft skill.

## Package Layout

```text
.mcpjvm/regression/<regression_name>/
  metadata.json
  contract.json
  plan.md
  runs/<run_id>/
```

`runs/<run_id>/...` is machine-generated and out of scope for crafting.

## metadata.json (required)

- `specVersion`: string
- `execution.intent`: must be `regression`
- `execution.verifyRuntime`: boolean
- `execution.pinStrictProbeKey`: boolean
- `execution.discoveryPolicy`: `disabled` | `allow_discoverable_prerequisites`

When `verifyRuntime=true` and `pinStrictProbeKey=true`, every target must provide a strict probe key.

## contract.json (required)

### targets[]

- `type`: `class_method` | `class_scope` | `module_scope`
- `selectors.fqcn`: required
- `selectors.method`: optional
- `selectors.signature`: optional
- `selectors.sourceRoot`: optional
- `runtimeVerification.strictProbeKey`: optional unless runtime pinning is enabled

### prerequisites[]

- `key`: required
- `required`: required
- `secret`: required
- `provisioning`: required (`user_input` | `discoverable`)
- `discoverySource`: required when `provisioning=discoverable` (`datasource` | `runtime_context`)
- `default`: optional for non-secrets only

### steps[]

- `order`: required, unique, strictly sequential `1..N`
- `id`: required, stable
- `targetRef`: required, valid index into `targets[]`
- `protocol`: required
- `transport`: required; must contain key that exactly matches `protocol`
- `extract`: optional

### expectations[]

- deterministic assertions such as `outcome_status`, `http_status`, `probe_hit`

## plan.md (required)

Required sections:

1. `Purpose`
2. `Targets`
3. `Prerequisites`
4. `Steps`
5. `Expected Outcomes`

Allowed action verbs in `Steps`:

- `Executes`
- `Captures`
- `Uses`
- `Sets`
- `WaitsFor`
- `Verifies`

Allowed outcome verbs:

- `Returns`
- `Emits`
- `Produces`
- `Matches`
- `Passes`
