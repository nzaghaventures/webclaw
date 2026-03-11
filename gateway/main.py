"""WebClaw Gateway: FastAPI application with WebSocket streaming via google-genai Live API."""

import asyncio
import base64
import inspect
import json
import logging
import os
import re
import time
import uuid
import warnings
from collections import defaultdict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from pydantic import BaseModel, field_validator

# Load environment variables
load_dotenv(Path(__file__).parent / ".env", override=True)

from agent.prompts import WEBCLAW_SYSTEM_PROMPT, build_site_prompt  # noqa: E402
from agent.tools import DOM_TOOLS  # noqa: E402
from context.broker import (  # noqa: E402
    SiteConfig,
    build_agent_context,
    delete_site_config,
    get_session_history,
    get_site_config,
    get_site_stats,
    list_sessions,
    list_site_configs,
    record_event,
    save_session_history,
    set_site_config,
)
from storage.firestore import (  # noqa: E402
    check_health,
    firestore_delete_knowledge,
    firestore_get_knowledge,
    firestore_set_knowledge,
)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("webclaw.gateway")
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

# ── Model & Client ──────────────────────────────────────────
WEBCLAW_MODEL = os.environ.get("WEBCLAW_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")

# Build the genai Client (direct SDK — no ADK wrapper)
# Use v1alpha for preview/native-audio models (required for bidiGenerateContent)
genai_client = genai.Client(api_key=GOOGLE_API_KEY, http_options={"api_version": "v1alpha"})

# Build tool declarations from DOM_TOOLS functions for genai Live API
def _build_tool_declarations():
    """Convert our DOM tool functions into google.genai FunctionDeclaration list."""
    declarations = []
    for func in DOM_TOOLS:
        sig = inspect.signature(func)
        properties = {}
        required = []
        for param_name, param in sig.parameters.items():
            annotation = param.annotation
            if annotation == str or annotation == inspect.Parameter.empty:
                prop_type = "STRING"
            elif annotation == int:
                prop_type = "INTEGER"
            elif annotation == bool:
                prop_type = "BOOLEAN"
            else:
                prop_type = "STRING"
            properties[param_name] = types.Schema(type=prop_type, description="")
            if param.default is inspect.Parameter.empty:
                required.append(param_name)
        declarations.append(types.FunctionDeclaration(
            name=func.__name__,
            description=(func.__doc__ or "").split("\n")[0].strip(),
            parameters=types.Schema(
                type="OBJECT",
                properties=properties,
                required=required if required else None,
            ),
        ))
    return declarations

TOOL_DECLARATIONS = _build_tool_declarations()

# Build a mapping from function name -> callable for tool execution
TOOL_MAPPING = {func.__name__: func for func in DOM_TOOLS}

logger.info("Active model: %s", WEBCLAW_MODEL)

APP_NAME = "webclaw-gateway"

# ========================================
# Input Validation & Sanitization
# ========================================

def validate_site_id(site_id: str) -> bool:
    """Validate site_id format (alphanumeric, hyphen, underscore, 1-50 chars)."""
    return bool(re.match(r'^[a-zA-Z0-9_-]{1,50}$', site_id))


def validate_url(url: str) -> bool:
    """Validate URL is http/https only."""
    return url.startswith(('http://', 'https://'))


def sanitize_string(value: str, max_length: int = 5000) -> str:
    """Sanitize user input string."""
    if not isinstance(value, str):
        value = str(value)
    # Limit length
    value = value[:max_length]
    return value


# ========================================
# Rate Limiter (in-memory, per IP)
# ========================================

class RateLimiter:
    """Simple in-memory rate limiter: max 60 requests per minute per IP."""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, ip: str) -> bool:
        """Check if IP is allowed to make a request."""
        now = time.time()
        # Clean old requests
        self.requests[ip] = [ts for ts in self.requests[ip] if now - ts < self.window_seconds]
        # Check limit
        if len(self.requests[ip]) >= self.max_requests:
            return False
        self.requests[ip].append(now)
        return True


rate_limiter = RateLimiter()


# ========================================
# App setup
# ========================================

app = FastAPI(
    title="WebClaw Gateway",
    description="Personal Live Agent for Website Operations and Support",
    version="0.2.0",
)

# ========================================
# CORS Configuration
# ========================================

# Get CORS origins from environment variable, default to "*"
cors_origins = os.environ.get("CORS_ORIGINS", "*").split(",")
cors_origins = [origin.strip() for origin in cors_origins if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========================================
# Error Handler Middleware
# ========================================

@app.middleware("http")
async def error_handler_middleware(request: Request, call_next):
    """Middleware for consistent error handling and request logging."""
    start_time = time.time()
    request_id = str(uuid.uuid4())[:8]

    # Extract client IP
    client_ip = request.client.host if request.client else "unknown"

    try:
        # Rate limiting
        if not rate_limiter.is_allowed(client_ip):
            logger.warning(f"[{request_id}] Rate limit exceeded: {client_ip}")
            return JSONResponse(
                {"error": "Rate limit exceeded", "request_id": request_id},
                status_code=429,
            )

        # Log request
        logger.info(f"[{request_id}] {request.method} {request.url.path} from {client_ip}")

        response = await call_next(request)

        # Log response with timing
        duration_ms = (time.time() - start_time) * 1000
        logger.info(
            f"[{request_id}] {request.method} {request.url.path} "
            f"status={response.status_code} duration={duration_ms:.1f}ms"
        )

        return response
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        logger.error(
            f"[{request_id}] Unhandled error in {request.method} {request.url.path}: {e}",
            exc_info=True,
        )
        return JSONResponse(
            {"error": "Internal server error", "request_id": request_id},
            status_code=500,
        )

# ── Startup diagnostics ──
_gcp_project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
_emulator = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
logger.info("=" * 60)
logger.info("WebClaw Gateway v0.3.0 (google-genai SDK)")
logger.info(f"  Model       : {WEBCLAW_MODEL}")
logger.info(f"  API Key     : {'set (' + GOOGLE_API_KEY[:8] + '...)' if GOOGLE_API_KEY else 'NOT SET'}")
logger.info(f"  GCP Project : {_gcp_project or 'NOT SET (Firestore will try ADC)'}")
logger.info(f"  Emulator    : {_emulator or 'not configured'}")
logger.info(f"  Firestore   : {'available' if check_health() else 'unavailable (in-memory only)'}")
logger.info(f"  Tools       : {len(TOOL_DECLARATIONS)} DOM tools registered")
logger.info("=" * 60)

# Serve static assets (logos, favicons)
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Serve embed script
embed_dir = Path(__file__).parent.parent / "embed" / "dist"
if embed_dir.exists():
    app.mount("/embed", StaticFiles(directory=embed_dir), name="embed")

# Serve demo site
demo_dir = Path(__file__).parent.parent / "demo-site"
if demo_dir.exists():
    app.mount("/demo", StaticFiles(directory=demo_dir, html=True), name="demo")

# Serve dashboard
dashboard_dir = Path(__file__).parent.parent / "dashboard" / "dist"
if dashboard_dir.exists():
    app.mount("/dashboard", StaticFiles(directory=dashboard_dir, html=True), name="dashboard")


# ========================================
# REST Endpoints
# ========================================


@app.get("/health")
async def health():
    """Health check for Cloud Run."""
    return {"status": "ok", "service": "webclaw-gateway", "version": "0.3.0"}


@app.get("/api/health")
async def api_health():
    """Health check endpoint that also verifies Firestore connectivity."""
    try:
        firestore_ok = check_health()
        return {
            "status": "ok",
            "service": "webclaw-gateway",
            "version": "0.3.0",
            "firestore": "connected" if firestore_ok else "disconnected",
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}", exc_info=True)
        return JSONResponse(
            {
                "status": "degraded",
                "service": "webclaw-gateway",
                "version": "0.3.0",
                "firestore": "error",
                "error": str(e),
            },
            status_code=503,
        )


@app.get("/api/sites/{site_id}/welcome")
async def get_welcome(site_id: str):
    """Get the welcome configuration for a site (used by embed on page load)."""
    try:
        if not validate_site_id(site_id):
            return JSONResponse({"error": "Invalid site_id format"}, status_code=400)
        config = get_site_config(site_id)
        if not config:
            return {"persona_name": "WebClaw", "welcome_message": "Hi! I'm here to help.", "persona_voice": ""}
        return {
            "persona_name": config.persona_name,
            "welcome_message": config.welcome_message,
            "persona_voice": config.persona_voice,
        }
    except Exception as e:
        logger.error(f"Error getting welcome for {site_id}: {e}", exc_info=True)
        return {"persona_name": "WebClaw", "welcome_message": "Hi! I'm here to help.", "persona_voice": ""}


@app.get("/embed.js")
async def serve_embed_script():
    """Serve the embed script for site integration."""
    for path in [
        Path(__file__).parent.parent / "embed" / "dist" / "webclaw.js",
        Path(__file__).parent / "static" / "webclaw.js",
    ]:
        if path.exists():
            return FileResponse(path, media_type="application/javascript")
    return JSONResponse(
        {"error": "Embed script not built yet. Run: cd embed && npm run build"},
        status_code=404,
    )


# ========================================
# Site Config CRUD
# ========================================


class SiteConfigCreate(BaseModel):
    domain: str
    persona_name: str = "WebClaw"
    persona_voice: str = "friendly and helpful"
    welcome_message: str = "Hi! I'm here to help."
    knowledge_base: str = ""
    allowed_actions: list[str] = [
        "click", "type", "scroll", "navigate", "highlight", "read", "select", "check",
    ]
    restricted_actions: list[str] = []
    escalation_email: str = ""
    max_actions_per_session: int = 100

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, v):
        if not v or len(v) > 255:
            raise ValueError("domain must be 1-255 characters")
        return sanitize_string(v, 255)

    @field_validator("persona_name", "persona_voice", "welcome_message", "knowledge_base")
    @classmethod
    def validate_strings(cls, v):
        if isinstance(v, str) and len(v) > 5000:
            raise ValueError("string too long (max 5000 chars)")
        return sanitize_string(v, 5000)

    @field_validator("escalation_email")
    @classmethod
    def validate_email(cls, v):
        if v and "@" not in v:
            raise ValueError("invalid email format")
        return sanitize_string(v, 255)

    @field_validator("max_actions_per_session")
    @classmethod
    def validate_max_actions(cls, v):
        if v < 1 or v > 1000:
            raise ValueError("max_actions_per_session must be 1-1000")
        return v


@app.post("/api/sites")
async def create_site(config: SiteConfigCreate):
    """Register a new site with WebClaw."""
    try:
        site_id = str(uuid.uuid4())[:8]
        site_config = SiteConfig(site_id=site_id, **config.model_dump())
        set_site_config(site_config)
        record_event(site_id, "site_created")
        logger.info(f"Site created: {site_id} for domain {config.domain}")
        return {"site_id": site_id, "config": vars(site_config)}
    except Exception as e:
        logger.error(f"Error creating site: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to create site", "details": str(e)},
            status_code=400,
        )


@app.get("/api/sites")
async def list_sites(limit: int = 50):
    """List all registered sites."""
    try:
        # Validate limit parameter
        limit = max(1, min(limit, 100))  # Clamp to 1-100
        configs = list_site_configs()
        return {"sites": [vars(c) for c in configs[:limit]]}
    except Exception as e:
        logger.error(f"Error listing sites: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to list sites"},
            status_code=500,
        )


@app.get("/api/sites/{site_id}")
async def get_site(site_id: str):
    """Get configuration for a specific site."""
    try:
        # Validate site_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        config = get_site_config(site_id)
        if not config:
            return JSONResponse({"error": "Site not found"}, status_code=404)
        return {"config": vars(config)}
    except Exception as e:
        logger.error(f"Error getting site {site_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to get site"},
            status_code=500,
        )


@app.put("/api/sites/{site_id}")
async def update_site(site_id: str, updates: SiteConfigCreate):
    """Update a site's configuration."""
    try:
        # Validate site_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        existing = get_site_config(site_id)
        if not existing:
            return JSONResponse({"error": "Site not found"}, status_code=404)
        updated = SiteConfig(site_id=site_id, **updates.model_dump())
        set_site_config(updated)
        logger.info(f"Site updated: {site_id}")
        return {"config": vars(updated)}
    except Exception as e:
        logger.error(f"Error updating site {site_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to update site", "details": str(e)},
            status_code=400,
        )


@app.delete("/api/sites/{site_id}")
async def delete_site(site_id: str):
    """Delete a site configuration."""
    try:
        # Validate site_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        existing = get_site_config(site_id)
        if not existing:
            return JSONResponse({"error": "Site not found"}, status_code=404)
        delete_site_config(site_id)
        logger.info(f"Site deleted: {site_id}")
        return {"deleted": True, "site_id": site_id}
    except Exception as e:
        logger.error(f"Error deleting site {site_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to delete site"},
            status_code=500,
        )


# ========================================
# Knowledge Base CRUD
# ========================================


class KnowledgeDoc(BaseModel):
    title: str = ""
    content: str

    @field_validator("title", "content")
    @classmethod
    def validate_content(cls, v):
        if not isinstance(v, str):
            raise ValueError("must be string")
        if len(v) > 50000:
            raise ValueError("content too long (max 50000 chars)")
        return sanitize_string(v, 50000)


@app.get("/api/sites/{site_id}/knowledge")
async def list_knowledge(site_id: str, limit: int = 50):
    """List knowledge base documents for a site."""
    try:
        # Validate site_id and limit
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        limit = max(1, min(limit, 100))  # Clamp to 1-100
        config = get_site_config(site_id)
        if not config:
            return JSONResponse({"error": "Site not found"}, status_code=404)
        docs = firestore_get_knowledge(site_id)
        return {"documents": docs[:limit]}
    except Exception as e:
        logger.error(f"Error listing knowledge for {site_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to list knowledge documents"},
            status_code=500,
        )


@app.post("/api/sites/{site_id}/knowledge")
async def create_knowledge(site_id: str, doc: KnowledgeDoc):
    """Add a knowledge base document."""
    try:
        # Validate site_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        config = get_site_config(site_id)
        if not config:
            return JSONResponse({"error": "Site not found"}, status_code=404)
        doc_id = str(uuid.uuid4())[:8]
        firestore_set_knowledge(site_id, doc_id, doc.content, doc.title)
        logger.info(f"Knowledge doc created: {site_id}/{doc_id}")
        return {"id": doc_id, "title": doc.title}
    except Exception as e:
        logger.error(f"Error creating knowledge doc for {site_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to create knowledge document", "details": str(e)},
            status_code=400,
        )


@app.put("/api/sites/{site_id}/knowledge/{doc_id}")
async def update_knowledge(site_id: str, doc_id: str, doc: KnowledgeDoc):
    """Update a knowledge base document."""
    try:
        # Validate site_id and doc_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        if not validate_site_id(doc_id):
            return JSONResponse(
                {"error": "Invalid doc_id format"},
                status_code=400,
            )
        firestore_set_knowledge(site_id, doc_id, doc.content, doc.title)
        logger.info(f"Knowledge doc updated: {site_id}/{doc_id}")
        return {"id": doc_id, "title": doc.title}
    except Exception as e:
        logger.error(f"Error updating knowledge doc {site_id}/{doc_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to update knowledge document", "details": str(e)},
            status_code=400,
        )


@app.delete("/api/sites/{site_id}/knowledge/{doc_id}")
async def delete_knowledge(site_id: str, doc_id: str):
    """Delete a knowledge base document."""
    try:
        # Validate site_id and doc_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        if not validate_site_id(doc_id):
            return JSONResponse(
                {"error": "Invalid doc_id format"},
                status_code=400,
            )
        firestore_delete_knowledge(site_id, doc_id)
        logger.info(f"Knowledge doc deleted: {site_id}/{doc_id}")
        return {"deleted": True}
    except Exception as e:
        logger.error(f"Error deleting knowledge doc {site_id}/{doc_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to delete knowledge document"},
            status_code=500,
        )


# ========================================
# Session History
# ========================================


@app.get("/api/sites/{site_id}/sessions")
async def list_site_sessions(site_id: str, limit: int = 50):
    """List recent sessions for a site."""
    try:
        # Validate site_id and limit
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        limit = max(1, min(limit, 100))  # Clamp to 1-100
        config = get_site_config(site_id)
        if not config:
            return JSONResponse({"error": "Site not found"}, status_code=404)
        sessions = list_sessions(site_id, limit=limit)
        return {"sessions": sessions}
    except Exception as e:
        logger.error(f"Error listing sessions for {site_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to list sessions"},
            status_code=500,
        )


@app.get("/api/sites/{site_id}/sessions/{session_id}")
async def get_session(site_id: str, session_id: str):
    """Get a session's conversation history."""
    try:
        # Validate site_id and session_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        if not validate_site_id(session_id):
            return JSONResponse(
                {"error": "Invalid session_id format"},
                status_code=400,
            )
        history = get_session_history(site_id, session_id)
        if not history:
            return JSONResponse({"error": "Session not found"}, status_code=404)
        return {"session": history}
    except Exception as e:
        logger.error(f"Error getting session {site_id}/{session_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to get session"},
            status_code=500,
        )


# ========================================
# Analytics
# ========================================


@app.get("/api/sites/{site_id}/stats")
async def site_stats(site_id: str):
    """Get analytics counters for a site."""
    try:
        # Validate site_id
        if not validate_site_id(site_id):
            return JSONResponse(
                {"error": "Invalid site_id format"},
                status_code=400,
            )
        config = get_site_config(site_id)
        if not config:
            return JSONResponse({"error": "Site not found"}, status_code=404)
        stats = get_site_stats(site_id)
        return {"stats": stats}
    except Exception as e:
        logger.error(f"Error getting stats for {site_id}: {e}", exc_info=True)
        return JSONResponse(
            {"error": "Failed to get site statistics"},
            status_code=500,
        )


# ========================================
# WebSocket: Bidirectional Streaming (google-genai SDK)
# ========================================


@app.websocket("/ws/{site_id}/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    site_id: str,
    session_id: str,
) -> None:
    """WebSocket endpoint for bidirectional streaming using google-genai SDK directly.

    Protocol (client -> server):
        Binary frames: Raw PCM audio (16kHz, 16-bit, mono)
        Text frames (JSON):
            {"type": "text", "text": "user message"}
            {"type": "dom_snapshot", "html": "...", "url": "..."}
            {"type": "dom_result", "action_id": "...", "result": {...}}
            {"type": "image", "data": "base64...", "mimeType": "image/jpeg"}
            {"type": "screenshot", "data": "base64...", "url": "..."}
            {"type": "negotiate", "capabilities": {...}}

    Protocol (server -> client):
        Binary frames: Raw PCM audio from Gemini
        Text frames (JSON):
            {"type": "user", "text": "..."}           - input transcription
            {"type": "gemini", "text": "..."}          - output transcription
            {"type": "tool_call", "name": "...", ...}  - DOM action tool calls
            {"type": "turn_complete"}
            {"type": "interrupted"}
            {"type": "error", "error": "..."}
    """
    logger.info(f"WebSocket connect: site={site_id} session={session_id}")
    await websocket.accept()

    # Build context for this site
    agent_context = build_agent_context(site_id)

    # Track session messages for history
    session_messages: list[dict] = []
    session_start = time.time()

    # Record connection
    record_event(site_id, "sessions_total")

    # Build system instruction from site config
    site_config = get_site_config(site_id)
    if site_config:
        system_text = build_site_prompt(vars(site_config))
    else:
        system_text = WEBCLAW_SYSTEM_PROMPT

    # Append knowledge base context
    if agent_context.get("system_prompt_additions"):
        system_text += f"\n\n{agent_context['system_prompt_additions']}"

    logger.info(f"Using model: {WEBCLAW_MODEL}")

    # Configure the Live API session
    live_config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name="Puck"
                )
            )
        ),
        system_instruction=types.Content(
            parts=[types.Part(text=system_text)]
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=[types.Tool(function_declarations=TOOL_DECLARATIONS)] if TOOL_DECLARATIONS else [],
    )

    # Async queues for routing client input to the Gemini session
    audio_input_queue: asyncio.Queue[bytes] = asyncio.Queue()
    text_input_queue: asyncio.Queue[str] = asyncio.Queue()
    video_input_queue: asyncio.Queue[bytes] = asyncio.Queue()

    try:
        async with genai_client.aio.live.connect(
            model=WEBCLAW_MODEL, config=live_config
        ) as session:
            logger.info(f"Live session established: {session_id}")

            # ── Send queued audio to Gemini ──
            async def send_audio():
                try:
                    while True:
                        chunk = await audio_input_queue.get()
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=chunk,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )
                except asyncio.CancelledError:
                    pass

            # ── Send queued text to Gemini ──
            async def send_text():
                try:
                    while True:
                        text = await text_input_queue.get()
                        logger.info(f"Sending text to Gemini as client turn: {text[:200]}")
                        # IMPORTANT: Use send_client_content (not send_realtime_input)
                        # so Gemini treats this as a conversational turn and responds.
                        # send_realtime_input(text=...) only appends context without
                        # triggering a model response.
                        await session.send_client_content(
                            turns=[
                                types.Content(
                                    parts=[types.Part(text=text)],
                                    role="user",
                                )
                            ],
                            turn_complete=True,
                        )
                except asyncio.CancelledError:
                    pass

            # ── Send queued video/images to Gemini ──
            async def send_video():
                try:
                    while True:
                        chunk = await video_input_queue.get()
                        await session.send_realtime_input(
                            video=types.Blob(
                                data=chunk,
                                mime_type="image/jpeg",
                            )
                        )
                except asyncio.CancelledError:
                    pass

            # ── Receive from Gemini, forward to client WebSocket ──
            event_queue: asyncio.Queue = asyncio.Queue()

            async def receive_from_gemini():
                try:
                    while True:
                        async for response in session.receive():
                            server_content = response.server_content
                            tool_call = response.tool_call

                            if server_content:
                                # Audio data from model
                                if server_content.model_turn:
                                    for part in server_content.model_turn.parts:
                                        if part.inline_data:
                                            # Send raw audio bytes to client
                                            logger.debug(f"Sending audio chunk: {len(part.inline_data.data)} bytes")
                                            await websocket.send_bytes(
                                                part.inline_data.data
                                            )
                                        if part.text:
                                            # Text response from model
                                            logger.info(f"Gemini text (model_turn): {part.text[:200]}")
                                            await event_queue.put({
                                                "type": "gemini",
                                                "text": part.text,
                                            })

                                # Input transcription
                                if (server_content.input_transcription
                                        and server_content.input_transcription.text):
                                    logger.info(f"Input transcription: {server_content.input_transcription.text[:200]}")
                                    await event_queue.put({
                                        "type": "user",
                                        "text": server_content.input_transcription.text,
                                    })
                                    session_messages.append({
                                        "role": "user", "type": "transcription",
                                        "text": server_content.input_transcription.text,
                                        "ts": time.time(),
                                    })

                                # Output transcription
                                if (server_content.output_transcription
                                        and server_content.output_transcription.text):
                                    logger.info(f"Output transcription: {server_content.output_transcription.text[:200]}")
                                    await event_queue.put({
                                        "type": "output_transcription",
                                        "text": server_content.output_transcription.text,
                                    })
                                    session_messages.append({
                                        "role": "agent", "type": "transcription",
                                        "text": server_content.output_transcription.text,
                                        "ts": time.time(),
                                    })

                                # Turn complete
                                if server_content.turn_complete:
                                    logger.debug("Turn complete")
                                    await event_queue.put({"type": "turn_complete"})

                                # Interrupted (barge-in)
                                if server_content.interrupted:
                                    logger.debug("Interrupted (barge-in)")
                                    await event_queue.put({"type": "interrupted"})

                            # Tool calls (DOM actions)
                            if tool_call:
                                function_responses = []
                                for fc in tool_call.function_calls:
                                    func_name = fc.name
                                    args = fc.args or {}

                                    if func_name in TOOL_MAPPING:
                                        try:
                                            tool_func = TOOL_MAPPING[func_name]
                                            if inspect.iscoroutinefunction(tool_func):
                                                result = await tool_func(**args)
                                            else:
                                                loop = asyncio.get_running_loop()
                                                result = await loop.run_in_executor(
                                                    None, lambda f=tool_func, a=args: f(**a)
                                                )
                                        except Exception as e:
                                            result = {"error": str(e)}

                                        function_responses.append(
                                            types.FunctionResponse(
                                                name=func_name,
                                                id=fc.id,
                                                response={"result": result},
                                            )
                                        )
                                        # Forward tool call to client for DOM execution
                                        await event_queue.put({
                                            "type": "tool_call",
                                            "name": func_name,
                                            "args": args,
                                            "result": result,
                                        })
                                        record_event(site_id, "actions_executed")
                                    else:
                                        function_responses.append(
                                            types.FunctionResponse(
                                                name=func_name,
                                                id=fc.id,
                                                response={"error": f"Unknown tool: {func_name}"},
                                            )
                                        )

                                # Send tool responses back to Gemini
                                await session.send_tool_response(
                                    function_responses=function_responses
                                )

                except Exception as e:
                    await event_queue.put({"type": "error", "error": str(e)})
                finally:
                    await event_queue.put(None)  # sentinel

            # ── Receive from client WebSocket, route to queues ──
            async def receive_from_client():
                try:
                    while True:
                        message = await websocket.receive()

                        if "bytes" in message:
                            await audio_input_queue.put(message["bytes"])
                            record_event(site_id, "audio_frames")

                        elif "text" in message:
                            text_data = message["text"]
                            try:
                                msg = json.loads(text_data)
                            except json.JSONDecodeError:
                                logger.warning(f"Invalid JSON from client: {text_data[:100]}")
                                continue

                            msg_type = msg.get("type", "")

                            if msg_type == "text":
                                await text_input_queue.put(msg["text"])
                                session_messages.append({
                                    "role": "user", "type": "text",
                                    "text": msg["text"], "ts": time.time(),
                                })
                                record_event(site_id, "messages_text")

                            elif msg_type == "dom_snapshot":
                                snapshot_text = (
                                    f"[Current Page: {msg.get('url', 'unknown')}]\n"
                                    f"{msg.get('html', '')}"
                                )
                                await text_input_queue.put(snapshot_text)

                            elif msg_type == "screenshot":
                                image_data = base64.b64decode(msg["data"])
                                await video_input_queue.put(image_data)
                                record_event(site_id, "screenshots")

                            elif msg_type == "image":
                                image_data = base64.b64decode(msg["data"])
                                await video_input_queue.put(image_data)

                            elif msg_type == "dom_result":
                                result_text = (
                                    f"[Action Result] "
                                    f"{json.dumps(msg.get('result', {}))}"
                                )
                                await text_input_queue.put(result_text)
                                record_event(site_id, "actions_executed")

                            elif msg_type == "negotiate":
                                capabilities = msg.get("capabilities", {})
                                negotiate_text = (
                                    "[Agent Negotiation] A Personal Agent is connecting.\n"
                                    f"Capabilities: {json.dumps(capabilities)}\n"
                                    "Merge the user's personal preferences with site knowledge. "
                                    "Keep user data private from site analytics."
                                )
                                await text_input_queue.put(negotiate_text)
                                # Send negotiation ack back to client
                                sc = get_site_config(site_id)
                                ack = json.dumps({
                                    "type": "negotiate_ack",
                                    "site_permissions": agent_context.get("permissions", {}),
                                    "persona": {
                                        "name": sc.persona_name if sc else "WebClaw",
                                        "voice": sc.persona_voice if sc else "",
                                    },
                                })
                                await websocket.send_text(ack)
                                record_event(site_id, "negotiations")

                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.error(f"Error receiving from client: {e}")

            # ── Forward event_queue events to client WebSocket as JSON ──
            async def forward_events():
                while True:
                    event = await event_queue.get()
                    if event is None:
                        logger.debug("forward_events: received sentinel, stopping")
                        break  # sentinel — session ended
                    try:
                        logger.info(f"Forwarding event to client: type={event.get('type')}, text={str(event.get('text', ''))[:100]}")
                        await websocket.send_json(event)
                    except Exception as e:
                        logger.error(f"forward_events: failed to send event {event.get('type')}: {e}")
                        break

            # Launch all tasks concurrently
            tasks = [
                asyncio.create_task(send_audio()),
                asyncio.create_task(send_text()),
                asyncio.create_task(send_video()),
                asyncio.create_task(receive_from_gemini()),
                asyncio.create_task(receive_from_client()),
                asyncio.create_task(forward_events()),
            ]

            # Wait for any task to finish (usually receive_from_gemini or receive_from_client)
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

            # Cancel remaining tasks
            for task in pending:
                task.cancel()
            # Wait for cancellation
            await asyncio.gather(*pending, return_exceptions=True)

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: session={session_id}")
    except Exception as e:
        logger.error(f"WebSocket/Live API error: {e}", exc_info=True)
        # Send error to client if possible
        try:
            await websocket.send_json({
                "type": "error",
                "error": str(e),
                "details": "The Live API connection failed. Check model name and API key.",
            })
        except Exception:
            pass
    finally:
        # Save session history
        if session_messages:
            save_session_history(
                site_id=site_id,
                session_id=session_id,
                user_id=f"user_{session_id[:8]}",
                messages=session_messages,
                metadata={
                    "duration_seconds": time.time() - session_start,
                    "message_count": len(session_messages),
                },
            )
        logger.info(f"Session ended: {session_id} ({len(session_messages)} messages)")
