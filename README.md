# 🦀 WebClaw

**Personal Live Agent for Website Operations and Support**

WebClaw is a voice-first AI agent that lives on websites. It can see the page, hear users speak, talk back, and take actions on the site: clicking buttons, filling forms, navigating, and answering questions using site-specific knowledge.

Built with [Google ADK](https://google.github.io/adk-docs/) and the [Gemini Live API](https://ai.google.dev/gemini-api/docs/live) for real-time, bidirectional voice streaming.

> 🏆 Entry for the [Gemini Live Agent Challenge](https://googleai.devpost.com/) — Live Agents category

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    User's Browser                     │
│  ┌─────────────┐  ┌──────────────────────────────┐   │
│  │   Embed.js   │  │   Chrome Extension           │   │
│  │  (<script>)  │  │   (Personal WebClaw)         │   │
│  │  Site Agent  │  │   Works on any site          │   │
│  └──────┬───────┘  └────────────┬─────────────────┘   │
│         │  WebSocket (audio+text+DOM)  │              │
└─────────┼──────────────────────────────┼──────────────┘
          │                              │
          ▼                              ▼
┌──────────────────────────────────────────────────────┐
│              WebClaw Gateway (Cloud Run)              │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │  FastAPI │  │  ADK     │  │  Context Broker   │   │
│  │  WebSock │──│  Agent   │──│  (Knowledge +     │   │
│  │  Server  │  │  Runner  │  │   Permissions)    │   │
│  └─────────┘  └──────────┘  └───────────────────┘   │
│                     │                                 │
│              Gemini Live API                          │
│         (Bidirectional Audio Streaming)                │
└──────────────────────────────────────────────────────┘
```

## Two Modes

### 1. Site Agent (Embed Script)
Site owners add a single `<script>` tag. WebClaw appears as a chat overlay with voice support, pre-loaded with site-specific knowledge.

```html
<script src="https://your-gateway.run.app/embed.js"
        data-site-id="YOUR_SITE_ID"
        data-gateway="https://your-gateway.run.app">
</script>
```

### 2. Personal Agent (Chrome Extension)
Users install the extension to bring WebClaw to any website. Persistent mic permissions, cross-site memory, and personal preferences.

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- [Gemini API key](https://aistudio.google.com/apikey)

### 1. Gateway Backend

```bash
cd gateway
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create .env from example
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY

# Run
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

### 2. Embed Script

```bash
cd embed
npm install
npm run build    # Produces dist/webclaw.js (16KB)
```

### 3. Demo Site

```bash
# Just open in browser (uses localhost:8080 gateway)
open demo-site/index.html
```

### 4. Chrome Extension

```bash
# Load as unpacked extension in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer Mode
# 3. Click "Load unpacked" → select extension/ folder
```

## Deploy to GCP

### Using deploy script:
```bash
cd infra
./deploy.sh YOUR_PROJECT_ID us-central1
```

### Using Terraform:
```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
terraform init
terraform apply
```

## Project Structure

```
webclaw/
├── gateway/              # Python FastAPI backend
│   ├── main.py           # WebSocket server + REST API
│   ├── agent/            # ADK agent definition
│   │   ├── agent.py      # Root agent (Gemini Live)
│   │   ├── prompts.py    # System prompts
│   │   └── tools.py      # 8 DOM action tools
│   ├── context/          # Knowledge base + permissions
│   │   └── broker.py     # Site config management
│   ├── Dockerfile        # Cloud Run container
│   └── requirements.txt
├── embed/                # Client-side embed script
│   └── src/
│       ├── index.ts      # Overlay UI (Shadow DOM)
│       ├── gateway-client.ts  # WebSocket client
│       ├── audio.ts      # Mic capture + playback
│       ├── dom-actions.ts # Execute agent actions
│       └── dom-snapshot.ts # DOM serializer
├── extension/            # Chrome MV3 extension
│   ├── manifest.json
│   ├── popup.html/js     # Settings UI
│   ├── content.js        # Page injection + agent
│   └── background.js     # Service worker
├── demo-site/            # Example e-commerce site
│   └── index.html        # TechByte Store
├── infra/                # GCP deployment
│   ├── main.tf           # Terraform (Cloud Run, Firestore, etc.)
│   └── deploy.sh         # One-command deploy
├── CONCEPT.md            # Full design document
└── CHALLENGE.md          # Hackathon rules
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| AI Model | Gemini 2.0 Flash (Live API) |
| Agent Framework | Google ADK (v1.26.0) |
| Backend | FastAPI + WebSocket |
| Embed Script | TypeScript, esbuild (16KB) |
| Extension | Chrome MV3 |
| Hosting | Google Cloud Run |
| Database | Google Firestore |
| IaC | Terraform |

## Google Cloud Services Used

- **Cloud Run** — Stateless gateway hosting
- **Artifact Registry** — Container image storage
- **Firestore** — Site config, knowledge base, session storage
- **Gemini Live API** — Real-time bidirectional voice AI

## Challenge Category

**Live Agents** — Voice-first, action-capable agents that break the text-box paradigm.

## License

MIT
