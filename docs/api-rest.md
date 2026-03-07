# REST API Reference

The WebClaw Gateway exposes a REST API for site configuration management, health monitoring, and static asset serving. All endpoints are served by the FastAPI application at the gateway's base URL.

## Base URL

| Environment | URL |
|:------------|:----|
| Local development | `http://127.0.0.1:8081` |
| Cloud Run (production) | `https://webclaw-gateway-HASH-uc.a.run.app` |

## Authentication

The MVP does not require authentication for REST endpoints. Production deployments should add API key authentication or OAuth for site management endpoints.

## Endpoints

### Health Check

```
GET /health
```

Returns the gateway's health status. Used by Cloud Run for liveness probes.

**Response:**

```json
{
  "status": "ok",
  "service": "webclaw-gateway"
}
```

**Status codes:** `200` always (if the server is running).

---

### Serve Embed Script

```
GET /embed.js
```

Returns the WebClaw embed script for inclusion in website HTML via `<script>` tag.

**Response:** JavaScript file (`application/javascript`)

**Status codes:**
- `200` — Script served successfully
- `404` — Script not built; returns `{"error": "Embed script not built yet. Run: cd embed && npm run build"}`

**Notes:**
- Looks for the script at `embed/dist/webclaw.js` (relative to gateway) or `gateway/static/webclaw.js`
- In production, consider serving from a CDN for better latency

---

### Create Site

```
POST /api/sites
```

Register a new site with WebClaw. Returns a generated `site_id`.

**Request body:**

```json
{
  "domain": "yoursite.com",
  "persona_name": "Aria",
  "persona_voice": "warm, professional, concise",
  "welcome_message": "Hi! I'm Aria. How can I help you today?",
  "knowledge_base": "We sell premium coffee. Free shipping over $30.",
  "allowed_actions": ["click", "scroll", "navigate", "highlight", "read", "select"],
  "restricted_actions": ["type"],
  "escalation_email": "support@yoursite.com"
}
```

**Request fields:**

| Field | Type | Required | Default | Description |
|:------|:-----|:--------:|:--------|:------------|
| `domain` | string | ✅ | — | Website domain for validation |
| `persona_name` | string | | `"WebClaw"` | Agent's display name |
| `persona_voice` | string | | `"friendly and helpful"` | Voice style guidance |
| `welcome_message` | string | | `"Hi! I'm here to help."` | First message on connect |
| `knowledge_base` | string | | `""` | Site-specific knowledge for agent context |
| `allowed_actions` | string[] | | all 8 actions | Permitted DOM operations |
| `restricted_actions` | string[] | | `[]` | Explicitly blocked DOM operations |
| `escalation_email` | string | | `""` | Email for human handoff |

**Response:**

```json
{
  "site_id": "a1b2c3d4",
  "config": {
    "site_id": "a1b2c3d4",
    "domain": "yoursite.com",
    "persona_name": "Aria",
    "persona_voice": "warm, professional, concise",
    "welcome_message": "Hi! I'm Aria. How can I help you today?",
    "knowledge_base": "We sell premium coffee. Free shipping over $30.",
    "allowed_actions": ["click", "scroll", "navigate", "highlight", "read", "select"],
    "restricted_actions": ["type"],
    "escalation_email": "support@yoursite.com",
    "max_actions_per_session": 100
  }
}
```

**Status codes:** `200` on success.

---

### List Sites

```
GET /api/sites
```

Returns all registered site configurations.

**Response:**

```json
{
  "sites": [
    {
      "site_id": "demo",
      "domain": "localhost",
      "persona_name": "Claw",
      ...
    },
    {
      "site_id": "a1b2c3d4",
      "domain": "yoursite.com",
      "persona_name": "Aria",
      ...
    }
  ]
}
```

---

### Get Site

```
GET /api/sites/{site_id}
```

Returns configuration for a specific site.

**Path parameters:**

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `site_id` | string | Site identifier (returned from POST) |

**Response:**

```json
{
  "config": {
    "site_id": "a1b2c3d4",
    "domain": "yoursite.com",
    ...
  }
}
```

**Status codes:**
- `200` — Site found
- `404` — `{"error": "Site not found"}`

---

### Update Site

```
PUT /api/sites/{site_id}
```

Update an existing site's configuration. Replaces all fields (not a partial update).

**Path parameters:**

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `site_id` | string | Site identifier |

**Request body:** Same schema as POST `/api/sites`.

**Response:**

```json
{
  "config": {
    "site_id": "a1b2c3d4",
    ...updated fields...
  }
}
```

**Status codes:**
- `200` — Updated successfully
- `404` — `{"error": "Site not found"}`

---

### Static File Serving

The gateway auto-mounts two static directories if they exist:

| Path | Directory | Purpose |
|:-----|:----------|:--------|
| `/embed/*` | `embed/dist/` | Built embed script and assets |
| `/demo/*` | `demo-site/` | Demo website (HTML serving enabled) |

---

## CORS

The gateway allows all origins:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

This is required because the embed script runs on arbitrary third-party domains. The WebSocket endpoint similarly accepts connections from any origin.

## Error Format

All error responses follow a consistent format:

```json
{
  "error": "Human-readable error message"
}
```

## Rate Limiting

The MVP does not implement rate limiting. For production:

- Use Cloud Run's `--max-instances` and `--concurrency` flags
- Add `slowapi` middleware for per-IP rate limiting
- Consider API keys for site management endpoints
