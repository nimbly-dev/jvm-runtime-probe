---
name: mcp-jvm-line-probe-run
description: "Run strict single-line JVM probe verification with mandatory MCP toolchain usage and fail-closed runtime route resolution."
---

# MCP JVM Line Probe Run

Use this workflow only for strict one-line verification runs.

## Contract

1. This skill runs in `single_line_probe` semantics only.
2. Strict line target is mandatory: `Class#method:line` (or inferable via `lineHint` from `classHint` + `methodHint`).
3. Never downgrade to regression-only in this skill.

## MCP-First Requirement

1. Mandatory tools: `project_context_validate`, `probe_recipe_create`, `probe_reset`, `probe_wait_for_hit` or `probe_get_status`.
2. If MCP toolchain is unavailable, stop immediately and return:
   - `reasonCode=toolchain_unavailable`
   - `nextAction=enable_mcp_jvm_debugger_tools_then_rerun`
3. Never fallback to direct `curl`/raw HTTP-only execution.

## Execution Sequence

1. Call `project_context_validate` with orchestrator-selected `projectRootAbs`.
2. Call `probe_recipe_create` with probe intent, strict line target context, and exact FQCN in `classHint`.
3. Provide `apiBasePath` when runtime is deployed with a context path (for example `/api/v1`).
4. Ask for context path at most once per run; reuse the same `apiBasePath` for subsequent attempts in that run.
5. Runtime synthesis scope is runtime-only (`src/main/java` + generated-main roots); test sources are excluded.
6. If `probe_recipe_create` returns `resultType=report`, treat it as fail-closed synthesis pushback and stop unless the report indicates only missing user input.
7. In report mode, read compact execution metadata:
   - `executionPlan.routingReason` (code)
   - `executionPlan.steps[].actionCode` (code)
   - avoid depending on verbose instruction text.
8. Route only by deterministic contract fields (`resultType`, `status`, `reasonCode`, `failedStep`).
9. Never use or request confidence/heuristic scoring for routing decisions.
10. On report outputs, always capture synthesis diagnostics:
   - `reasonCode`
   - `failedStep`
   - `evidence`
   - `attemptedStrategies`
   - `synthesizerUsed`
11. Resolve route dynamically from runtime candidates.
12. Validate exactly one route using:
   - probe reachability
   - API reachability
   - strict target alignment (`Class#method:line` resolvability or class-scoped line discovery)
13. Execute probe flow:
   - `probe_reset` -> trigger HTTP request -> `probe_wait_for_hit` / `probe_get_status`
14. Cleanup (disable actuation when used).

## Route Pushback

If route resolution fails, stop and return:

1. `probe_route_not_found` (no valid route)
2. `probe_route_ambiguous` (multiple valid routes)

Pushback output must include:

1. `attemptedCandidates`
2. `validationResults`
3. `nextAction`
4. `Repro Steps`
5. `reasonCode`
6. `failedStep`
7. `synthesizerUsed` (when recipe synthesis was attempted)
8. `attemptedStrategies` (when recipe synthesis was attempted)
9. `evidence` (when recipe synthesis was attempted)

## Required Human Run Summary

Always include:

1. `Selected Mode`
2. `Routing Outcome`
3. `Trigger Request`
4. `HTTP Result`
5. `Probe Verification`
6. `Run Timing`:
   - `runStartMs` (Unix ms)
   - `runEndMs` (Unix ms)
   - `runDurationMs` (`runEndMs - runStartMs`)
   - optional human-readable UTC timestamps for operator readability
7. `Synthesis Diagnostics` (`synthesizerUsed`, `reasonCode`, `failedStep` when present)
8. `Repro Steps` (ordered, executable, numbered)
9. `Cleanup`
10. `Trust Note`

