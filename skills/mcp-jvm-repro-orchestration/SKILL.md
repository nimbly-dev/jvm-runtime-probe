---
name: mcp-jvm-repro-orchestration
description: "Orchestrate mcp-jvm-debugger reproducibility requests with deterministic intent routing across regression-only, line-probe-only, and combined runs."
---

# MCP JVM Repro Orchestration

Use this workflow for reproducibility requests that mention API regression checks, line probe verification, or both.

## Deterministic Routing Contract

Classify each request into exactly one selected mode:

1. `regression_api_only`
2. `single_line_probe`
3. `regression_plus_line_probe`

Rules:

1. Probe-capable modes (`single_line_probe`, `regression_plus_line_probe`) require an explicit line target (`Class#method:line` or `lineHint`).
2. If probe intent exists but no line target is provided:
   - downgrade to `regression_api_only`
   - do not call `probe_reset`, `probe_get_status`, `probe_wait_for_hit`, or `probe_enable`
   - include exact note:
     - `Line target missing; provide Class#method: to enable line verification.`

## Tool Sequence

1. Call `project_list`.
2. Call `probe_recipe_create` with:
   - `intentMode`
   - `classHint`, `methodHint`, optional `lineHint`
   - auth fields when available
3. Read `structuredContent`:
   - `selectedMode`
   - `status`
   - `routingNote`
   - `executionPlan.steps`
4. Execute steps exactly in order.

## Mode-Specific Execution Rules

1. `regression_api_only`
   - run API checks only
   - zero probe tool calls
2. `single_line_probe`
   - run line verification flow:
     - `probe_reset` -> trigger request -> `probe_wait_for_hit` / `probe_get_status`
   - if verifying multiple line targets in one run:
     - prefer one `probe_reset` call with `keys[]` before trigger execution
     - prefer one `probe_get_status` call with `keys[]` after trigger execution
   - if setup/reset should target all known lines for one class:
     - use `probe_reset` with `className`
3. `regression_plus_line_probe`
   - run combined flow in one execution:
     - `probe_reset` -> API regression request -> probe verification
   - for multi-target verification in combined mode:
     - batch reset targets with `probe_reset(keys[])`
     - batch verify targets with `probe_get_status(keys[])`

## Required Human Run Summary

Always include these fields:

1. `Selected Mode`
   - one of: `regression_api_only`, `single_line_probe`, `regression_plus_line_probe`
2. `Routing Note`
   - explicit note or `none`
3. `Trigger Request`
4. `HTTP Result`
5. `Probe Verification`
6. `Cleanup`
7. `Trust Note`

## Guardrails

1. Never run probe tools when selected mode is `regression_api_only`.
2. Never claim line success without strict line key verification (`Class#method:line`).
3. Keep output machine-first from `structuredContent`, with concise human summary.

