---
name: mcp-jvm-dev-alignment
description: Align development work for the mcp-jvm-debugger repository around its product goal, engineering standards, and delivery principles. Use when working in this workspace to fix bugs, develop features, review changes, plan issues, or discuss implementation direction, especially for requests like "let's fix this bug", "let's develop this feature", "review this change", "plan this issue", or "help debug this behavior".
---

# MCP JVM Dev Alignment

## Overview

Use this skill to keep work in `mcp-jvm-debugger` aligned to the project goal, the expected engineering standards, and the way coding agents should use the MCP.

Start from the product goal first, not from the current implementation shape.

## Project Goal

Treat `mcp-jvm-debugger` as a bridge that lets coding agents interact more directly with JVM applications to support development and debugging.

Treat current capabilities as the present shape of that goal, not the boundary of the project.

Prefer decisions that make agent-guided work more direct, reliable, and useful over decisions that only preserve the current internal structure.

## Agent Lens

Evaluate changes based on how a coding agent will understand, invoke, and rely on the MCP.

Prefer behavior that is easy for agents to use correctly, hard to misuse, and clear in both contract and output.

Keep outputs explicit, stable, and useful for follow-up agent decisions.

## Engineering Standards

Maintain MCP standards. Keep public contracts intentional, coherent, and stable unless a deliberate change is required.

Maintain TypeScript standards in server-side code and Java standards in JVM-side code.

Prefer clear structure, explicit contracts, and test-backed behavior over shortcuts.

Keep the public MCP surface disciplined. Do not add many tools unless a capability clearly needs a separate public interface.

Prefer extending existing abstractions and flows before introducing new public entrypoints.

## Delivery Standard

Apply the same standard to bug fixes, features, refactors, and reviews: optimize for efficiency, output quality, and long-term correctness.

Fix root causes when feasible instead of patching only the visible symptom.

Choose changes that reduce the chance of the same class of bug returning.

Keep fixes focused, validated, and maintainable from the perspective of coding-agent use.

## Working Style

Clarify the intended development or debugging outcome before committing to implementation details.

Ground decisions in the actual codebase and current behavior, but do not let the current implementation limit the product direction.

When tradeoffs appear, prefer the path that best supports agent-to-JVM interaction while preserving standards, efficiency, and output quality.
