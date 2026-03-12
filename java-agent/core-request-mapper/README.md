# Core Request Mapper

Framework-agnostic Java AST request-mapping resolver used by `probe_recipe_create` synthesis.

## File Tree Packaging

```text
java-agent/core-request-mapper/src/main/java/com/nimbly/mcpjvmdebugger/requestmapping
|- api/
|- ast/
|- core/
|- extractor/
|- resolution/
\- transport/
   \- http/
```

## Organization

- `api` contains resolver request/response contract DTOs.
- `ast` contains internal AST descriptors and method context types.
- `core` contains source scanning, indexing, type resolution, and method selection.
- `extractor` defines mapper SPI (`MappingExtractor`) and plugin registry/discovery.
- `resolution` contains normalized resolved mapping data before transport materialization.
- `transport.http` materializes HTTP request candidates from resolved mappings.
- Flow: `core -> extractor (SPI) -> transport.http -> api`.

## SPI Rules

- Mapper implementations must implement `com.nimbly.mcpjvmdebugger.requestmapping.extractor.MappingExtractor`.
- Provider modules must register implementations in:
  - `META-INF/services/com.nimbly.mcpjvmdebugger.requestmapping.extractor.MappingExtractor`
- Discovery is runtime via `ServiceLoader`; if no plugin is loaded, resolver returns deterministic fail-closed report:
  - `reasonCode=mapper_plugin_unavailable`
