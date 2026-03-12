# Request Mapping Resolver

Spring-first Java AST resolver used by `probe_recipe_create` synthesis.

## File Tree Packaging

```text
java-agent/request-mapping-resolver/src/main/java/com/nimbly/mcpjvmdebugger/requestmapping
|- RequestMappingResolver.java
|- RequestMappingResolverMain.java
|- api/
|- ast/
|- core/
|- extractor/
|  \- spring/
|- resolution/
\- transport/
   \- http/
```

## Organization

- `RequestMappingResolver` is the thin orchestrator; it validates inputs, coordinates index + selector + extractor flow, and emits stable response DTOs.
- `api` holds wire DTOs only (`ResolverRequest`, response variants, `RequestCandidate`).
- `ast` contains AST-oriented internal carriers (`TypeDescriptor`, `MethodContext`, parameter metadata).
- `core` owns indexing, source-root discovery, type reference resolution, and method-context selection.
- `extractor.spring` contains Spring-specific annotation/mapping extraction and merge behavior.
- `resolution` contains resolved mapping artifacts before final candidate shaping.
- `transport.http` materializes HTTP path/query/body templates from resolved Spring mappings.
- Flow: `core -> extractor.spring -> transport.http -> api`.
