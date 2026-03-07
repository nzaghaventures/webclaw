# Troubleshooting

Common issues, debugging strategies, and frequently asked questions.

---

## Common Issues

### Gateway Won't Start

**Symptom:** `uvicorn main:app` fails with an import error.

**Causes and fixes:**

| Error | Cause | Fix |
|:------|:------|:----|
| `ModuleNotFoundError: google.adk` | Dependencies not installed | `pip install -r requirements.txt` |
| `ModuleNotFoundError: dotenv` | Missing python-dotenv | `pip install python-dotenv` |
| `IndentationError` | Code formatting issue | Check recent edits to `main.py` |
| `Address already in use` | Port 8081 occupied | Kill the existing process or use a different port |

**Check the virtual environment:**

```bash
which python3
# Should show: .../webclaw/gateway/.venv/bin/python3

source .venv/bin/activate  # If not activated
```

---

### WebSocket Connects Then Immediately Closes

**Symptom:** The embed script connects, then the WebSocket closes within seconds.

**Check the gateway logs:**

```
google.genai.errors.APIError: 1008 None. models/gemini-2.0-flash-live-001 is not found
```

**Fix:** The model name is outdated. Update `gateway/agent/agent.py`:

```python
root_agent = Agent(
    name="webclaw_agent",
    model="gemini-2.0-flash-exp-image-generation",  # supports bidiGenerateContent
    ...
)
```

**Other causes:**

| Log Message | Cause | Fix |
|:-----------|:------|:----|
| `1008 model not found` | Deprecated model | Update model name (see above) |
| `403 API key invalid` | Bad API key | Check `gateway/.env` |
| `429 Rate limited` | Too many requests | Wait and retry, or check quota |
| `1000 None` | Normal close after session | Expected; not an error |

---

### No Audio Playback

**Symptom:** The agent responds with text events but no audio plays.

**Causes:**

1. **Browser autoplay policy.** Most browsers require a user gesture (click) before allowing audio playback. The WebClaw overlay handles this by initializing `AudioContext` on the first user interaction.

2. **No audio response from model.** Check that `response_modalities` includes `"AUDIO"` in the `RunConfig`.

3. **Muted browser tab.** Chrome may auto-mute tabs. Right-click the tab and select "Unmute."

**Debug:** Open DevTools Console and look for:
```
[WebClaw] Audio chunk received (15360 bytes)
[WebClaw] AudioContext state: suspended  ← Problem: needs user gesture
```

---

### Embed Script 404

**Symptom:** `GET /embed.js` returns 404.

**Fix:** Build the embed script:

```bash
cd embed
npm install
npm run build
# → dist/webclaw.js
```

The gateway checks for `embed/dist/webclaw.js` relative to `gateway/main.py`.

---

### Microphone Not Working

**Symptom:** Clicking the mic button does nothing, or the browser shows no permission prompt.

**Checks:**

1. **HTTPS required.** `getUserMedia()` only works on `https://` or `localhost`. If testing on a non-localhost HTTP URL, the browser will block mic access.

2. **Permission denied.** Click the lock icon in the address bar → Site Settings → Microphone → Allow.

3. **Another app using the mic.** Close other apps that may have the microphone (Zoom, Teams, etc.).

4. **Extension mic permission.** For the Chrome extension, check `chrome://extensions` → WebClaw → Details → Site access → Permissions.

---

### Agent Cannot Find Elements

**Symptom:** The agent says "I couldn't find that element" or clicks the wrong thing.

**Causes and fixes:**

| Scenario | Fix |
|:---------|:----|
| Element has no ID or ARIA label | Be more specific: "Click the blue button that says Subscribe" |
| Element is inside an iframe | WebClaw cannot access cross-origin iframes |
| Element is dynamically loaded | Wait for the page to fully load before asking |
| Multiple matching elements | Specify position: "Click the first Add to Cart button" |
| Element is in Shadow DOM | WebClaw cannot access other Shadow DOM trees |

---

### CORS Errors

**Symptom:** Browser console shows `Access-Control-Allow-Origin` errors.

**Fix:** Ensure the gateway is running. The gateway allows all origins by default (`allow_origins=["*"]`). If the gateway is down, the browser will show a CORS error instead of a connection error.

---

### Extension Not Appearing

**Symptom:** After installing the extension, no overlay appears on pages.

**Checks:**

1. Extension is **enabled** in `chrome://extensions`
2. Try **Manual mode**: click the WebClaw toolbar icon → "Activate"
3. Check that the **gateway URL** in extension settings is correct
4. Look for errors in the **extension console**: `chrome://extensions` → WebClaw → "Inspect views: service worker"

---

## Debugging Strategies

### Gateway Side

**Enable debug logging:**

```python
# In gateway/main.py, change:
logging.basicConfig(level=logging.DEBUG)
```

This shows ADK and Gemini SDK internal logs including:
- Live connection establishment
- Session resumption handles
- Token usage
- Tool call details

**Test with curl:**

```bash
# Health check
curl http://localhost:8081/health

# Sites API
curl http://localhost:8081/api/sites

# Embed script
curl -I http://localhost:8081/embed.js
```

### Client Side

**Browser DevTools Console:**

All embed script operations log to the console with `[WebClaw]` prefix.

**Network Tab → WS filter:**

Inspect individual WebSocket frames:
- Green/outgoing: client messages (text, audio, DOM snapshots)
- Red/incoming: agent events (audio, text, tool calls)

**Test WebSocket with Python:**

```python
import asyncio, websockets, json

async def test():
    async with websockets.connect('ws://localhost:8081/ws/demo/test') as ws:
        await ws.send(json.dumps({'type': 'text', 'text': 'Hello!'}))
        async for msg in ws:
            data = json.loads(msg)
            if data.get('outputTranscription'):
                print(f"Agent: {data['outputTranscription']}")
            if data.get('turnComplete'):
                break

asyncio.run(test())
```

---

## FAQ

### Which Gemini models work with WebClaw?

Only models that support `bidiGenerateContent` (the Live API streaming method):

| Model | Status |
|:------|:-------|
| `gemini-2.0-flash-exp-image-generation` | **Recommended.** Supports text + audio. |
| `gemini-2.5-flash-native-audio-latest` | Works. Audio-only responses. |
| `gemini-2.0-flash-live-001` | **Deprecated.** No longer available. |

To check available models:

```python
from google import genai
client = genai.Client(api_key="your_key")
for m in client.models.list():
    if 'bidiGenerateContent' in (m.supported_actions or []):
        print(m.name)
```

### Can WebClaw work without voice?

Yes. Text-only mode works out of the box. Users type in the chat panel, and the agent responds with text. Voice (microphone + audio playback) is optional and can be disabled in the extension settings.

### Does WebClaw store user data?

No. The gateway passes data through without storing:
- **Audio:** Streamed to Gemini and discarded. Not logged or saved.
- **Text messages:** Held in the in-memory session during the connection. Lost on disconnect.
- **DOM snapshots:** Forwarded to Gemini as context. Not persisted.

With Firestore enabled (production), session metadata and site configurations are stored. Audio and DOM snapshots are still not persisted.

### Can I use WebClaw on mobile?

The embed script works on mobile browsers. The Chrome extension is desktop-only (Chrome does not support extensions on mobile). On mobile, the overlay appears as a small button that expands to a chat panel, similar to other chat widgets.

### How much does it cost to run?

For low traffic (< 1000 sessions/month), Cloud Run and Firestore free tiers cover most usage. The main cost is the Gemini API:
- Free tier: 15 requests/minute, 1M tokens/minute
- Paid: ~$0.10/1M input tokens, ~$0.40/1M output tokens

A typical session uses 2000-5000 tokens. At $0.40/1M output tokens, 1000 sessions costs roughly $1-2.

### Can multiple sites share one gateway?

Yes. Each site registers with a unique `site_id` and configuration. The gateway routes WebSocket connections to the correct site config based on the `site_id` in the URL path. A single Cloud Run instance can serve hundreds of sites.

### How do I update the knowledge base without restarting?

Use the PUT API endpoint. Changes take effect immediately for new sessions:

```bash
curl -X PUT http://localhost:8081/api/sites/YOUR_SITE_ID \
  -H "Content-Type: application/json" \
  -d '{"domain":"...","knowledge_base":"NEW CONTENT HERE",...}'
```

### Can the agent access data behind login walls?

The agent sees whatever the current page shows. If the user is logged in, the agent can see logged-in content. If the page requires authentication, the agent cannot bypass it. The agent operates within the user's browser session with the user's existing cookies and auth state.
