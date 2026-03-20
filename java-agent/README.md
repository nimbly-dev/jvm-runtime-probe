# Java Agent Structure

Grouped module layout with non-breaking artifact names.

## Active module groups
- `core/core-probe` (`mcp-java-dev-tools-agent`)
- `core/core-probe-runtime` (`mcp-java-dev-tools-core-probe-runtime`)
- `core/core-probe-instrumentation` (`mcp-java-dev-tools-core-probe-instrumentation`)
- `core/core-probe-control-http` (`mcp-java-dev-tools-core-probe-control-http`)
- `core/core-entrypoint-mapper` (`mcp-java-dev-tools-core-entrypoint-mapper`)
- `mappers-adapters/adapter-request-mapper-spring-http` (`mcp-java-dev-tools-adapter-request-mapper-spring-http`)
- `request-mapping-resolver` (legacy compatibility artifact, optional)

## Build entrypoint
- Parent: `java-agent/pom.xml`
- Aggregators:
  - `java-agent/core/pom.xml`
  - `java-agent/mappers-adapters/pom.xml`

## Integrated test location
- Top-level fixture and integration scaffolding lives under:
  - `test/fixtures/spring-apps`
  - `test/integration/mcp`

Java-agent behavior that must be validated with the MCP server and a real Spring runtime belongs in the centralized top-level `test` tree, not under `java-agent/tests`.

## Opt-in examples
- `mappers-adapters/adapter-request-mapper-example`

Examples are starter scaffolds for framework adoptors and are not part of default parent module wiring.

## Placeholder adapters
- `mappers-adapters/adapter-request-mapper-jaxrs-http`
- `mappers-adapters/adapter-request-mapper-grpc-rpc`

These folders are placeholders only. Spring HTTP is the only active request-mapper adapter today.

`adapter-request-mapper-grpc-rpc` should be treated as a future-work placeholder, not as evidence that the current core request-mapping contract is transport-neutral. The shared resolver output is HTTP-specific today.
