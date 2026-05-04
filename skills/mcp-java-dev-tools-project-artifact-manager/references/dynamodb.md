# DynamoDB Discovery Reference

Goal: discover DynamoDB Local or DynamoDB-connected context for `projects.json`.

Evidence sources (in order):

1. `docker-compose*.yml` service names/images containing `dynamodb`.
2. known local endpoint configuration in app config (for example `localhost:8000`).
3. AWS SDK endpoint override properties when explicitly configured.

Deterministic mapping:

1. `kind = "database"`
2. `name = "dynamodb-local"` when local endpoint is proven
3. `host` and `port` from explicit endpoint evidence

Health check default:

```json
{
  "id": "tcp-open",
  "type": "tcp",
  "target": "localhost:8000",
  "timeoutMs": 2000,
  "required": true
}
```

Fail-closed:

1. If dynamodb usage is inferred but endpoint cannot be proven, return `discovery_ambiguous`.

