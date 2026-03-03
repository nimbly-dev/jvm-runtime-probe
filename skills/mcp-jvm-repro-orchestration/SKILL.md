---
name: mcp-jvm-repro-orchestration
description: "Orchestrate mcp-jvm-debugger reproducibility requests with strict natural-first behavior and explicit user-confirmed actuated fallback. Use when a user asks for a reproducible recipe/report for Class.method.line, especially when line-level reachability, auth-gated endpoints, or probe/line-hit distinctions are involved."
---

# MCP JVM Repro Orchestration

Use this workflow for requests like:
- "Given this token, give me reproducible recipe for X.class X.method line N"
- "Why was this line not hit?"
- "Try actuate mode only if needed"

## Core Contract

1. Treat `line_hit` as success when `lineHint` is provided.
   - Verify with line probe key format: `Class#method:<line>`.
2. Treat `probe_hit` as secondary telemetry only.
3. Run natural mode first.
4. Do not auto-switch to actuated mode.
5. If natural is unreachable, return report and ask explicit confirmation for actuated mode.
6. If actuated is used, always cleanup with `probe_actuate(mode=observe, ...)`.

## Tool Sequence

1. Call `projects_discover` first to establish workspace/project scope.
2. Call `recipe_generate` with:
   - `mode: "natural"`
   - `classHint`, `methodHint`, optional `lineHint`
   - auth fields if available
3. Inspect `structuredContent`:
   - `resultType`
   - `status`
   - `nextAction`
   - `executionPlan`
4. Branch:
   - If `resultType="recipe"` and `status="natural_ready"`: execute natural plan.
   - If `resultType="report"` and `status="unreachable_natural"`: explain reason and ask user whether to proceed with actuated mode.
5. Only after user confirmation, call `recipe_generate` again with `mode: "actuated"`.
6. Run actuated flow:
   - `probe_actuate(mode=actuate, targetKey=..., returnBoolean=...)`
   - execute trigger request
   - verify (`line_hit` preferred, probe status secondary)
   - `probe_actuate(mode=observe, targetKey=...)`

## Reporting Rules

1. Natural success:
   - Return reproducible recipe.
   - Include target endpoint, auth requirements, verification steps.
2. Natural unreachable:
   - Return report, not recipe.
   - Include concrete reason from `status/nextAction`.
   - Offer actuated second-step prompt.
3. Actuated success:
   - Label as non-natural reproduction.
   - Include enable/verify/cleanup steps and exact target key.

## Required Human Response Format

When reporting execution results, always include this exact set of fields in human-readable form:

1. `Mode Used`
   - `observe` or `actuate` (and final mode after cleanup).
2. `Target`
   - line key used for verification (`Class#method:<line>`).
3. `Actuation`
   - whether armed, `targetKey`, `returnBoolean`, `actuatorId`.
4. `Trigger Request`
   - full method + URL.
   - request headers that matter (especially `Authorization` presence).
   - request body/query actually sent.
5. `HTTP Result`
   - status code and response payload.
6. `Probe Verification`
   - probe key checked.
   - before/after or reset/after hit counts.
   - explicit verdict: `line_hit` or `not_hit`.
7. `Cleanup`
   - disarm call result (`mode=observe`).
8. `Trust Note`
   - If mode was `actuate`, include warning:
     - `Actuation result is synthetic; validate final reproducibility in observe mode.`
   - If mode was `observe`, include:
     - `Observe mode reflects natural runtime behavior.`

## Required Confirmation Message

Use this exact confirmation intent before actuated mode:

"Natural path is unreachable for this line. Proceed with non-natural actuated mode?"

## Guardrails

1. Do not claim line-level success from probe counters alone.
   - Method key `Class#method` is not line-level proof; use `Class#method:<line>` for line_hit.
2. Do not hide mode switching.
3. Do not keep actuation armed after run completion.
4. Keep internal handling machine-first (`structuredContent`), human output concise.
5. Do not omit trigger request/response details in the final user-facing summary.
6. On Windows PowerShell, always use `curl.exe` (never `curl` alias) and avoid long inline JSON/header quoting; prefer variables/files for payloads.
