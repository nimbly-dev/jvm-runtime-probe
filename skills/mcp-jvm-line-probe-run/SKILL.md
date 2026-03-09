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

1. Mandatory tools: `project_list`, `probe_recipe_create`, `probe_reset`, `probe_wait_for_hit` or `probe_get_status`.
2. If MCP toolchain is unavailable, stop immediately and return:
   - `reasonCode=toolchain_unavailable`
   - `nextAction=enable_mcp_jvm_debugger_tools_then_rerun`
3. Never fallback to direct `curl`/raw HTTP-only execution.

## Execution Sequence

1. Call `project_list`.
2. Call `probe_recipe_create` with probe intent and line target context.
3. If `probe_recipe_create` returns `resultType=report`, treat it as fail-closed synthesis pushback and stop unless the report indicates only missing user input.
4. On report outputs, always capture synthesis diagnostics:
   - `reasonCode`
   - `failedStep`
   - `evidence`
   - `attemptedStrategies`
   - `synthesizerUsed`
5. Resolve route dynamically from runtime candidates.
6. Validate exactly one route using:
   - probe reachability
   - API reachability
   - strict target alignment (`Class#method:line` resolvability or class-scoped line discovery)
7. Execute probe flow:
   - `probe_reset` -> trigger HTTP request -> `probe_wait_for_hit` / `probe_get_status`
8. Cleanup (disable actuation when used).

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
6. `Synthesis Diagnostics` (`synthesizerUsed`, `reasonCode`, `failedStep` when present)
7. `Repro Steps` (ordered, executable, numbered)
8. `Cleanup`
9. `Trust Note`

