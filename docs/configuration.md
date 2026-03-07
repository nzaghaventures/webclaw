# Configuration Reference

All configuration options for WebClaw sites, agents, and infrastructure.

---

## Site Configuration

Site configuration is managed through the REST API (`POST /api/sites`, `PUT /api/sites/{id}`).

### Fields

| Field | Type | Default | Required | Description |
|:------|:-----|:--------|:---------|:-----------|
| `domain` | string | — | Yes | Website domain for validation |
| `persona_name` | string | `"WebClaw"` | No | Agent's display name |
| `persona_voice` | string | `"friendly and helpful"` | No | Voice style description for Gemini |
| `welcome_message` | string | `"Hi! I'm here to help."` | No | First-connect greeting |
| `knowledge_base` | string | `""` | No | Free-text knowledge for Q&A |
| `allowed_actions` | string[] | `["click","type","scroll","navigate","highlight","read","select","check"]` | No | Permitted DOM actions |
| `restricted_actions` | string[] | `[]` | No | Blocked actions |
| `escalation_email` | string | `""` | No | Human handoff contact |
| `max_actions_per_session` | int | `100` | No | Rate limit per session |

### Action Values

| Value | Description |
|:------|:-----------|
| `click` | Click elements (buttons, links, tabs) |
| `type` | Type into input fields |
| `scroll` | Scroll page or to elements |
| `navigate` | Navigate to URLs |
| `highlight` | Highlight elements with glow effect |
| `read` | Extract text content |
| `select` | Choose dropdown options |
| `check` | Toggle checkboxes |

### Preset Configurations

**Read-only (information agent):**
```json
{
  "allowed_actions": ["read", "highlight", "scroll"],
  "restricted_actions": ["click", "type", "navigate", "select", "check"]
}
```

**No form filling:**
```json
{
  "allowed_actions": ["click", "scroll", "navigate", "highlight", "read", "select"],
  "restricted_actions": ["type"]
}
```

**Full access:**
```json
{
  "allowed_actions": ["click", "type", "scroll", "navigate", "highlight", "read", "select", "check"],
  "restricted_actions": []
}
```

---

## Embed Script Attributes

HTML attributes on the `<script>` tag that configure the embed script.

| Attribute | Default | Description |
|:----------|:--------|:-----------|
| `data-site-id` | `"demo"` | Registered site identifier |
| `data-gateway` | `"http://localhost:8080"` | Gateway URL (HTTP or HTTPS) |
| `data-position` | `"bottom-right"` | Overlay position: `bottom-right`, `bottom-left` |
| `data-theme` | `"light"` | Color theme: `light`, `dark` |
| `data-color` | `"#4285f4"` | Primary accent color (hex) |

### Example

```html
<script src="https://gateway.webclaw.dev/embed.js"
        data-site-id="a1b2c3d4"
        data-gateway="https://gateway.webclaw.dev"
        data-position="bottom-right"
        data-theme="dark"
        data-color="#1a1a2e">
</script>
```

---

## Chrome Extension Settings

Configured via the extension popup UI.

| Setting | Default | Storage Key | Description |
|:--------|:--------|:------------|:-----------|
| Gateway URL | `http://localhost:8081` | `gatewayUrl` | WebClaw Gateway address |
| Auto-Activate | `false` | `autoActivate` | Activate on every page load |
| Voice Mode | `true` | `voiceMode` | Enable microphone capture |
| Send DOM Snapshots | `true` | `sendDomSnapshots` | Send page structure to agent |

Settings are stored in `chrome.storage.sync` and persist across browser sessions.

---

## Gateway Environment Variables

Set in `gateway/.env` (development) or Cloud Run environment (production).

| Variable | Required | Description |
|:---------|:---------|:-----------|
| `GOOGLE_API_KEY` | Yes | Gemini API key. Takes priority when both are set. |
| `GEMINI_API_KEY` | No | Gemini API key (alternative). Used if `GOOGLE_API_KEY` is not set. |
| `GOOGLE_GENAI_USE_VERTEXAI` | No | Set to `"TRUE"` to use Vertex AI instead of AI Studio. Default: `"FALSE"`. |
| `GOOGLE_CLOUD_PROJECT` | No | GCP project ID. Required for Firestore and Vertex AI. |

### Environment File

```bash
# gateway/.env
GOOGLE_API_KEY=AIzaSy...
GEMINI_API_KEY=AIzaSy...
```

The `.env` file is gitignored. Never commit API keys.

---

## Agent Configuration

### Model

Set in `gateway/agent/agent.py`:

```python
root_agent = Agent(
    name="webclaw_agent",
    model="gemini-2.0-flash-exp-image-generation",
    ...
)
```

**Models supporting `bidiGenerateContent`:**

| Model | Features |
|:------|:---------|
| `gemini-2.0-flash-exp-image-generation` | Text + audio + image generation. Recommended. |
| `gemini-2.5-flash-native-audio-latest` | Audio-only (no `generateContent`). Best voice quality. |
| `gemini-2.5-flash-native-audio-preview-09-2025` | Preview version. |
| `gemini-2.5-flash-native-audio-preview-12-2025` | Preview version. |

### System Prompt

The base system prompt is in `gateway/agent/prompts.py`. Key sections:

| Section | Content |
|:--------|:--------|
| Identity | "You are WebClaw, a personal live agent..." |
| Behavior | Conversational, concise, explains actions |
| Capabilities | See, navigate, fill forms, scroll, read, highlight, search |
| Rules | No payment without confirmation, no passwords, stay on domain |

The prompt is extended per-site with knowledge base, persona, and action permissions via `build_site_prompt()`.

### Run Configuration

Set in `gateway/main.py` when creating `RunConfig`:

| Parameter | Value | Description |
|:----------|:------|:-----------|
| `streaming_mode` | `StreamingMode.BIDI` | Bidirectional streaming (required for Live API) |
| `response_modalities` | `["AUDIO"]` | Agent responds with audio |
| `session_resumption` | Enabled | Allows reconnection to interrupted sessions |
| `input_audio_transcription` | Enabled (native audio models) | Transcribes user speech |
| `output_audio_transcription` | Enabled (native audio models) | Transcribes agent speech |

---

## Terraform Variables

Set in `infra/terraform.tfvars`:

| Variable | Type | Default | Required | Description |
|:---------|:-----|:--------|:---------|:-----------|
| `project_id` | string | — | Yes | GCP project ID |
| `region` | string | `"us-central1"` | No | GCP region |
| `gemini_api_key` | string (sensitive) | — | Yes | Gemini API key |

### Example

```hcl
# terraform.tfvars
project_id     = "webclaw-prod"
region         = "us-central1"
gemini_api_key = "AIzaSy..."
```

---

## DOM Snapshot Configuration

Configured as constants in `embed/src/dom-snapshot.ts`:

| Constant | Value | Description |
|:---------|:------|:-----------|
| Max depth | 3 | DOM tree traversal depth limit |
| Max chars | 4000 | Output character limit |
| Included tags | `button`, `a`, `input`, `select`, `textarea`, `h1`-`h6`, `p`, `li`, `nav`, `main`, `section`, `article`, `form` | Tags included in snapshot |
| Excluded tags | `script`, `style`, `svg`, `noscript` | Tags skipped entirely |

---

## Audio Configuration

### Microphone Capture (`audio.ts`)

| Parameter | Value | Description |
|:----------|:------|:-----------|
| Sample rate | 16,000 Hz | Gemini input requirement |
| Bit depth | 16-bit | PCM signed integers |
| Channels | Mono | Single channel |
| Buffer size | 4096 samples | Processing chunk size |

### Audio Playback (`audio.ts`)

| Parameter | Value | Description |
|:----------|:------|:-----------|
| Sample rate | 24,000 Hz | Gemini output format |
| Bit depth | 16-bit | PCM from base64 |
| Channels | Mono | Single channel |

---

## Avatar Configuration (`avatar.ts`)

| Parameter | Value | Description |
|:----------|:------|:-----------|
| Canvas size | 48x48 px (FAB), 64x64 px (panel) | Rendering resolution |
| Frame rate | 60 fps | `requestAnimationFrame` loop |
| Blink interval | 3-5 seconds | Random interval between eye blinks |
| Mouth sync | AudioNode or sinusoidal | Real lip-sync when AudioNode connected |

### State Colors

| State | Glow Color | Description |
|:------|:-----------|:-----------|
| Idle | None | Subtle breathing animation |
| Listening | Blue (`#4285f4`) | Mic active, eyes attentive |
| Speaking | Green (`#34a853`) | Lip-sync, gentle bounce |
| Thinking | Yellow (`#fbbc05`) | Spinning arc indicator |
| Acting | Orange (`#ea4335`) | Lightning bolt, executing action |
