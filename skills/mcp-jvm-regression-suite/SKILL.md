---
name: mcp-jvm-regression-suite
description: "Run MCP-first HTTP regression suites across controller, service, or whole API scope with optional strict probe verification per endpoint."
---

# MCP JVM Regression Suite

Use this workflow for regression runs at controller scope, service scope, or whole API scope.

## Scope Modes

1. `controller` (endpoints mapped to one controller)
2. `service` (endpoints for one service/runtime)
3. `api` (whole API surface for a runtime)

## MCP-First Requirement

1. Mandatory tools: `project_context_validate`, `probe_recipe_create` (per endpoint or representative target), plus probe tools when probe verification is requested/available.
2. If MCP toolchain is unavailable, stop immediately and return:
   - `reasonCode=toolchain_unavailable`
   - `nextAction=enable_mcp_jvm_debugger_tools_then_rerun`
3. Never fallback to direct `curl`/raw HTTP-only execution.

## Probe Policy

1. Probe verification is optional per endpoint.
2. Run probe checks only when strict line target is available/provided.
3. Never claim line success without strict `Class#method:line` verification.

## Recipe Synthesis Policy

1. Treat `probe_recipe_create` as deterministic and fail-closed.
2. For `probe_recipe_create`, pass controller/service class as exact FQCN in `classHint`.
3. Runtime synthesis scope is runtime-only (`src/main/java` + generated-main roots); test sources are excluded.
4. Pass `apiBasePath` when runtime uses a context path (for example `/api/v1`).
5. Prompt for context path at most once per run, then reuse the same `apiBasePath` value for all endpoints in that run.
6. If `probe_recipe_create` returns `resultType=report`, stop endpoint execution for that route unless report indicates only missing user input.
7. In report mode, prefer compact execution metadata:
   - `executionPlan.routingReason` (code)
   - `executionPlan.steps[].actionCode` (code)
   - avoid depending on verbose instruction text.
8. Route only by deterministic contract fields (`resultType`, `status`, `reasonCode`, `failedStep`).
9. Never use confidence/heuristic scoring for routing decisions.
10. Probe tool outputs use compact text summaries; treat `structuredContent` as canonical for full payload details.
11. Capture and propagate synthesis diagnostics for every fail-closed report:
   - `reasonCode`
   - `failedStep`
   - `evidence`
   - `attemptedStrategies`
   - `synthesizerUsed`
12. Prefer runtime-provided `capturePreview.executionPaths` / `probe_get_capture.capture.executionPaths` as call-path evidence when present; avoid heuristic reconstruction.

## Route Resolution (Probe-Capable Endpoints)

1. Resolve route dynamically from runtime candidates.
2. Validate candidates with:
   - probe reachability
   - API reachability
   - strict target alignment (`Class#method:line` resolvability or class-scoped line discovery)
3. Continue only when exactly one candidate is valid.
4. Otherwise stop with structured pushback:
   - `probe_route_not_found`
   - `probe_route_ambiguous`
   - include `attemptedCandidates`, `validationResults`, `nextAction`, and `Repro Steps`.
5. If blocked before route validation due to synthesis report, emit synthesis pushback with:
   - `reasonCode`
   - `failedStep`
   - `synthesizerUsed`
   - `attemptedStrategies`
   - `evidence`
   - `nextAction`
   - `Repro Steps`

## Required Human Run Summary

Always include:

1. `Scope` (`controller` | `service` | `api`)
2. `Routing Outcome`
3. `Endpoint Results` (method/path/http code)
4. `Probe Coverage` (which endpoints were probe-verified vs HTTP-only)
5. `Probe Verification`
6. `Run Timing`:
   - `runStartEpochMs` (Unix epoch in milliseconds)
   - `runEndEpochMs` (Unix epoch in milliseconds)
   - `runDurationMs` (`runEndEpochMs - runStartEpochMs`)
   - optional human-readable UTC timestamps for operator readability
7. `Synthesis Diagnostics` (aggregate reason/failure fields for blocked endpoints)
8. `Runtime Evidence` (`capturePreview.executionPaths` and `probe_get_capture.capture.executionPaths` when available)
9. `Repro Steps` (ordered, executable, numbered, per-recipe)
10. `Cleanup`
11. `Trust Note`

## Repro Steps Format

When writing `Repro Steps`, prioritize human actions over MCP internals:

1. Start with the exact HTTP request(s) to send (method, URL, query/body, required headers).
2. Include expected observable outcomes per step (HTTP code and key response checks).
3. Keep steps directly runnable by a developer with curl/Postman/browser.
4. Do not list MCP tool calls as the primary repro path.
5. If needed, add a separate optional section named `Toolchain Steps` for MCP diagnostics.

## Repro Steps Template (Per Recipe)

Use this exact structure per recipe/endpoint when reporting execution movement:

Recipe `<short-name-or-index>`

1. Execute controller with this request:
   - Method: `<HTTP_METHOD>`
   - URL: `<BASE_URL><PATH>`
   - Path Params: `<none | key=value, ...>`
   - Query Params: `<none | key=value, ...>`
   - Headers: `<none required | header list>`
   - Body: `<none | JSON payload>`

2. Execution reaches method:
   - `<FQCN#controllerMethod>`

3. Execution reaches method:
   - `<FQCN#downstreamMethod>`

4. Encounter this line:
   - `<FQCN#method:line>`
   - Branch/Condition: `<condition text>`
   - Probe Verification: `<hit=true|false, inline=true|false, lineValidation=...>`

When multiple endpoints are tested, create separate recipe blocks and repeat steps 1-4 inside each block.

