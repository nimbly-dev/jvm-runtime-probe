## Java Probe Agent

Runtime-only probe agent for local JVMs. No application source code changes required.

### Build

```powershell
mvn -f java-agent\pom.xml -DskipTests package
```

Built artifacts:

```text
java-agent\core\target\mcp-jvm-probe-agent-0.1.0.jar
java-agent\request-mapping-resolver\target\mcp-jvm-request-mapping-resolver-0.1.0-all.jar
```

The request-mapping resolver is a generic JVM AST helper consumed by synthesizers through a `stdin/stdout` JSON contract. Spring MVC and JAX-RS are the first built-in framework resolvers.

### Run With Spring Boot

Use JVM args (example):

```text
-javaagent:C:\Users\Altheo\repository\mcp-jvm-debugger\java-agent\core\target\mcp-jvm-probe-agent-0.1.0.jar=host=127.0.0.1;port=9191;mode=observe;actuatorId=none;captureMethodBufferSize=3;include=com.nimbly.**;exclude=com.nimbly.mcpjvmdebugger.agent.**,**.config.**,**Test
```

`include` and `exclude` are comma-separated glob patterns over dotted class names.
- Agent mode defaults to `observe`.
- Supported modes:
  - `observe` (default): telemetry only, no runtime behavior mutation.
  - `actuate`: enables controlled runtime actuation flows.
- `actuatorId` is optional and only meaningful in `actuate` mode.
- Generic boolean actuator (actuate mode):
  - target key: `ClassName#methodName`
  - return value override: `true|false`
- If no wildcard is present, pattern is treated as package prefix.
- Runtime probe keys are dynamic: `fully.qualified.ClassName#methodName`.
- Line-level probe keys are also emitted: `fully.qualified.ClassName#methodName:<lineNumber>`.
  - Example: `com.nimbly.phshoesbackend.useraccount.core.service.impl.SuppressionServiceImpl#shouldBlock:32`
- In `mcp-jvm-debugger`, `project_context_validate` can validate scoped project roots before probe runs.
- If `include` is omitted, the agent auto-infers base package at startup:
  - from executable jar manifest `Start-Class` (or `Main-Class`)
  - or from class-launch command (`java com.example.Main`)
  - then uses `<base.package>.**` as default include
- Defaults can be overridden without changing args:
  - `-Dmcp.probe.include=...` or env `MCP_PROBE_INCLUDE`
  - `-Dmcp.probe.exclude=...` or env `MCP_PROBE_EXCLUDE`
  - `-Dmcp.probe.mode=observe|actuate` or env `MCP_PROBE_MODE`
  - `-Dmcp.probe.actuator.id=<id>` or env `MCP_PROBE_ACTUATOR_ID`
  - `-Dmcp.probe.actuate.target=<Class#method>` or env `MCP_PROBE_ACTUATE_TARGET`
  - `-Dmcp.probe.actuate.return.boolean=true|false` or env `MCP_PROBE_ACTUATE_RETURN_BOOLEAN`
  - `-Dmcp.probe.capture.enabled=true|false` or env `MCP_PROBE_CAPTURE_ENABLED`
  - `-Dmcp.probe.capture.max.keys=<int>` or env `MCP_PROBE_CAPTURE_MAX_KEYS`
  - `-Dmcp.probe.capture.max.args=<int>` or env `MCP_PROBE_CAPTURE_MAX_ARGS`
  - `-Dmcp.probe.capture.method.buffer.size=<int>` or env `MCP_PROBE_CAPTURE_METHOD_BUFFER_SIZE`
  - `-Dmcp.probe.capture.preview.max.chars=<int>` or env `MCP_PROBE_CAPTURE_PREVIEW_MAX_CHARS`
  - `-Dmcp.probe.capture.stored.max.chars=<int>` or env `MCP_PROBE_CAPTURE_STORED_MAX_CHARS`
  - `-Dmcp.probe.capture.redaction=basic|off` or env `MCP_PROBE_CAPTURE_REDACTION`
- `captureMethodBufferSize` controls recent captures retained per `Class#method`.
  - Range: `1..32`
  - Default: `3`
  - Precedence: `agent arg > JVM system property > environment variable > default`

### Endpoints Exposed By Agent

- `GET /__probe/status?key=<probe-key>`
  - Example key: `com.nimbly.phshoesbackend.catalog.core.repository.jpa.CatalogShoeSpecifications#finalPriceGte`
  - Example line key: `com.nimbly.phshoesbackend.catalog.core.repository.jpa.CatalogShoeSpecifications#finalPriceGte:87`
  - Example response: `{ "contractVersion":"0.1.0v", "probe": { "key":"...#finalPriceGte:87", "hitCount":1, "lastHitEpochMs":1739671200000, "lineResolvable":true, "lineValidation":"resolvable" }, "capturePreview": { "available":true, "captureId":"abc123", "methodKey":"...#finalPriceGte", "capturedAtEpochMs":1739671200000, "redactionMode":"basic", "argsPreview":[{"index":0,"value":"{\"sku\":\"A1\"}","truncated":false,"originalLength":12,"redacted":false}], "returnPreview":{"value":"true","truncated":false,"originalLength":4,"redacted":false}, "thrownPreview":null, "truncatedAny":false }, "runtime": { "mode":"observe", "actuatorId":"", "actuateTargetKey":"", "actuateReturnBoolean":false, "serverEpochMs":1739671200123 } }`
- `GET /__probe/capture?captureId=<capture-id>`
  - Returns fuller captured argument/return/throw payload for the requested `captureId`.
  - Example response: `{ "contractVersion":"0.1.0v", "capture": { "captureId":"abc123", "methodKey":"...#finalPriceGte", "capturedAtEpochMs":1739671200000, "redactionMode":"basic", "args":[...], "returnValue":{...}, "thrownValue":null, "truncatedAny":false } }`
- `POST /__probe/reset`
  - Body: `{ "key":"com.nimbly.phshoesbackend.catalog.core.repository.jpa.CatalogShoeSpecifications#finalPriceGte" }`
  - Line-key reset works the same way using `Class#method:<line>`.

