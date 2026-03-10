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
2. If `probe_recipe_create` returns `resultType=report`, stop endpoint execution for that route unless report indicates only missing user input.
3. In report mode, prefer compact execution metadata:
   - `executionPlan.routingReason` (code)
   - `executionPlan.steps[].actionCode` (code)
   - avoid depending on verbose instruction text.
4. Capture and propagate synthesis diagnostics for every fail-closed report:
   - `reasonCode`
   - `failedStep`
   - `evidence`
   - `attemptedStrategies`
   - `synthesizerUsed`

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
6. `Synthesis Diagnostics` (aggregate reason/failure fields for blocked endpoints)
7. `Repro Steps` (ordered, executable, numbered)
8. `Cleanup`
9. `Trust Note`

