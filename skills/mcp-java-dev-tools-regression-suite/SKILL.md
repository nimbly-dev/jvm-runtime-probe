---
name: mcp-java-dev-tools-regression-suite
description: "Run MCP-first HTTP regression suites across controller, service, or whole API scope with optional strict probe verification per endpoint."
---

# MCP JVM Regression Suite

Use this workflow for regression runs at controller scope, service scope, or whole API scope.

## Scope Modes

1. `controller` (endpoints mapped to one controller)
2. `service` (endpoints for one service/runtime)
3. `api` (whole API surface for a runtime)

## MCP-First Requirement

1. Mandatory tools: `probe_check`, `project_context_validate`, `probe_recipe_create` (per endpoint or representative target), plus probe tools when probe verification is requested/available.
2. If MCP toolchain is unavailable, stop immediately and return:
   - `reasonCode=toolchain_unavailable`
   - `nextAction=enable_mcp_jvm_debugger_tools_then_rerun`
3. Never fallback to direct `curl`/raw HTTP-only execution.
4. If synthesis fails but MCP probe tools are healthy, continue with manual probe-verified execution using gathered missing inputs.

## Environment Discovery

At run start, discover and persist once:

1. API base URL (or host/port).
2. Probe base URL (or host/port).
3. Optional `apiBasePath`.
4. Auth requirement/token only if needed.
5. Validate probe base with `probe_check` before endpoint loop.

## Probe Policy

1. Probe verification is optional per endpoint.
2. Run probe checks only when strict line target is available/provided.
3. Never claim line success without strict `Class#method:line` verification.

## Recipe Synthesis Policy

1. Treat `probe_recipe_create` as deterministic and fail-closed.
2. Use `intentMode=regression_http_only` for HTTP regression runs without strict line verification.
3. For `probe_recipe_create`, pass controller/service class as exact FQCN in `classHint`.
4. Runtime synthesis scope is runtime-only (`src/main/java` + generated-main roots); test sources are excluded.
5. Pass `apiBasePath` when runtime uses a context path (for example `/api/v1`).
6. Prompt for context path at most once per run, then reuse the same `apiBasePath` value for all endpoints in that run.
7. If `probe_recipe_create` returns `resultType=report`, do not hard-stop the whole run:
   - keep fail-closed diagnostics for that endpoint
   - gather only missing execution inputs
   - continue endpoint with manual probe-verified flow when feasible.
8. In report mode, prefer compact execution metadata:
   - `executionPlan.routingReason` (code)
   - `executionPlan.steps[].actionCode` (code)
   - avoid depending on verbose instruction text.
9. Route only by deterministic contract fields (`resultType`, `status`, `reasonCode`, `failedStep`).
10. Never use confidence/heuristic scoring for routing decisions.
11. Probe tool outputs use compact text summaries; treat `structuredContent` as canonical for full payload details.
12. Capture and propagate synthesis diagnostics for every fail-closed report:
   - `reasonCode`
   - `failedStep`
   - `evidence`
   - `attemptedStrategies`
   - `synthesizerUsed`
13. Prefer runtime-provided `capturePreview.executionPaths` / `probe_get_capture.capture.executionPaths` as call-path evidence when present; avoid heuristic reconstruction.

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

## Fallback: Manual Endpoint Continuation

When auto-inference fails for an endpoint:

1. Collect missing context once:
   - HTTP method/path
   - query/body shape
   - auth token if required.
2. Execute endpoint with probe verification:
   - `probe_reset`
   - trigger HTTP request
   - `probe_wait_for_hit` or `probe_get_status`.
3. Record deterministic per-endpoint outcome; continue remaining endpoints.

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

