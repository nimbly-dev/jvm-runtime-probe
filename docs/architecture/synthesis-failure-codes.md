# Synthesis Failure Codes

Spring synthesis uses deterministic, fail-closed reason codes:

- `spring_entrypoint_not_proven`: no proven Spring entrypoint route.
- `spring_mapping_not_proven`: mapping details incomplete.
- `project_root_invalid`: selected project root is invalid for AST resolution.
- `target_type_not_found`: class/type hint could not be resolved.
- `target_type_ambiguous`: class/type hint resolved to multiple candidates.
- `target_method_not_found`: method hint could not be resolved on the target type.
- `mapper_plugin_unavailable`: Java request-mapper plugin/bootstrap is unavailable.
- `request_candidate_missing`: request synthesis produced no executable candidate.
- `synthesizer_not_installed`: no compatible synthesizer plugin loaded.
- `framework_not_supported`: detected framework has no supported plugin.
