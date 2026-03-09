# Synthesis Failure Codes

Spring synthesis uses deterministic, fail-closed reason codes:

- `spring_entrypoint_not_proven`: no proven Spring entrypoint route.
- `spring_mapping_not_proven`: mapping details incomplete.
- `request_candidate_missing`: request synthesis produced no executable candidate.
- `synthesizer_not_installed`: no compatible synthesizer plugin loaded.
- `framework_not_supported`: detected framework has no supported plugin.
