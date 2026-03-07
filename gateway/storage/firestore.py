"""WebClaw Firestore Client: Persistent storage for site configs, sessions, and knowledge bases."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

# Firestore availability flag
_firestore_available = False
_db = None

try:
    from google.cloud import firestore
    _firestore_available = True
except ImportError:
    logger.info("google-cloud-firestore not installed; using in-memory storage")


def _get_db():
    """Lazy-initialize Firestore client."""
    global _db
    if _db is None and _firestore_available:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if project:
            _db = firestore.Client(project=project, database="webclaw")
            logger.info(f"Firestore connected: project={project}, database=webclaw")
        else:
            logger.warning("GOOGLE_CLOUD_PROJECT not set; Firestore disabled")
    return _db


# ========================================
# Site Configs
# ========================================


def firestore_get_site(site_id: str) -> dict | None:
    """Get a site config from Firestore."""
    db = _get_db()
    if not db:
        return None
    doc = db.collection("sites").document(site_id).get()
    if doc.exists:
        return doc.to_dict()
    return None


def firestore_set_site(site_id: str, config: dict) -> None:
    """Store or update a site config in Firestore."""
    db = _get_db()
    if not db:
        return
    config["updated_at"] = time.time()
    db.collection("sites").document(site_id).set(config, merge=True)
    logger.info(f"Firestore: site config saved: {site_id}")


def firestore_list_sites() -> list[dict]:
    """List all site configs from Firestore."""
    db = _get_db()
    if not db:
        return []
    docs = db.collection("sites").stream()
    return [doc.to_dict() for doc in docs]


def firestore_delete_site(site_id: str) -> bool:
    """Delete a site config from Firestore."""
    db = _get_db()
    if not db:
        return False
    db.collection("sites").document(site_id).delete()
    logger.info(f"Firestore: site deleted: {site_id}")
    return True


# ========================================
# Session History
# ========================================


def firestore_save_session(
    site_id: str,
    session_id: str,
    user_id: str,
    messages: list[dict],
    metadata: dict | None = None,
) -> None:
    """Save or append to a session's conversation history."""
    db = _get_db()
    if not db:
        return

    doc_ref = db.collection("sites").document(site_id).collection("sessions").document(session_id)
    doc = doc_ref.get()

    session_data: dict[str, Any] = {
        "user_id": user_id,
        "site_id": site_id,
        "updated_at": time.time(),
    }

    if doc.exists:
        existing = doc.to_dict() or {}
        existing_messages = existing.get("messages", [])
        existing_messages.extend(messages)
        session_data["messages"] = existing_messages
    else:
        session_data["created_at"] = time.time()
        session_data["messages"] = messages

    if metadata:
        session_data["metadata"] = metadata

    doc_ref.set(session_data, merge=True)


def firestore_get_session(site_id: str, session_id: str) -> dict | None:
    """Get a session's history."""
    db = _get_db()
    if not db:
        return None
    doc = db.collection("sites").document(site_id).collection("sessions").document(session_id).get()
    if doc.exists:
        return doc.to_dict()
    return None


def firestore_list_sessions(
    site_id: str,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List recent sessions for a site."""
    db = _get_db()
    if not db:
        return []

    query = (
        db.collection("sites")
        .document(site_id)
        .collection("sessions")
        .order_by("updated_at", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .offset(offset)
    )
    return [doc.to_dict() for doc in query.stream()]


# ========================================
# Knowledge Base (structured docs)
# ========================================


def firestore_set_knowledge(site_id: str, doc_id: str, content: str, title: str = "") -> None:
    """Store a knowledge base document for a site."""
    db = _get_db()
    if not db:
        return

    db.collection("sites").document(site_id).collection("knowledge").document(doc_id).set({
        "title": title,
        "content": content,
        "updated_at": time.time(),
    })


def firestore_get_knowledge(site_id: str) -> list[dict]:
    """Get all knowledge base documents for a site."""
    db = _get_db()
    if not db:
        return []
    docs = db.collection("sites").document(site_id).collection("knowledge").stream()
    return [{"id": doc.id, **doc.to_dict()} for doc in docs]


def firestore_delete_knowledge(site_id: str, doc_id: str) -> bool:
    """Delete a knowledge base document."""
    db = _get_db()
    if not db:
        return False
    db.collection("sites").document(site_id).collection("knowledge").document(doc_id).delete()
    return True


# ========================================
# Analytics (lightweight counters)
# ========================================


def firestore_increment_stats(site_id: str, stat_key: str, amount: int = 1) -> None:
    """Increment a site analytics counter."""
    db = _get_db()
    if not db:
        return

    doc_ref = db.collection("sites").document(site_id).collection("stats").document("counters")
    doc_ref.set(
        {stat_key: firestore.Increment(amount), "updated_at": time.time()},
        merge=True,
    )


def firestore_get_stats(site_id: str) -> dict:
    """Get analytics counters for a site."""
    db = _get_db()
    if not db:
        return {}
    doc = db.collection("sites").document(site_id).collection("stats").document("counters").get()
    return doc.to_dict() or {} if doc.exists else {}
