---
name: mcp-java-dev-tools-regression-suite
description: "Run MCP-first HTTP regression suites across controller, service, or whole API scope with optional strict probe verification per endpoint."
---

# MCP JVM Regression Suite

Use this workflow to execute crafted regression plans at controller scope, service scope, or whole API scope.

## Scope Modes

1. `controller` (endpoints mapped to one controller)
2. `service` (endpoints for one service/runtime)
3. `api` (whole API surface for a runtime)

## Using Crafted Plans

1. Plan authoring/refinement must be done first with:
   - `mcp-java-dev-tools-regression-plan-crafter`
2. Execute/replay the crafted plan using existing MCP flow (no new MCP tool).
3. If the plan is missing deterministic selectors or required context, fail closed and report exact missing fields.
4. Persist run artifacts automatically after each suite execution under:
   - `.mcpjvm/<project_name>/plans/regression/<plan>/runs/<run_id>/context.resolved.json`
   - `.mcpjvm/<project_name>/plans/regression/<plan>/runs/<run_id>/execution.result.json`
   - `.mcpjvm/<project_name>/plans/regression/<plan>/runs/<run_id>/evidence.json`
   - `.mcpjvm/<project_name>/plans/regression/<plan>/runs/<run_id>/correlation.json` (required when correlation fields are present in evidence)
   - `.mcpjvm/correlation-index.json` (required when correlation artifact is produced)

Project context integration:

1. If `.mcpjvm/<project-name>/projects.json` is configured for the workspace, resolve it before endpoint execution.
2. Apply env-key auth interpolation from project artifact into runtime context (key references only; never persist secret values).
3. Run required external health checks (`tcp`/`http`) before execution.
4. Fail closed on project-context blocking reason codes:
   - `project_artifact_missing`
   - `project_artifact_invalid`
   - `workspace_root_invalid`
   - `env_key_missing`
   - `runtime_context_unknown`
   - `external_system_invalid`
   - `external_healthcheck_failed`
5. When project-context is unresolved but recoverable, return minimal `needs_user_input` payload:
   - `missing[]`
   - `checks[]`
   - `nextAction`
6. Keep `needs_user_input` output minimal (no long narrative).
7. Resume execution from preflight checkpoint after user input is provided.

## Artifact Contract Requirements

Suite execution MUST emit deterministic fields needed by result rendering and correlation generation.

1. `execution.result.json` step rows MUST include:
   - `order`
   - `id`
   - `status`
   - `durationMs`
2. `evidence.json` SHOULD include normalized correlation inputs:
   - `correlationPolicy`:
     - `keyType`
     - `keyValue` or `keyValueContextPath`
     - `maxWindowMs`
     - optional `expectedFlow[]`
     - optional `correlationSessionId`
   - `correlationEvents[]`:
     - `eventId`
     - `probeId`
     - `timestampEpochMs`
     - `keyType`
     - `keyValue`
3. Canonical-only correlation support:
   - correlation artifacts are generated only from canonical `correlationPolicy` and `correlationEvents` fields.
   - legacy-only correlation fields are unsupported.
4. Persistence path requirement:
   - do not author `correlation.json` directly in suite logic.
   - persist only via canonical run artifact writer flow so generated `correlation.json` and `correlation-index.json` stay schema-consistent.

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
6. For terminal/local runtime, start Spring apps with probe agent wiring (prefer `scripts/spring-integration/run-spring-app-with-mcp.sh`) before executing regression.
7. If API endpoint is reachable but probe endpoint is unreachable while `verifyRuntime=true`, fail closed with `external_healthcheck_failed` (do not downgrade silently to HTTP-only).
8. For local terminal startup, resolve probe port deterministically from `.mcpjvm/probe-config.json`:
   - prefer `--probe-id <id>` + `--probe-config <path>`
   - or use `--agent-port <port>` explicit override
9. Do not rely on auto-scanned probe port when strict runtime verification is expected; it can drift from configured `probeBaseUrl`.

## Discovery-First Orchestration

Before requesting manual runtime inputs for discoverable prerequisites, execute this deterministic order:

1. Build initial preflight from plan + provided inputs.
2. If preflight contains discoverable pending prerequisites, execute discovery resolver first.
3. Merge discovered context with precedence:
   - user-provided > discovered > non-secret defaults
4. Re-run preflight.
5. Only if still unresolved, ask user for remaining required user-input fields.
6. Do not prompt for discoverable fields before discovery attempt.

## Needs User Input Contract

For resumable preflight blocks (for example missing env auth key or unreachable required external health check), emit:

1. `status=needs_user_input`
2. `missing[]` (for example missing env key names)
3. `checks[]` (for example `postgres:tcp-open=unreachable`)
4. `nextAction` (single deterministic instruction)

Do not emit wall-of-text explanations in this contract.

## Probe Policy

1. Probe verification is optional per endpoint.
2. Run probe checks only when strict line target is available/provided.
3. Never claim line success without strict `Class#method:line` verification.

## Recipe Synthesis Policy

1. Treat `probe_recipe_create` as deterministic and fail-closed.
2. Use `intentMode=regression` for HTTP regression runs without strict line verification.
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

## Local Runtime Port Alignment Policy

For non-Docker terminal execution:

1. Probe bind port MUST match the plan/runtime `probeBaseUrl` port for the target service.
2. If launcher-selected probe port differs from configured probe registry/baseUrl, stop and return fail-closed diagnostics.
3. Prefer service-id based resolution (`--probe-id`) over manual port guessing.

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
   - use canonical coverage enums:
   - `verified_line_hit`
   - `http_only_unverified_line`
   - `unknown` (only when deterministic mapping is unavailable)
5. `Probe Verification`
6. `Run Timing`:
   - `runStartEpoch` (Unix epoch in milliseconds)
   - `runEndEpoch` (Unix epoch in milliseconds)
   - `runDurationMs` (`runEndEpoch - runStartEpoch`)
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

