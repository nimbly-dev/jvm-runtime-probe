# Spring Request Mapper Plugin

Spring MVC mapping extractor plugin for the Java AST request-mapper SPI.

## File Tree Packaging

```text
java-agent/request-mapper-spring/src/main/java/com/nimbly/mcpjvmdebugger/requestmapping/extractor/spring
\- (Spring extractor implementation classes)

java-agent/request-mapper-spring/src/main/resources/META-INF/services
\- com.nimbly.mcpjvmdebugger.requestmapping.extractor.MappingExtractor
```

## Organization

- Implements Spring-specific annotation extraction and merge behavior only.
- Depends on `core-request-mapper` contracts/SPI.
- Registered as a `ServiceLoader` provider for `MappingExtractor`.
- No probe runtime or javaagent instrumentation logic belongs in this module.
