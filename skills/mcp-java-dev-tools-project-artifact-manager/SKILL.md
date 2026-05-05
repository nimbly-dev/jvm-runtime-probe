---
name: mcp-java-dev-tools-project-artifact-manager
description: "Manage persistent project artifacts under .mcpjvm/<project-name>/projects.json. Use when the user wants project context setup for runtime contexts, external systems, and health checks without duplicating probe-config."
---

# MCP Java Dev Tools Project Artifact Manager

Use this skill to manage project-level artifacts while keeping probe routing in `probe-config.json`.

## Scope

1. Initialize `.mcpjvm/<project-name>/projects.json`.
2. Validate deterministic project artifact shape.
3. Add/update runtime contexts (`terminal`/`docker`).
4. Add/update external systems and health checks.
5. Resolve env key references (never env values).

## Rules

1. If project name is missing, ask the user first and do not create files yet.
2. `probe-config.json` remains authoritative for probes and baseUrl routing.
3. `projects.json` MUST NOT duplicate probe endpoint config.
4. Persist only env key names (for example `AUTH_BEARER_TOKEN`), never resolved token values.
5. Runtime context `mode` is restricted to `terminal` and `docker`.
6. Runtime context supports `autoStart` and `autoStopOnFinish` booleans (default true).
7. External system checks may use only deterministic `tcp` or `http` checks in v1.
8. Fail closed on ambiguous discovery; do not guess ports, hosts, or auth keys.
9. `defaults.retryMax` and `defaults.requestTimeoutMs` are used by orchestrator preflight health checks.

## Required Artifact Path

```
.mcpjvm/<project-name>/projects.json
```

## Required Shape

```json
{
  "workspaces": [
    {
      "projectRoot": "C:\\workspace\\example",
      "envFile": ".env",
      "auth": {
        "bearerTokenEnv": "AUTH_BEARER_TOKEN"
      },
      "runtimeContexts": [
        {
          "name": "terminal-cli",
          "mode": "terminal",
          "autoStart": true,
          "autoStopOnFinish": true
        },
        {
          "name": "docker-compose",
          "mode": "docker",
          "composeFile": "docker-compose.yml"
        }
      ],
      "externalSystems": [
        {
          "name": "postgres",
          "kind": "database",
          "host": "localhost",
          "port": 5432,
          "healthChecks": [
            {
              "id": "tcp-open",
              "type": "tcp",
              "target": "localhost:5432",
              "required": true
            }
          ]
        }
      ],
      "defaults": {
        "requestTimeoutMs": 10000,
        "retryMax": 1
      }
    }
  ]
}
```

## Workflow

1. Resolve workspace root.
2. Ask for project name when missing.
3. Build artifact path `.mcpjvm/<project-name>/projects.json`.
4. If file exists: read + validate + patch requested changes.
5. If file does not exist: create minimal valid structure and apply requested changes.
6. Validate end-to-end and return deterministic summary.

## Runtime Health Defaults

1. `defaults.retryMax`: retry attempts for required external system checks.
2. `defaults.requestTimeoutMs`: default timeout for required external system checks when per-check timeout is not set.
3. Keep values small and deterministic for fast preflight feedback.

## Extensibility

This skill supports modular external-system discovery guidance in:

1. `README.md`
2. `references/postgres.md`
3. `references/dynamodb.md`
4. `references/keycloak.md`

When adding new systems, extend `references/` with one file per system family and keep rules deterministic.

## Fail-Closed Reason Codes

1. `project_name_missing`
2. `project_artifact_missing`
3. `project_artifact_invalid`
4. `workspace_root_invalid`
5. `env_key_missing`
6. `runtime_context_unknown`
7. `external_system_invalid`
8. `external_healthcheck_failed`
9. `discovery_ambiguous`
