# Keycloak Discovery Reference

Goal: discover Keycloak auth server context for `projects.json`.

Evidence sources (in order):

1. `docker-compose*.yml` service image/name hints (`keycloak`).
2. Spring security issuer URI / auth server URL in app config.
3. explicit OpenID discovery URL pattern from issuer path.

Deterministic mapping:

1. `kind = "auth-server"`
2. `host` and `port` from proven issuer/base URL
3. `name = "keycloak"` when evidence matches keycloak service naming or endpoint pattern

Health check default (HTTP):

```json
{
  "id": "openid-config",
  "type": "http",
  "method": "GET",
  "url": "http://localhost:8081/realms/<realm>/.well-known/openid-configuration",
  "expect": { "status": 200 },
  "timeoutMs": 3000,
  "required": true
}
```

Fail-closed:

1. If auth server is proven but realm/URL cannot be deterministically built, return `discovery_ambiguous`.

