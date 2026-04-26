# Endpoint Table Result

Render markdown table using this exact base layout:

| Endpoint | Status | HTTP Code | Duration (ms) | Probe Coverage |
|---|---|---|---|---|
| `<endpoint>` | `<status>` | `<http_code>` | `<duration_ms>` | `<probe_coverage>` |

When memory metric is explicitly contract-defined, append this column:

| Endpoint | Status | HTTP Code | Duration (ms) | Probe Coverage | Memory (bytes) |
|---|---|---|---|---|---|
| `<endpoint>` | `<status>` | `<http_code>` | `<duration_ms>` | `<probe_coverage>` | `<memory_bytes>` |

Deterministic rules:

1. sort by `step.order` ascending
2. tie-break by endpoint text
3. use `n/a` for missing optional fields
4. for blocked/no-step runs, emit one placeholder row:
   - endpoint: `(no executed endpoints)`
5. `Probe Coverage` must use canonical enums:
   - `verified_line_hit`
   - `http_only_unverified_line`
   - `unknown`
   - `n/a` (placeholder row only)
