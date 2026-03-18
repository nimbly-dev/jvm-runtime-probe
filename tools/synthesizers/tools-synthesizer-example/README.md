# Example Synthesizer Plugin (Opt-In)

This package is a practical starter for framework adopters building synthesis plugins.

## Important

- This package is example-only.
- It is **not** registered in default runtime plugin wiring.
- It is **not** part of default `tsconfig` include paths.

## Structure

- `src/adapter.ts`: package-facing entrypoint.
- `src/plugin.ts`: plugin implementation.
- `src/models/*`: framework-local model/constants used by the adapter/plugin.

## What It Demonstrates

- proper plugin shape (`id`, `framework`, `pluginApiVersion`)
- strict `canHandle` gating
- deterministic `report` response when not enabled
- deterministic starter `recipe` response when enabled
- usage of project-standard alias imports (`@...`)
- adapter + models organization for synthesizer packages

## Current Example Behavior

The plugin checks for a marker file in project root:

- `.mcp-java-dev-tools-example-framework`

If marker exists:
- returns a starter recipe.

If marker does not exist:
- returns a fail-closed report with actionable `nextAction`.

This makes it safe to copy while showing the full success/failure contract shape.

## How Adopters Use This

1. Copy into `tools/synthesizers/tools-<framework>`.
2. Keep `adapter.ts` as public entrypoint.
3. Rename plugin `id` and `framework`.
4. Replace marker logic with real framework detection.
5. Replace starter recipe generation with framework-aware synthesis.
6. Keep framework-specific models under `src/models`.
7. Add tests for both success and fail-closed paths.

## When To Register In Default Registry

Only after:

- `canHandle` is stable
- output contracts are deterministic
- failure codes are specific
- end-to-end recipe flow is probe-verified

Then register in `createDefaultSynthesizerRegistry`.
