# How It Works

This document provides an overview and guide on how to use the mcp-jvm-probe tool

## Run Preconditions

- Java agent is attached to the target service and probe endpoints are reachable.
- `MCP_PROBE_BASE_URL` points to the sidecar/probe endpoint.
- If a request requires certain credentials, provide it on the prompt
- Strict line probe runs use `Class#method:line` semantics.

To know if the java agent is instrumenting your java classes, on startup you can see this logs:

```txt
[mcp-probe]: com.yourpackagename.yourclassname
```

## Use Case 1: Reproducible Recipe for Class/Method/Line Probe (Bearer Auth)

### Input Pattern

- Repo: `{repo-name}`
- Target: `{fullyQualifiedClassName}.{method}:{lineOfCode}`
- Auth: `Bearer <token>`

### Example Prompt

```txt
Create a reproducible single-line probe recipe for `{repo-name}`.
Target line: `com.acme.catalog.service.PriceService.finalPriceLte:128`.
Use bearer auth: `Bearer eyJhbGciOi...`.
Return the exact request plan and probe verification steps.
```

### Expected Runtime Flow 

1. `project_list` discovers projects and selects the target project root.
2. `probe_recipe_create` is called with `intentMode=single_line_probe`, class/method/line hints, and bearer auth context.
3. `probe_recipe_create` performs route inference from project hints/OpenAPI hints and returns `executionReadiness`, `requestCandidates`, `inferredTarget`, and `selectedMode`.
4. If route/target cannot be proven uniquely, the run stops with pushback (`probe_route_not_found` or `probe_route_ambiguous`) and returns candidate validation evidence.
5. On ready state, `probe_reset` clears baseline counter/state for the strict line key.
6. The orchestrator executes the selected HTTP trigger request from the recipe using the bearer token.
7. `probe_wait_for_hit` confirms inline line execution; if unavailable, fallback check can use `probe_get_status` for detailed status payload.
8. When `capturePreview.captureId` is present, `probe_get_capture` retrieves full runtime capture payload for arguments/context evidence.

### Expected Outputs and Artifacts

- Reproducible recipe artifact:
  - selected mode
  - selected HTTP request (method/path/headers/body template)
  - strict probe key (`Class#method:line`)
- Probe verification artifact:
  - hit/no-hit result, inline status, last status snapshot
- Runtime evidence artifact (when available):
  - `captureId` and full capture payload
- Pushback artifact (fail-closed cases):
  - `reasonCode`, `attemptedCandidates`, `validationResults`, `nextAction`, ordered repro steps

## Use Case 2: Regression HTTP Test Execution for a Controller in `{repo-name}-api` (Bearer Auth)

### Input Pattern

- Repo/API scope: `{repo-name}-api`
- Controller: `{fullyQualifiedClassNameOfController}`
- Auth: `Bearer <token>`

### Example Prompt

```txt
Run controller regression for `catalog-api`.
Controller: `com.acme.catalog.api.ProductController`.
Use bearer auth `Bearer eyJhbGciOi...`.
Return endpoint-level HTTP results and any probe-verifiable evidence.
```

### Expected Runtime Flow 

1. `project_list` resolves the API project and runtime scope.
2. For each route under the controller scope, `probe_recipe_create` is called to produce executable request candidates and auth/readiness diagnostics.
3. The orchestrator executes regression HTTP requests route-by-route with bearer auth and records request/response outcomes.
4. Probe verification is applied only when strict line targets are available for an endpoint.
5. For probe-eligible endpoints, `probe_reset` -> execute HTTP request -> `probe_wait_for_hit` (or `probe_get_status`) verifies runtime line execution.
6. Any probe capture preview discovered during status checks can be expanded through `probe_get_capture`.
7. Endpoints without strict line mapping remain HTTP-only and must be marked explicitly as non-probe-verified.

### Expected Outputs and Artifacts

- Regression result artifact:
  - endpoint matrix (`method`, `path`, expected/actual HTTP code, pass/fail)
- Coverage artifact:
  - probe-verified endpoints vs HTTP-only endpoints
- Evidence artifact:
  - per-endpoint probe status and optional capture payload reference
- Failure artifact:
  - failed endpoint diagnostics with deterministic repro steps

## Use Case 3: Regression HTTP Execution + Repro Recipe for Failed/Flagged Runs

### Input Pattern

- Same as Use Case 2, plus requirement to generate per-failure reproducible recipes.

### Example Prompt

```txt
Run controller regression for `catalog-api` on
`com.acme.catalog.api.ProductController` with bearer auth `Bearer eyJhbGciOi...`.
For every failed or flagged run, generate a reproducible recipe and include runtime/probe evidence when available.
```

### Expected Runtime Flow

1. Execute Use Case 2 regression flow to completion and collect full endpoint outcomes.
2. Filter endpoints into `failed` or `flagged` sets (for example non-2xx/contract mismatch/probe-miss).
3. For each failed/flagged endpoint, call `probe_recipe_create` to emit a focused rerun recipe tied to the observed failure context.
4. If strict line verification is possible for that endpoint, run `probe_reset` + targeted HTTP rerun + `probe_wait_for_hit`/`probe_get_status`.
5. If capture preview exists, call `probe_get_capture` and attach capture evidence to that endpoint�s recipe package.
6. If runtime route cannot be uniquely validated during rerun, emit fail-closed pushback artifact instead of speculative guidance.

### Expected Outputs and Artifacts

- Primary regression artifact:
  - full controller endpoint pass/fail report
- Per-failure recipe bundle:
  - endpoint-specific trigger request, auth header requirements, strict probe target when available, and rerun steps
- Evidence bundle per failed/flagged endpoint:
  - probe hit/miss status, last status payload, optional capture payload
- Pushback bundle (when unresolved):
  - `probe_route_not_found` or `probe_route_ambiguous` with candidate validation details

## Important Notes

- Do not claim probe success without strict `Class#method:line` verification or check on your IDE if the execution paused.
- Provide the Coding Agent tool all the needed information to execute the request, although there are some pushbacks and guardrails coded to the tool and SKILL for this, to save context tokens. It is imperative to add details that cannot be inferred to the prompt such as Auth Bearer
- Data synthetisation will be handled by the Coding agent Tool.
