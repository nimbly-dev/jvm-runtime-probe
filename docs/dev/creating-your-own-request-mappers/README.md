# Creating a Request Mapper Adapter

This guide covers the current Java adapter surface for HTTP route extraction. The core resolver contract today materializes HTTP request candidates, so a new adapter must be able to prove an HTTP method and path from source evidence.

You'll build an adapter that extracts route information from source code evidence, usually annotations.

---

## Core Principle

Your adapter answers one question: **Can I prove the HTTP method and path for this method from source evidence alone?**

- If yes → return a normalized `ResolvedMapping`
- If no → return `Optional.empty()` and let the pipeline fail closed

This isn't about guessing routes. It's about extracting them only when the evidence is unambiguous.

---

## Getting Started

Copy the example module as your starting point:

```
java-agent/mappers-adapters/adapter-request-mapper-example
```

This example is disabled by default and safe to modify. It demonstrates the complete extraction pattern:

- Annotation name mapping
- Class + method path merging
- HTTP method resolution
- Path expression resolution (literals, constants, concatenation)
- Final materialization through `PathMaterializer`

Place your implementation in:

```
java-agent/mappers-adapters/adapter-request-mapper-<framework>
```

For example: `adapter-request-mapper-jaxrs-http`, `adapter-request-mapper-quarkus-http`

If you need a non-HTTP transport such as gRPC, an adapter alone is not enough. The current `ResolvedMapping` contract, resolver success payload, and downstream synthesis flow are all HTTP-shaped and would need to be extended first.

## Resolver Runtime Config

Request mapper adapters are discovered via Java `ServiceLoader` on the resolver process classpath.

You can wire adapters in two ways:

1. Inside this repo (core-owned adapter module)
2. External classpath/jar (private or out-of-repo adapter)

### Inside this repo

Use this when the adapter should live in this repository.

1. Create `java-agent/mappers-adapters/adapter-request-mapper-<framework>`.
2. Add `META-INF/services` registration for your extractor.
3. Build the adapter jar.
4. Ensure the resolver classpath includes both:
   - `core-entrypoint-mapper` jar
   - your adapter jar

Example (PowerShell):

```powershell
$env:MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH="C:\repo\mcp-jvm-debugger\java-agent\core\core-entrypoint-mapper\target\mcp-java-dev-tools-core-entrypoint-mapper-0.1.0-all.jar;C:\repo\mcp-jvm-debugger\java-agent\mappers-adapters\adapter-request-mapper-acme-http\target\mcp-java-dev-tools-adapter-request-mapper-acme-http-0.1.0.jar"
```

### External adapter jars

Use this when the adapter is maintained outside this repository.

Point `MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH` at the resolver jar plus external adapter jars:

PowerShell:

```powershell
$env:MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH="C:\resolver\mcp-java-dev-tools-core-entrypoint-mapper-0.1.0-all.jar;C:\internal\adapters\acme-http-mapper.jar"
```

Bash:

```bash
export MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH="/opt/resolver/mcp-java-dev-tools-core-entrypoint-mapper-0.1.0-all.jar:/opt/internal/adapters/acme-http-mapper.jar"
```

Alternative:
- `MCP_JAVA_REQUEST_MAPPING_RESOLVER_JAR` can point to a single fat jar when your resolver and adapters are already bundled together.

---

## Implementation Checklist

- [ ] Copy the example module; rename package and artifact names
- [ ] Replace annotation constants with your framework's route annotations
- [ ] Implement class-level base path extraction
- [ ] Implement method-level path and verb extraction
- [ ] Reuse `PathMaterializer` for consistent template handling
- [ ] Register your extractor in `META-INF/services`
- [ ] Build the module standalone before wiring it into the aggregator

---

## Design Guidelines

| Do | Don't |
|---|---|
| Keep `strategyId()` stable and specific | Put framework-specific code in `core-entrypoint-mapper` |
| Treat composed annotations (`@Get`, `@Post`) as first-class | Return a mapping when only part of the route is proven |
| Support both `path` and `value` attributes when the framework uses both | Rely on naming conventions instead of annotation evidence |
| Handle constant references and string concatenation | Convert unresolved expressions into fake paths |
| Return `Optional.empty()` for ambiguous cases | Bypass `ServiceLoader` registration |

---

## When to Fail Closed

Return `Optional.empty()` when:

- No route declarations match
- HTTP method cannot be resolved
- Path expression requires unsafe assumptions to resolve

Returning empty is correct behavior. Silently inventing routes is not.

---

## Building and Validating

Build your module in isolation first:

```bash
mvn -f java-agent/mappers-adapters/adapter-request-mapper-<framework>/pom.xml test
```

Then (after wiring) build the full stack:

```bash
mvn -f java-agent/pom.xml test
```

After wiring, validate end-to-end through the recipe/probe flow to confirm the mapper output works in orchestrated execution.

---

## Definition of Done

- [ ] Adapter compiles and loads via `ServiceLoader`
- [ ] Proven routes resolve to deterministic `ResolvedMapping` objects
- [ ] Unproven routes fail closed — no pseudo-success output
- [ ] Behavior is documented well enough for the next contributor to extend

---

## The Sanity Check

Before calling it done, ask yourself:

> If extraction fails, does the system still provide a clear next step without pretending success?

If yes, your adapter is aligned with project intent.
