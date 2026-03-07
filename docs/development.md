# Local Development

This guide covers the development setup, build pipeline, project structure, and testing workflow for contributing to WebClaw.

## Development Setup

### System Requirements

| Tool | Minimum Version | Installation |
|:-----|:---------------|:-------------|
| Python | 3.10 | `brew install python@3.14` or [python.org](https://python.org) |
| Node.js | 18 | `nvm install 18` or [nodejs.org](https://nodejs.org) |
| npm | 9 | Comes with Node.js |
| Git | 2.x | `brew install git` or system default |

### Clone and Install

```bash
# Clone
git clone https://github.com/AfrexAI/webclaw.git
cd webclaw

# Gateway dependencies
cd gateway
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Embed script dependencies
cd embed
npm install
cd ..
```

### Environment Configuration

```bash
# Gateway environment
cat > gateway/.env << 'EOF'
GOOGLE_API_KEY=your_gemini_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
EOF
```

Get a free Gemini API key at [AI Studio](https://aistudio.google.com/apikey).

> **Note:** When both `GOOGLE_API_KEY` and `GEMINI_API_KEY` are set, the Google SDK prioritizes `GOOGLE_API_KEY`. Set both for compatibility.

## Running Locally

### Start the Gateway

```bash
cd gateway
source .venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8081 --reload
```

The `--reload` flag enables auto-restart on code changes. The gateway serves:

| URL | Content |
|:----|:--------|
| `http://localhost:8081/health` | Health check |
| `http://localhost:8081/embed.js` | Embed script |
| `http://localhost:8081/demo/` | Demo e-commerce site |
| `http://localhost:8081/api/sites` | Site configuration API |
| `ws://localhost:8081/ws/{site_id}/{session_id}` | WebSocket streaming |

### Build the Embed Script

```bash
cd embed
npm run build
```

Output: `dist/webclaw.js` (19.6KB minified IIFE bundle)

For development with watch mode:

```bash
# esbuild does not have a built-in watch, but you can use:
npx esbuild src/index.ts --bundle --minify --format=iife --outfile=dist/webclaw.js --watch
```

### Serve the Demo Site

The gateway automatically serves `demo-site/` at `/demo/`. No separate server needed.

Alternatively, for standalone serving:

```bash
python3 -m http.server 3000 -d demo-site
```

## Project Structure

```
webclaw/
├── gateway/                    # Python backend
│   ├── main.py                 # FastAPI app (302 lines)
│   ├── agent/
│   │   ├── agent.py            # ADK Agent definition
│   │   ├── prompts.py          # System prompts
│   │   └── tools.py            # 8 DOM tools
│   ├── context/
│   │   └── broker.py           # Site config + context broker
│   ├── voice/                  # Voice pipeline (reserved)
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env                    # API keys (gitignored)
│
├── embed/                      # TypeScript client bundle
│   ├── src/
│   │   ├── index.ts            # Entry + overlay UI (420 lines)
│   │   ├── gateway-client.ts   # WebSocket client (147 lines)
│   │   ├── audio.ts            # Mic capture + playback (106 lines)
│   │   ├── avatar.ts           # Canvas 2D avatar (225 lines)
│   │   ├── dom-actions.ts      # Action executor (148 lines)
│   │   ├── dom-snapshot.ts     # DOM serializer (128 lines)
│   │   └── overlay.ts          # Panel UI (267 lines)
│   ├── dist/
│   │   └── webclaw.js          # Built bundle (19.6KB)
│   ├── package.json
│   └── tsconfig.json
│
├── extension/                  # Chrome extension (MV3)
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── content.js              # Content script (313 lines)
│   ├── background.js           # Service worker
│   └── icons/
│
├── demo-site/                  # Demo e-commerce site
│   └── index.html              # TechByte Store
│
├── diagrams/                   # Mermaid sources + SVG exports
│   ├── d1-system-architecture.mmd / .svg
│   ├── d2-site-agent-sequence.mmd / .svg
│   ├── d3-personal-agent-sequence.mmd / .svg
│   └── d4-asymmetric-privacy.mmd / .svg
│
├── infra/                      # GCP infrastructure
│   ├── main.tf                 # Terraform (137 lines)
│   ├── deploy.sh               # Quick deploy script
│   └── terraform.tfvars.example
│
├── docs/                       # Documentation
├── CONCEPT.md                  # Design vision
├── CHALLENGE.md                # Hackathon rules
└── README.md                   # Project overview
```

## Build Pipeline

### Embed Script

The embed script uses esbuild to compile TypeScript and bundle all modules into a single IIFE:

```json
// package.json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --minify --format=iife --outfile=dist/webclaw.js"
  }
}
```

**Why esbuild:**
- 2ms build time (vs seconds with Webpack/Rollup)
- 19.6KB output (zero runtime dependencies)
- IIFE format executes immediately via `<script>` tag
- No module system required on the host page

**Bundle composition:**

| Module | Approximate Size |
|:-------|:----------------|
| `index.ts` + `overlay.ts` | ~8KB |
| `gateway-client.ts` | ~2KB |
| `audio.ts` | ~2KB |
| `avatar.ts` | ~4KB |
| `dom-actions.ts` | ~2KB |
| `dom-snapshot.ts` | ~1.6KB |
| **Total (minified)** | **19.6KB** |

### Gateway

No build step required. Python files are loaded directly by uvicorn. The gateway uses standard Python packaging with `requirements.txt`.

### Chrome Extension

No build step required. The extension uses vanilla JavaScript and is loaded directly by Chrome.

### Diagrams

Mermaid diagrams are rendered to SVG using the `mmdc` CLI:

```bash
cd diagrams
for f in *.mmd; do
  mmdc -i "$f" -o "${f%.mmd}.svg" -t dark -b transparent
done
```

Requires: `npm install -g @mermaid-js/mermaid-cli`

## Key Files

### Gateway: `main.py`

The main application file. Contains:
- FastAPI app setup with CORS middleware
- REST endpoints for site management
- WebSocket endpoint with upstream/downstream task pattern
- Static file serving for embed script and demo site

### Agent: `agent/agent.py`

Single-file agent definition:

```python
root_agent = Agent(
    name="webclaw_agent",
    model="gemini-2.0-flash-exp-image-generation",
    instruction=WEBCLAW_SYSTEM_PROMPT,
    tools=DOM_TOOLS,
)
```

To change the model, edit this file. Only models supporting `bidiGenerateContent` work with the Live API. Currently verified:
- `gemini-2.0-flash-exp-image-generation` (recommended)
- `gemini-2.5-flash-native-audio-latest`

### Context: `context/broker.py`

In-memory site configuration store. The `build_agent_context()` function is called at the start of every WebSocket session to inject site-specific knowledge into the agent.

To add Firestore persistence, replace `_site_configs` dict with Firestore reads/writes while keeping the same interface.

## Debugging

### Gateway Logs

The gateway uses Python's `logging` module at INFO level:

```
2026-03-06 15:30:11 - webclaw.gateway - INFO - WebSocket connect: site=demo session=test123
2026-03-06 15:30:11 - google_adk - INFO - Establishing live connection for agent: webclaw_agent
2026-03-06 15:30:12 - google_adk - INFO - Update session resumption handle: ...
```

Set `DEBUG` level for verbose ADK and Gemini SDK logs:

```python
logging.basicConfig(level=logging.DEBUG)
```

### Browser Console

The embed script logs to the browser console. Open DevTools (F12) → Console:

```
[WebClaw] Initializing with site_id=demo gateway=http://localhost:8081
[WebClaw] Shadow DOM created
[WebClaw] WebSocket connecting...
[WebClaw] Connected
[WebClaw] DOM snapshot sent (2341 chars)
```

### WebSocket Inspector

Use the browser's Network tab → WS filter to inspect WebSocket frames:
- **Green frames:** Client → Server (your messages, audio, DOM snapshots)
- **Red frames:** Server → Client (agent responses, audio, tool calls)

### Common Issues

| Issue | Cause | Fix |
|:------|:------|:----|
| `embed.js` returns 404 | Embed not built | `cd embed && npm run build` |
| WebSocket connects then closes | Bad API key | Check `gateway/.env` |
| Model not found error | Deprecated model | Update model in `agent/agent.py` |
| No audio playback | Browser autoplay policy | User must interact first (click) |
| CORS error in console | Gateway not running | Start gateway on correct port |
| `AudioContext not allowed` | No user gesture | Requires click before audio init |

## Git Workflow

The project uses conventional commits:

```
feat(gateway): add session resumption support
fix(embed): resolve audio playback on Safari
docs: add WebSocket protocol reference
refactor(agent): extract prompt builder function
chore: update dependencies
```

## Dependencies

### Gateway (Python)

| Package | Version | Purpose |
|:--------|:--------|:--------|
| `google-adk` | 1.26.0 | Agent Development Kit |
| `google-genai` | 1.66.0 | Gemini API client |
| `fastapi` | 0.135.1 | Async web framework |
| `uvicorn` | 0.41.0 | ASGI server |
| `python-dotenv` | — | Environment file loading |
| `google-cloud-firestore` | — | Firestore client (production) |

### Embed (Node.js)

| Package | Version | Purpose |
|:--------|:--------|:--------|
| `esbuild` | — | TypeScript bundler |
| `typescript` | — | Type checking |

No runtime dependencies. The bundle is self-contained.
