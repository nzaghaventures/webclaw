"""WebClaw Gateway: FastAPI application with WebSocket streaming via ADK Gemini Live API."""

import asyncio
import base64
import json
import logging
import time
import uuid
import warnings
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

# Load environment variables
load_dotenv(Path(__file__).parent / ".env")

# Import agent after env is loaded
from agent.agent import root_agent  # noqa: E402
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

APP_NAME = "webclaw-gateway"

# ========================================
# App setup
# ========================================

app = FastAPI(
    title="WebClaw Gateway",
    description="Personal Live Agent for Website Operations and Support",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Embed script runs on any domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Session + Runner
session_service = InMemorySessionService()
runner = Runner(app_name=APP_NAME, agent=root_agent, session_service=session_service)

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
    return {"status": "ok", "service": "webclaw-gateway", "version": "0.2.0"}


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


@app.post("/api/sites")
async def create_site(config: SiteConfigCreate):
    """Register a new site with WebClaw."""
    site_id = str(uuid.uuid4())[:8]
    site_config = SiteConfig(site_id=site_id, **config.model_dump())
    set_site_config(site_config)
    record_event(site_id, "site_created")
    return {"site_id": site_id, "config": vars(site_config)}


@app.get("/api/sites")
async def list_sites():
    """List all registered sites."""
    return {"sites": [vars(c) for c in list_site_configs()]}


@app.get("/api/sites/{site_id}")
async def get_site(site_id: str):
    """Get configuration for a specific site."""
    config = get_site_config(site_id)
    if not config:
        return JSONResponse({"error": "Site not found"}, status_code=404)
    return {"config": vars(config)}


@app.put("/api/sites/{site_id}")
async def update_site(site_id: str, updates: SiteConfigCreate):
    """Update a site's configuration."""
    existing = get_site_config(site_id)
    if not existing:
        return JSONResponse({"error": "Site not found"}, status_code=404)
    updated = SiteConfig(site_id=site_id, **updates.model_dump())
    set_site_config(updated)
    return {"config": vars(updated)}


@app.delete("/api/sites/{site_id}")
async def delete_site(site_id: str):
    """Delete a site configuration."""
    existing = get_site_config(site_id)
    if not existing:
        return JSONResponse({"error": "Site not found"}, status_code=404)
    delete_site_config(site_id)
    return {"deleted": True, "site_id": site_id}


# ========================================
# Knowledge Base CRUD
# ========================================


class KnowledgeDoc(BaseModel):
    title: str = ""
    content: str


@app.get("/api/sites/{site_id}/knowledge")
async def list_knowledge(site_id: str):
    """List knowledge base documents for a site."""
    config = get_site_config(site_id)
    if not config:
        return JSONResponse({"error": "Site not found"}, status_code=404)
    docs = firestore_get_knowledge(site_id)
    return {"documents": docs}


@app.post("/api/sites/{site_id}/knowledge")
async def create_knowledge(site_id: str, doc: KnowledgeDoc):
    """Add a knowledge base document."""
    config = get_site_config(site_id)
    if not config:
        return JSONResponse({"error": "Site not found"}, status_code=404)
    doc_id = str(uuid.uuid4())[:8]
    firestore_set_knowledge(site_id, doc_id, doc.content, doc.title)
    return {"id": doc_id, "title": doc.title}


@app.put("/api/sites/{site_id}/knowledge/{doc_id}")
async def update_knowledge(site_id: str, doc_id: str, doc: KnowledgeDoc):
    """Update a knowledge base document."""
    firestore_set_knowledge(site_id, doc_id, doc.content, doc.title)
    return {"id": doc_id, "title": doc.title}


@app.delete("/api/sites/{site_id}/knowledge/{doc_id}")
async def delete_knowledge(site_id: str, doc_id: str):
    """Delete a knowledge base document."""
    firestore_delete_knowledge(site_id, doc_id)
    return {"deleted": True}


# ========================================
# Session History
# ========================================


@app.get("/api/sites/{site_id}/sessions")
async def list_site_sessions(site_id: str, limit: int = 50):
    """List recent sessions for a site."""
    config = get_site_config(site_id)
    if not config:
        return JSONResponse({"error": "Site not found"}, status_code=404)
    sessions = list_sessions(site_id, limit=limit)
    return {"sessions": sessions}


@app.get("/api/sites/{site_id}/sessions/{session_id}")
async def get_session(site_id: str, session_id: str):
    """Get a session's conversation history."""
    history = get_session_history(site_id, session_id)
    if not history:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return {"session": history}


# ========================================
# Analytics
# ========================================


@app.get("/api/sites/{site_id}/stats")
async def site_stats(site_id: str):
    """Get analytics counters for a site."""
    config = get_site_config(site_id)
    if not config:
        return JSONResponse({"error": "Site not found"}, status_code=404)
    stats = get_site_stats(site_id)
    return {"stats": stats}


# ========================================
# WebSocket: Bidirectional Streaming
# ========================================


@app.websocket("/ws/{site_id}/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    site_id: str,
    session_id: str,
) -> None:
    """WebSocket endpoint for bidirectional streaming with ADK.

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
        Text frames (JSON): ADK events including:
            - Agent text responses
            - Audio data (base64 encoded)
            - Tool calls (DOM actions for embed to execute)
    """
    logger.info(f"WebSocket connect: site={site_id} session={session_id}")
    await websocket.accept()

    # Build context for this site
    agent_context = build_agent_context(site_id)
    user_id = f"user_{session_id[:8]}"

    # Track session messages for history
    session_messages: list[dict] = []
    session_start = time.time()

    # Record connection
    record_event(site_id, "sessions_total")

    # Determine model capabilities
    model_name = root_agent.model
    is_native_audio = "native-audio" in model_name.lower()

    if is_native_audio:
        response_modalities = ["AUDIO"]
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=response_modalities,
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig(),
        )
    else:
        response_modalities = ["AUDIO"]
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=response_modalities,
            session_resumption=types.SessionResumptionConfig(),
        )

    # Get or create session
    session = await session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id,
    )
    if not session:
        await session_service.create_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id,
        )

    live_request_queue = LiveRequestQueue()

    # Inject site context as initial message
    if agent_context.get("system_prompt_additions"):
        context_content = types.Content(
            parts=[types.Part(text=f"[Site Context]\n{agent_context['system_prompt_additions']}")]
        )
        live_request_queue.send_content(context_content)

    async def upstream_task() -> None:
        """Receive from WebSocket, forward to LiveRequestQueue."""
        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message:
                    # Raw PCM audio
                    audio_data = message["bytes"]
                    audio_blob = types.Blob(
                        mime_type="audio/pcm;rate=16000", data=audio_data,
                    )
                    live_request_queue.send_realtime(audio_blob)
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
                        content = types.Content(
                            parts=[types.Part(text=msg["text"])]
                        )
                        live_request_queue.send_content(content)
                        session_messages.append({
                            "role": "user", "type": "text",
                            "text": msg["text"], "ts": time.time(),
                        })
                        record_event(site_id, "messages_text")

                    elif msg_type == "dom_snapshot":
                        snapshot_text = f"[Current Page: {msg.get('url', 'unknown')}]\n{msg.get('html', '')}"
                        content = types.Content(
                            parts=[types.Part(text=snapshot_text)]
                        )
                        live_request_queue.send_content(content)

                    elif msg_type == "screenshot":
                        # Vision-based page understanding
                        image_data = base64.b64decode(msg["data"])
                        image_blob = types.Blob(
                            mime_type=msg.get("mimeType", "image/jpeg"),
                            data=image_data,
                        )
                        # Send as content (not realtime) for vision analysis
                        prompt = msg.get("prompt", "Describe what you see on this webpage.")
                        content = types.Content(
                            parts=[
                                types.Part(text=f"[Screenshot of {msg.get('url', 'current page')}] {prompt}"),
                                types.Part(inline_data=image_blob),
                            ]
                        )
                        live_request_queue.send_content(content)
                        record_event(site_id, "screenshots")

                    elif msg_type == "image":
                        image_data = base64.b64decode(msg["data"])
                        image_blob = types.Blob(
                            mime_type=msg.get("mimeType", "image/jpeg"),
                            data=image_data,
                        )
                        live_request_queue.send_realtime(image_blob)

                    elif msg_type == "dom_result":
                        result_text = f"[Action Result] {json.dumps(msg.get('result', {}))}"
                        content = types.Content(
                            parts=[types.Part(text=result_text)]
                        )
                        live_request_queue.send_content(content)
                        record_event(site_id, "actions_executed")

                    elif msg_type == "negotiate":
                        # Agent negotiation protocol: Personal Agent announces capabilities
                        capabilities = msg.get("capabilities", {})
                        negotiate_text = (
                            "[Agent Negotiation] A Personal Agent is connecting.\n"
                            f"Capabilities: {json.dumps(capabilities)}\n"
                            "Merge the user's personal preferences with site knowledge. "
                            "Keep user data private from site analytics."
                        )
                        content = types.Content(
                            parts=[types.Part(text=negotiate_text)]
                        )
                        live_request_queue.send_content(content)
                        # Send negotiation acknowledgment back to client
                        ack = json.dumps({
                            "type": "negotiate_ack",
                            "site_permissions": agent_context.get("permissions", {}),
                            "persona": {
                                "name": get_site_config(site_id).persona_name if get_site_config(site_id) else "WebClaw",
                                "voice": get_site_config(site_id).persona_voice if get_site_config(site_id) else "",
                            },
                        })
                        await websocket.send_text(ack)
                        record_event(site_id, "negotiations")

        except WebSocketDisconnect:
            pass  # Client disconnected; downstream will clean up

    async def downstream_task() -> None:
        """Receive ADK events, forward to WebSocket."""
        async for event in runner.run_live(
            user_id=user_id,
            session_id=session_id,
            live_request_queue=live_request_queue,
            run_config=run_config,
        ):
            event_json = event.model_dump_json(exclude_none=True, by_alias=True)
            await websocket.send_text(event_json)

            # Track agent text responses for session history
            try:
                event_data = json.loads(event_json)
                if event_data.get("content", {}).get("parts"):
                    for part in event_data["content"]["parts"]:
                        if "text" in part:
                            session_messages.append({
                                "role": "agent", "type": "text",
                                "text": part["text"], "ts": time.time(),
                            })
                if event_data.get("outputTranscription"):
                    session_messages.append({
                        "role": "agent", "type": "transcription",
                        "text": event_data["outputTranscription"],
                        "ts": time.time(),
                    })
            except Exception:
                pass

    try:
        await asyncio.gather(upstream_task(), downstream_task())
    except WebSocketDisconnect:
        logger.info(f"Client disconnected: session={session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        live_request_queue.close()

        # Save session history to Firestore
        if session_messages:
            save_session_history(
                site_id=site_id,
                session_id=session_id,
                user_id=user_id,
                messages=session_messages,
                metadata={
                    "duration_seconds": time.time() - session_start,
                    "message_count": len(session_messages),
                },
            )

        logger.info(f"Session ended: {session_id} ({len(session_messages)} messages)")
