# Data Fields Reference (0.1.0)

This document is the simple dictionary of JSON fields emitted to the orchestrator via MCP tool outputs.

Column meanings:
- `fieldName`: JSON path emitted in `structuredContent`.
- `fieldDesc`: What the field means.
- `toolUsedBy`: Tool that emits the field.
- `required`: `true` when always present for that tool output shape, otherwise `false`.
- `exampleValue`: Representative value.

Deterministic contract policy:
- Orchestration decisions must use deterministic fields (`resultType`, `status`, `reasonCode`, `failedStep`, `nextAction`).
- Confidence/heuristic scores are not part of the public MCP output contract.

Text vs structured content policy (probe tools):
- `structuredContent` is the canonical machine-readable payload and remains the source of truth.
- `content[0].text` is intentionally compact for context efficiency and may omit large diagnostic bodies.
- Probe payloads are compact-by-default (metadata first); heavy capture internals are intentionally omitted.
- `executionPaths` are omitted by default. Set `MCP_PROBE_INCLUDE_EXECUTION_PATHS=true` to include them.

Capture timestamp naming:
- Capture timestamp fields use `capturedAtEpoch`.

## debug_check

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `ok` | Basic service health flag. | `debug_check` | true | `true` |
| `serverTime` | Server timestamp when ping response is produced. | `debug_check` | true | `"2026-03-07T04:00:00.000Z"` |
| `version` | MCP server version. | `debug_check` | true | `"0.1.0"` |

## project_context_validate

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `resultType` | Output shape discriminator for context validation. | `project_context_validate` | true | `"project_context"` |
| `status` | Validation status (`ok` or selector error status). | `project_context_validate` | true | `"ok"` |
| `projectRootAbs` | Absolute orchestrator-selected project root used for scoped validation. | `project_context_validate` | false | `"C:\\repo\\catalog-service"` |
| `buildMarkers` | Build markers found directly under `projectRootAbs`. | `project_context_validate` | false | `["pom.xml"]` |
| `hasBuildMarker` | Whether any Maven/Gradle marker exists in the project root. | `project_context_validate` | false | `true` |
| `javaSourceRoots` | Basic Java source roots discovered under the selected project root. | `project_context_validate` | false | `["C:\\repo\\catalog-service\\src\\main\\java"]` |
| `hasJavaSourceRoot` | Whether at least one basic Java source root exists. | `project_context_validate` | false | `true` |
| `reason` | Error reason for selector failures. | `project_context_validate` | false | `"projectRootAbs must be absolute"` |
| `nextAction` | Follow-up action when validation fails. | `project_context_validate` | false | `"Provide projectRootAbs as an absolute existing project directory path."` |

## probe_check

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `config` | Effective diagnose call configuration. | `probe_check` | true | `{"baseUrl":"http://127.0.0.1:9191"}` |
| `config.authConfigured` | Whether `probe_check.http.headers` were provided and applied. | `probe_check` | true | `true` |
| `config.authHeaderNames` | Header names applied to probe reset/status calls (values intentionally omitted). | `probe_check` | true | `["Authorization"]` |
| `checks` | Aggregated endpoint checks. | `probe_check` | true | `{"reset":{"ok":true},"status":{"ok":true}}` |
| `checks.reset` | Reset endpoint diagnostic result. | `probe_check` | true | `{"ok":true,"status":200}` |
| `checks.status` | Status endpoint diagnostic result. | `probe_check` | true | `{"ok":true,"keyDecodingOk":true}` |
| `checks.status.keyDecodingOk` | Whether the probe status key decoding behavior is valid. | `probe_check` | false | `true` |
| `recommendations` | Operator follow-up hints when check fails. | `probe_check` | true | `[]` |

## probe_target_infer

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `resultType` | Target infer response mode (`report`, `ranked_candidates`, `class_methods`, `disambiguation`). | `probe_target_infer` | true | `"ranked_candidates"` |
| `status` | Inference status code for deterministic next-step routing. | `probe_target_infer` | true | `"ok"` |
| `projectRoot` | Absolute project root selected by orchestrator and used for scoped inference. | `probe_target_infer` | true | `"C:\\repo\\catalog-service"` |
| `hints` | Input hints used for scoped inference (`classHint` should be exact class/FQCN). | `probe_target_infer` | true | `{"projectRootAbs":"C:\\repo\\catalog-service","classHint":"com.example.CatalogService"}` |
| `hints.additionalSourceRoots` | Effective normalized additional source roots included in static inference scope. | `probe_target_infer` | false | `["C:\\repo\\core-module\\src\\main\\java"]` |
| `scannedJavaFiles` | Approximate Java file scan count. | `probe_target_infer` | false | `412` |
| `candidates` | Ranked target candidates for runtime probe keying. | `probe_target_infer` | false | `[{"key":"com.example.Catalog#save"}]` |
| `candidates[].line` | Runtime-validated strict probe line used for candidate selection (`null` when unresolved). | `probe_target_infer` | false | `133` |
| `candidates[].declarationLine` | Method declaration line for candidate metadata and strict disambiguation support. | `probe_target_infer` | false | `129` |
| `candidates[].firstExecutableLine` | First runtime-probe-validated executable line (`null` when no resolvable line is found in scan window). | `probe_target_infer` | false | `133` |
| `candidates[].lineSelectionStatus` | Runtime line selection outcome (`validated` or `unresolved`). | `probe_target_infer` | false | `"validated"` |
| `candidates[].lineSelectionSource` | Source of validated executable line when available. | `probe_target_infer` | false | `"runtime_probe_validation"` |
| `class` | Selected class block in `class_methods` mode. | `probe_target_infer` | false | `{"fqcn":"com.example.CatalogController"}` |
| `methods` | Method spans for selected class in `class_methods` mode. | `probe_target_infer` | false | `[{"methodName":"save","startLine":42}]` |
| `methods[].firstExecutableLine` | First runtime-probe-validated executable line for each method (`null` when unresolved). | `probe_target_infer` | false | `45` |
| `methods[].lineSelectionStatus` | Runtime line selection outcome per method (`validated` or `unresolved`). | `probe_target_infer` | false | `"unresolved"` |
| `methods[].lineSelectionSource` | Source of validated executable line per method when available. | `probe_target_infer` | false | `"runtime_probe_validation"` |
| `nextAction` | Required follow-up action when status is non-ready. | `probe_target_infer` | false | `"Refine classHint and rerun"` |
| `reasonCode` | Deterministic failure/disambiguation code for fail-closed routing. | `probe_target_infer` | false | `"target_ambiguous"` |
| `failedStep` | Stage where deterministic selection failed. | `probe_target_infer` | false | `"target_selection"` |
| `status=runtime_unreachable` | Fail-closed status when runtime line validation cannot reach probe endpoint. | `probe_target_infer` | false | `"runtime_unreachable"` |
| `reasonCode=additional_source_roots_invalid` | Input validation failed because one or more `additionalSourceRoots` paths are missing or non-directory. | `probe_target_infer` | false | `"additional_source_roots_invalid"` |
| `reasonCode=additional_source_roots_limit_exceeded` | Input validation failed because `additionalSourceRoots` exceeded max entry count (`10`). | `probe_target_infer` | false | `"additional_source_roots_limit_exceeded"` |

## probe_recipe_create

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `projectRoot` | Absolute project root selected by orchestrator and used for scoped recipe generation. | `probe_recipe_create` | true | `"C:\\repo\\catalog-service"` |
| `hints` | Effective input hints and actuation preferences (`classHint` must be exact FQCN). | `probe_recipe_create` | true | `{"classHint":"com.example.catalog.CatalogService","lineHint":88}` |
| `hints.additionalSourceRoots` | Effective normalized additional source roots included in static inference scope. | `probe_recipe_create` | false | `["C:\\repo\\core-module\\src\\main\\java"]` |
| `hints.apiBasePath` | Optional API context/base path provided by orchestrator and applied to request candidates/trigger paths (anti-duplication). | `probe_recipe_create` | false | `"/api/v1"` |
| `inferredTarget` | Best inferred runtime target for probe verification. | `probe_recipe_create` | false | `{"key":"com.example.CatalogService#save","line":88}` |
| `requestCandidates` | HTTP request candidates inferred from code-based synthesizer analysis. | `probe_recipe_create` | true | `[{"method":"POST","path":"/v1/catalog"}]` |
| `executionPlan` | Step plan emitted for execution/verification tooling. Report mode emits compact action-code steps. | `probe_recipe_create` | true | `{"selectedMode":"single_line_probe"}` |
| `executionPlan.routingReason` | Routing reason code for selected mode (`single_line_probe`, `regression_http_only_no_probe`, etc). | `probe_recipe_create` | true | `"regression_http_only_no_probe"` |
| `executionPlan.steps[].actionCode` | Compact step action code in report mode (no verbose instruction strings). | `probe_recipe_create` | false | `"request_candidate_missing"` |
| `resultType` | Output category (`recipe` or `report`). | `probe_recipe_create` | true | `"recipe"` |
| `status` | Recipe generation status for orchestration decisions (`*_ready` or fail-closed report status). | `probe_recipe_create` | true | `"single_line_probe_ready"` |
| `reasonCode` | Deterministic synthesis/report reason code for fail-closed routing. | `probe_recipe_create` | false | `"spring_entrypoint_not_proven"` |
| `reasonCode=target_ambiguous` | Multiple target candidates remained plausible for current `classHint`/`methodHint`, so orchestration failed closed before request synthesis. | `probe_recipe_create` | false | `"target_ambiguous"` |
| `reasonCode=target_type_not_found` | Resolver could not match `classHint` to a unique target type in scope. | `probe_recipe_create` | false | `"target_type_not_found"` |
| `reasonCode=target_type_ambiguous` | Resolver matched multiple target types and failed closed without picking one implicitly. | `probe_recipe_create` | false | `"target_type_ambiguous"` |
| `reasonCode=target_method_not_found` | Resolver matched target type but not the requested method hint. | `probe_recipe_create` | false | `"target_method_not_found"` |
| `reasonCode=project_root_invalid` | Resolver rejected project root during AST mapping resolution. | `probe_recipe_create` | false | `"project_root_invalid"` |
| `reasonCode=mapper_plugin_unavailable` | Java request-mapper/plugin bootstrap failed before entrypoint proof. | `probe_recipe_create` | false | `"mapper_plugin_unavailable"` |
| `reasonCode=additional_source_roots_invalid` | Input validation failed because one or more `additionalSourceRoots` paths are missing or non-directory. | `probe_recipe_create` | false | `"additional_source_roots_invalid"` |
| `reasonCode=additional_source_roots_limit_exceeded` | Input validation failed because `additionalSourceRoots` exceeded max entry count (`10`). | `probe_recipe_create` | false | `"additional_source_roots_limit_exceeded"` |
| `nextAction` (target candidate missing) | For `reasonCode=target_candidate_missing`, guidance is refined when class inventory proves an exact class match with zero method bodies (for example inherited implementation in another module root). | `probe_recipe_create` | false | `"Matched class has no method bodies in projectRootAbs. If methods are inherited, use parent module/source roots."` |
| `failedStep` | Specific synthesis stage that failed proof. | `probe_recipe_create` | false | `"spring_entrypoint_resolution"` |
| `reasonCode` (execution input gating) | When `status=execution_input_required`, reason maps to the first unresolved category (`auth_input_required`, `request_confirmation_required`, `actuation_input_required`, `line_target_required_for_probe_mode`, `request_candidate_missing`). | `probe_recipe_create` | false | `"request_confirmation_required"` |
| `failedStep` (execution input gating) | Stage marker paired with execution-input reason (`auth_resolution`, `request_confirmation`, `actuation_resolution`, `intent_routing`, `request_synthesis`). | `probe_recipe_create` | false | `"request_confirmation"` |
| `selectedMode` | Final routed intent mode. | `probe_recipe_create` | true | `"single_line_probe"` |
| `executionReadiness` | Execution gate (`ready` or `needs_user_input`). | `probe_recipe_create` | true | `"ready"` |
| `missingInputs` | Missing runtime/auth inputs blocking execution. | `probe_recipe_create` | true | `[]` |
| `synthesizerUsed` | Internal synthesizer plugin selected for request synthesis. | `probe_recipe_create` | false | `"spring"` |
| `applicationType` | Framework type derived from selected synthesizer (not runtime introspection). | `probe_recipe_create` | false | `"spring"` |
| `attemptedStrategies` | Ordered synthesis strategies attempted by the selected plugin. | `probe_recipe_create` | true | `["spring_annotation_mapping","spring_call_chain_resolution"]` |
| `evidence` | Compact evidence lines used for deterministic synthesis and pushback context. | `probe_recipe_create` | true | `["request_source=spring_mvc"]` |
| `trigger` | Protocol-aware trigger envelope emitted by synthesis. | `probe_recipe_create` | false | `{"kind":"http","method":"POST","path":"/v1/catalog"}` |
| `auth` | Auth inference result and next-step hints. | `probe_recipe_create` | true | `{"status":"ok","strategy":"bearer"}` |
| `notes` | Run notes and routing/inference diagnostics. Report mode is compact/failure-focused. | `probe_recipe_create` | true | `["execution_readiness=ready"]` |
| `notes[] (context_path_hint=...)` | Optional non-blocking prompt note when `apiBasePath` is not provided but request synthesis succeeds. | `probe_recipe_create` | false | `"context_path_hint=Optional apiBasePath (for example /api/v1) can be supplied..."` |
| `runtimeCapture` | Optional runtime capture preview from live probe status. | `probe_recipe_create` | false | `{"status":"available","capturePreview":{"captureId":"abc123"}}` |
| `runtimeCapture.lineValidation` | Optional line-validation hint from runtime capture enrich pass. | `probe_recipe_create` | false | `"invalid_line_target"` |
| `runtimeCapture.lineResolvable` | Optional line-resolvable hint from runtime capture enrich pass. | `probe_recipe_create` | false | `false` |
| `rendered` | Optional rendered template output when `outputTemplate` is supplied. | `probe_recipe_create` | false | `"Reproduction execution plan..."` |

## probe_enable

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Actuation request envelope sent to probe endpoint. | `probe_enable` | true | `{"url":"http://127.0.0.1:9191/__probe/actuate"}` |
| `response` | Raw endpoint response payload. | `probe_enable` | true | `{"status":200,"json":{"mode":"actuate"}}` |

## probe_get_status

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Status request details (canonical `key`, URL, timeout; `resolvedKey` appears only when canonicalization differs). | `probe_get_status` | true | `{"key":"com.example.Catalog#save:88"}` |
| `response` | Compact normalized status payload (`status` + essential `json` fields). | `probe_get_status` | true | `{"status":200,"json":{"hitCount":1}}` |
| `response.json.contractVersion` | Probe contract marker. | `probe_get_status` | false | `"0.1.0"` |
| `response.json.hitCount` | Probe hit counter for the line key. | `probe_get_status` | false | `1` |
| `response.json.lastHitEpoch` | Last hit Unix-epoch timestamp in JVM host wall-clock milliseconds. | `probe_get_status` | false | `1739671200000` |
| `response.json.lineValidation` | Line validation verdict (`resolvable` or `invalid_line_target`). | `probe_get_status` | false | `"resolvable"` |
| `response.json.capturePreview` | Compact runtime preview metadata from Java agent (`available`, `captureId`, timestamp, optional path list). | `probe_get_status` | false | `{"available":true,"captureId":"abc123"}` |
| `response.json.capturePreview.capturedAtEpoch` | Capture preview Unix-epoch timestamp in JVM host wall-clock milliseconds. | `probe_get_status` | false | `1739671200456` |
| `response.json.capturePreview.executionPaths` | Optional execution-path frames captured at runtime when `MCP_PROBE_INCLUDE_EXECUTION_PATHS=true`. | `probe_get_status` | false | `["CatalogController.listCatalogShoes()#42"]` |
| `response.json.runtime` | Runtime actuation/observe mode payload. | `probe_get_status` | false | `{"mode":"observe"}` |
| `response.json.runtime.appPort.value` | Runtime application port hint when inferable (`null` when unknown). | `probe_get_status` | false | `8082` |
| `response.json.runtime.appPort.source` | Source used to infer app port hint. | `probe_get_status` | false | `"system_property:server.port"` |
| `result` | Guidance block when runtime alignment fails. | `probe_get_status` | false | `{"reason":"invalid_line_target","actionCode":"runtime_not_aligned"}` |
| `mode` | Batch marker when `keys[]` is used. | `probe_get_status` | false | `"probe_batch"` |
| `operation` | Batch operation identifier. | `probe_get_status` | false | `"status"` |
| `summary` | Batch success/failure summary. | `probe_get_status` | false | `{"total":2,"ok":1,"failed":1}` |
| `results` | Batch per-key rows with probe outcome details. | `probe_get_status` | false | `[{"key":"...:88","apiOutcome":"ok"}]` |

## probe_get_capture

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Capture fetch request details. | `probe_get_capture` | true | `{"captureId":"abc123","url":"http://127.0.0.1:9191/__probe/capture?captureId=abc123"}` |
| `response` | Compact capture fetch response metadata (`status` only). | `probe_get_capture` | true | `{"status":200}` |
| `result.found` | Whether capture payload exists and was returned. | `probe_get_capture` | true | `true` |
| `result.capture` | Compact capture metadata (`captureId`, `methodKey`, timestamp, args/return/thrown presence flags). | `probe_get_capture` | false | `{"captureId":"abc123","argsCount":1,"hasReturnValue":true}` |
| `result.capture.capturedAtEpoch` | Capture Unix-epoch timestamp in JVM host wall-clock milliseconds. | `probe_get_capture` | false | `1739671200456` |
| `result.capture.executionPaths` | Optional execution-path frames when `MCP_PROBE_INCLUDE_EXECUTION_PATHS=true`. | `probe_get_capture` | false | `["CatalogService.save()#88"]` |
| `result.reason` | Error reason when capture is unavailable. | `probe_get_capture` | false | `"capture_not_found"` |

## probe_reset

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Reset selector request details (canonical `key`; optional `resolvedKey` only when transformed from input). | `probe_reset` | true | `{"key":"com.example.Catalog#save:88"}` |
| `response` | Compact reset response metadata (`status`, plus selector/reason metadata in batch mode). | `probe_reset` | true | `{"status":200}` |
| `result` | Guidance block when line target is invalid. | `probe_reset` | false | `{"reason":"invalid_line_target"}` |
| `mode` | Batch marker for multi-key/class reset. | `probe_reset` | false | `"probe_batch"` |
| `operation` | Batch operation identifier. | `probe_reset` | false | `"reset"` |
| `summary` | Batch outcome summary. | `probe_reset` | false | `{"total":3,"ok":2,"failed":1}` |
| `results` | Batch per-key reset rows. | `probe_reset` | false | `[{"key":"...:88","apiOutcome":"ok"}]` |

## probe_wait_for_hit

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Polling request and retry configuration (`key` canonical; optional `resolvedKey` only when transformed from input). | `probe_wait_for_hit` | true | `{"key":"com.example.Catalog#save:88","maxRetries":1}` |
| `request.waitStartEpoch` | Unix-epoch millisecond timestamp when current wait attempt started. | `probe_wait_for_hit` | false | `1773318672847` |
| `request.triggerWindowStartEpoch` | Reset-aware Unix-epoch start used for strict inline classification. | `probe_wait_for_hit` | false | `1773318658526` |
| `request.triggerLeadMs` | Milliseconds between wait start and trigger window start (`waitStartEpoch - triggerWindowStartEpoch`). | `probe_wait_for_hit` | false | `14321` |
| `baseline` | Baseline probe snapshot used for inline hit diffing. | `probe_wait_for_hit` | false | `{"hitCount":0,"lastHitEpoch":0}` |
| `result.hit` | Whether a hit was detected in current wait window. | `probe_wait_for_hit` | true | `true` |
| `result.inline` | Whether detected hit is inline to current execution window. | `probe_wait_for_hit` | true | `true` |
| `result.reason` | Failure reason when no inline hit is confirmed. | `probe_wait_for_hit` | false | `"timeout_no_inline_hit"` |
| `result.actionCode` | Action code for deterministic orchestrator next-step routing. | `probe_wait_for_hit` | false | `"line_not_executed_in_window"` |
| `result.nextAction` | Human-readable follow-up action. | `probe_wait_for_hit` | false | `"verify_trigger_path_or_branch_then_rerun_probe_wait_for_hit"` |
| `result.lastStatus` | Last observed probe status payload. | `probe_wait_for_hit` | false | `{"hitCount":0}` |

## Skill-Orchestrated Route Pushback (`mcp-java-dev-tools-line-probe-run`, `mcp-java-dev-tools-regression-suite`)

These fields are emitted by orchestration summaries in skill-guided runs when probe route resolution cannot be proven uniquely.

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `reasonCode` | Deterministic failure code (`toolchain_unavailable`, `probe_route_not_found`, `probe_route_ambiguous`). | `mcp-java-dev-tools-line-probe-run (summary), mcp-java-dev-tools-regression-suite (summary)` | true | `"probe_route_ambiguous"` |
| `attemptedCandidates` | Candidate runtime routes evaluated before pushback. | `mcp-java-dev-tools-line-probe-run (summary), mcp-java-dev-tools-regression-suite (summary)` | true | `[{"apiBase":"http://localhost:8082","probeBase":"http://localhost:9192"}]` |
| `validationResults` | Per-candidate validation outcomes (probe/API/line alignment checks). | `mcp-java-dev-tools-line-probe-run (summary), mcp-java-dev-tools-regression-suite (summary)` | true | `[{"probeReachable":true,"apiReachable":false}]` |
| `nextAction` | Action required from the user to proceed after pushback. | `mcp-java-dev-tools-line-probe-run (summary), mcp-java-dev-tools-regression-suite (summary)` | true | `"Provide a unique runtime/service selector or stop conflicting services."` |
| `reproSteps` | Ordered executable reproduction steps emitted for both success and pushback outputs. | `mcp-java-dev-tools-line-probe-run (summary), mcp-java-dev-tools-regression-suite (summary)` | true | `["1. Validate projectRootAbs", "2. Call probe_recipe_create", "3. Resolve runtime route"]` |


