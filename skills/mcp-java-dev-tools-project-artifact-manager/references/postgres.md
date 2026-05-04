# Postgres Discovery Reference

Goal: discover PostgreSQL as an external system candidate for `projects.json`.

Evidence sources (in order):

1. `docker-compose*.yml` service image/name hints (`postgres`).
2. service port mappings exposing `5432`.
3. Spring datasource host/port from `application*.yml` and `application*.properties`.

Deterministic mapping:

1. `kind = "database"`
2. `host` from compose host mapping or datasource host
3. `port` from compose published port or datasource port (default 5432 only when source proves postgres usage)

Health check default:

```json
{
  "id": "tcp-open",
  "type": "tcp",
  "target": "localhost:5432",
  "timeoutMs": 2000,
  "required": true
}
```

Fail-closed:

1. If postgres is indicated but host/port cannot be proven, return `discovery_ambiguous`.

