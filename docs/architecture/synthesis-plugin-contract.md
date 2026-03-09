# Synthesis Plugin Contract

`probe_recipe_create` is the single public recipe entrypoint. Framework-specific request synthesis is internal and routed through synthesizer plugins.

## Core Rules

- Public MCP surface remains stable; do not expose per-framework recipe tools by default.
- Plugins must return deterministic structured outputs.
- Fail closed when entrypoint proof is incomplete.

## Required Failure Fields

- `reasonCode`
- `failedStep`
- `nextAction`
- `evidence[]`
- `attemptedStrategies[]`

## Placement

- Registry and plugin adapters: `src/tools/synthesizers/<framework>`
- Framework synthesis helpers: `src/utils/synthesizers/<framework>`
