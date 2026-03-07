# Data Fields Reference (0.1.0v)

This document is the simple dictionary of JSON fields emitted to the orchestrator via MCP tool outputs.

Column meanings:
- `fieldName`: JSON path emitted in `structuredContent`.
- `fieldDesc`: What the field means.
- `toolUsedBy`: Tool that emits the field.
- `required`: `true` when always present for that tool output shape, otherwise `false`.
- `exampleValue`: Representative value.

## debug_check

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `ok` | Basic service health flag. | `debug_check` | true | `true` |
| `serverTime` | Server timestamp when ping response is produced. | `debug_check` | true | `"2026-03-07T04:00:00.000Z"` |
| `version` | MCP server version. | `debug_check` | true | `"0.1.0"` |

## project_list

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `workspaceRoot` | Workspace root used for discovery. | `project_list` | true | `"C:\\repo\\workspace"` |
| `maxJavaFilesPerProject` | Per-project Java scan cap. | `project_list` | true | `300` |
| `defaultProjectId` | Auto-selected project id when unambiguous. | `project_list` | false | `"catalog-service"` |
| `projects` | Discovered project list. | `project_list` | true | `[{"id":"catalog-service"}]` |
| `projects[].id` | Stable project identifier. | `project_list` | true | `"catalog-service"` |
| `projects[].root` | Absolute project root path. | `project_list` | true | `"C:\\repo\\workspace\\catalog-service"` |
| `projects[].build` | Build system marker. | `project_list` | true | `"maven"` |
| `projects[].probeScope.suggestedInclude` | Suggested Java package include glob for probe agent. | `project_list` | false | `"com.example.catalog.**"` |

## probe_check

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `config` | Effective diagnose call configuration. | `probe_check` | true | `{"baseUrl":"http://127.0.0.1:9191"}` |
| `checks` | Aggregated endpoint checks. | `probe_check` | true | `{"reset":{"ok":true},"status":{"ok":true}}` |
| `checks.reset` | Reset endpoint diagnostic result. | `probe_check` | true | `{"ok":true,"status":200}` |
| `checks.status` | Status endpoint diagnostic result. | `probe_check` | true | `{"ok":true,"keyDecodingOk":true}` |
| `recommendations` | Operator follow-up hints when check fails. | `probe_check` | true | `[]` |

## probe_target_infer

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `resultType` | Target infer response mode (`report`, `class_methods`, `disambiguation`). | `probe_target_infer` | false | `"class_methods"` |
| `status` | Inference status code for next-step routing. | `probe_target_infer` | false | `"ok"` |
| `workspaceRoot` | Workspace root used for inference. | `probe_target_infer` | true | `"C:\\repo\\workspace"` |
| `hints` | Input hints used for inference. | `probe_target_infer` | true | `{"classHint":"CatalogService"}` |
| `projectResolution` | Project selection diagnostics. | `probe_target_infer` | true | `{"mode":"single_project"}` |
| `scannedJavaFiles` | Approximate Java file scan count. | `probe_target_infer` | false | `412` |
| `candidates` | Ranked target candidates for runtime probe keying. | `probe_target_infer` | false | `[{"key":"com.example.Catalog#save"}]` |
| `class` | Selected class block in `class_methods` mode. | `probe_target_infer` | false | `{"fqcn":"com.example.CatalogController"}` |
| `methods` | Method spans for selected class in `class_methods` mode. | `probe_target_infer` | false | `[{"methodName":"save","startLine":42}]` |
| `nextAction` | Required follow-up action when status is non-ready. | `probe_target_infer` | false | `"Refine classHint and rerun"` |

## probe_recipe_create

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `workspaceRoot` | Workspace root used for recipe generation. | `probe_recipe_create` | true | `"C:\\repo\\workspace"` |
| `projectRoot` | Selected project root for inference/auth resolution. | `probe_recipe_create` | true | `"C:\\repo\\workspace\\catalog-service"` |
| `hints` | Effective input hints and actuation preferences. | `probe_recipe_create` | true | `{"classHint":"CatalogService","lineHint":88}` |
| `projectResolution` | Project disambiguation summary. | `probe_recipe_create` | true | `{"mode":"single_project"}` |
| `inferredTarget` | Best inferred runtime target for probe verification. | `probe_recipe_create` | false | `{"key":"com.example.CatalogService#save","line":88}` |
| `requestCandidates` | HTTP request candidates inferred from controller/schema analysis. | `probe_recipe_create` | true | `[{"method":"POST","path":"/v1/catalog"}]` |
| `executionPlan` | Step plan emitted for execution/verification tooling. | `probe_recipe_create` | true | `{"selectedMode":"single_line_probe"}` |
| `resultType` | Output category (`recipe` or `report`). | `probe_recipe_create` | true | `"recipe"` |
| `status` | Recipe generation status for orchestration decisions. | `probe_recipe_create` | true | `"single_line_probe_ready"` |
| `selectedMode` | Final routed intent mode. | `probe_recipe_create` | true | `"single_line_probe"` |
| `executionReadiness` | Execution gate (`ready` or `needs_user_input`). | `probe_recipe_create` | true | `"ready"` |
| `missingInputs` | Missing runtime/auth inputs blocking execution. | `probe_recipe_create` | true | `[]` |
| `auth` | Auth inference result and next-step hints. | `probe_recipe_create` | true | `{"status":"ok","strategy":"bearer"}` |
| `notes` | Run notes and routing/inference diagnostics. | `probe_recipe_create` | true | `["result_type=recipe"]` |
| `runtimeCapture` | Optional runtime capture preview from live probe status. | `probe_recipe_create` | false | `{"status":"available","capturePreview":{"captureId":"abc123"}}` |
| `rendered` | Optional rendered template output when `outputTemplate` is supplied. | `probe_recipe_create` | false | `"Reproduction execution plan..."` |

## probe_enable

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Actuation request envelope sent to probe endpoint. | `probe_enable` | true | `{"url":"http://127.0.0.1:9191/__probe/actuate"}` |
| `response` | Raw endpoint response payload. | `probe_enable` | true | `{"status":200,"json":{"mode":"actuate"}}` |

## probe_get_status

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Status request details (key, URL, timeout). | `probe_get_status` | true | `{"resolvedKey":"com.example.Catalog#save:88"}` |
| `response` | Raw endpoint response after MCP normalization. | `probe_get_status` | true | `{"status":200,"json":{"hitCount":1}}` |
| `response.json.contractVersion` | Probe contract marker. | `probe_get_status` | false | `"0.1.0v"` |
| `response.json.hitCount` | Probe hit counter for the line key. | `probe_get_status` | false | `1` |
| `response.json.lastHitEpochMs` | Last hit timestamp in epoch milliseconds. | `probe_get_status` | false | `1739671200000` |
| `response.json.lineValidation` | Line validation verdict (`resolvable` or `invalid_line_target`). | `probe_get_status` | false | `"resolvable"` |
| `response.json.capturePreview` | Lightweight runtime payload preview from Java agent. | `probe_get_status` | false | `{"available":true,"captureId":"abc123"}` |
| `response.json.runtime` | Runtime actuation/observe mode payload. | `probe_get_status` | false | `{"mode":"observe"}` |
| `result` | Guidance block when runtime alignment fails. | `probe_get_status` | false | `{"reason":"invalid_line_target","actionCode":"runtime_not_aligned"}` |
| `mode` | Batch marker when `keys[]` is used. | `probe_get_status` | false | `"probe_batch"` |
| `operation` | Batch operation identifier. | `probe_get_status` | false | `"status"` |
| `summary` | Batch success/failure summary. | `probe_get_status` | false | `{"total":2,"ok":1,"failed":1}` |
| `results` | Batch per-key rows with probe outcome details. | `probe_get_status` | false | `[{"key":"...:88","apiOutcome":"ok"}]` |

## probe_get_capture

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Capture fetch request details. | `probe_get_capture` | true | `{"captureId":"abc123","url":"http://127.0.0.1:9191/__probe/capture?captureId=abc123"}` |
| `response` | Raw `/__probe/capture` HTTP response payload. | `probe_get_capture` | true | `{"status":200,"json":{"capture":{"captureId":"abc123"}}}` |
| `result.found` | Whether capture payload exists and was returned. | `probe_get_capture` | true | `true` |
| `result.capture` | Full stored capture payload when found. | `probe_get_capture` | false | `{"methodKey":"com.example.Catalog#save","args":[...]}` |
| `result.reason` | Error reason when capture is unavailable. | `probe_get_capture` | false | `"capture_not_found"` |

## probe_reset

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Reset selector request details. | `probe_reset` | true | `{"resolvedKey":"com.example.Catalog#save:88"}` |
| `response` | Raw reset endpoint response payload. | `probe_reset` | true | `{"status":200,"json":{"ok":true}}` |
| `result` | Guidance block when line target is invalid. | `probe_reset` | false | `{"reason":"invalid_line_target"}` |
| `mode` | Batch marker for multi-key/class reset. | `probe_reset` | false | `"probe_batch"` |
| `operation` | Batch operation identifier. | `probe_reset` | false | `"reset"` |
| `summary` | Batch outcome summary. | `probe_reset` | false | `{"total":3,"ok":2,"failed":1}` |
| `results` | Batch per-key reset rows. | `probe_reset` | false | `[{"key":"...:88","apiOutcome":"ok"}]` |

## probe_wait_for_hit

| fieldName | fieldDesc | toolUsedBy | required | exampleValue |
| --- | --- | --- | --- | --- |
| `request` | Polling request and retry configuration. | `probe_wait_for_hit` | true | `{"resolvedKey":"com.example.Catalog#save:88","maxRetries":1}` |
| `baseline` | Baseline probe snapshot used for inline hit diffing. | `probe_wait_for_hit` | false | `{"hitCount":0,"lastHitEpochMs":0}` |
| `result.hit` | Whether a hit was detected in current wait window. | `probe_wait_for_hit` | true | `true` |
| `result.inline` | Whether detected hit is inline to current execution window. | `probe_wait_for_hit` | true | `true` |
| `result.reason` | Failure reason when no inline hit is confirmed. | `probe_wait_for_hit` | false | `"timeout_no_inline_hit"` |
| `result.actionCode` | Action code for deterministic orchestrator next-step routing. | `probe_wait_for_hit` | false | `"line_not_executed_in_window"` |
| `result.nextAction` | Human-readable follow-up action. | `probe_wait_for_hit` | false | `"verify_trigger_path_or_branch_then_rerun_probe_wait_for_hit"` |
| `result.lastStatus` | Last observed probe status payload. | `probe_wait_for_hit` | false | `{"hitCount":0}` |


