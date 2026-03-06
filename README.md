# WebClaw

A Personal Live Agent for Website Operations and Support.

> Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/)

## What is WebClaw?

WebClaw is a live, voice-enabled AI agent that lives on websites and can actually operate the site on behalf of the user. It sees, speaks, listens, and acts.

**Two modes:**
- **Site Mode:** Website owners add a `<script>` tag. Visitors get an AI agent that knows the site and can help them.
- **Personal Mode:** Users install a browser extension. Their personal agent travels with them across the web.

## Quick Start

### Gateway (Backend)

```bash
cd gateway
pip install -r requirements.txt
cp .env.example .env
# Add your GOOGLE_API_KEY and GOOGLE_CLOUD_PROJECT
uvicorn main:app --reload --port 8080
```

### Embed Script (Site Integration)

```html
<script src="https://gateway.webclaw.dev/embed.js"
        data-site-id="your-site-id"></script>
```

### Browser Extension

Load `extension/` as an unpacked Chrome extension.

## Architecture

See [CONCEPT.md](CONCEPT.md) for full architecture documentation.

## Tech Stack

- **Backend:** Python (FastAPI) on Google Cloud Run
- **AI:** Gemini 2.5 Pro + Google ADK + Gemini Live API
- **Storage:** Firestore
- **Embed:** Vanilla JS (<50KB)
- **Extension:** Chrome Extension (Manifest V3)
- **IaC:** Terraform

## License

MIT
