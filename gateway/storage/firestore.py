"""WebClaw Firestore Client: Persistent storage for site configs, sessions, and knowledge bases."""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# Firestore availability flag
_firestore_available = False
_db = None

try:
    from google.cloud import firestore
    from google.api_core.exceptions import GoogleAPICallError
    _firestore_available = True
except ImportError:
    logger.info("google-cloud-firestore not installed; using in-memory storage")


# ========================================
# Input Validation
# ========================================

def _validate_site_id(site_id: str) -> None:
    """Validate site_id format."""
    if not re.match(r'^[a-zA-Z0-9_-]{1,50}$', site_id):
        raise ValueError(f"Invalid site_id format: {site_id}")


def _validate_content_length(content: str, max_length: int = 1000000) -> None:
    """Validate content length."""
    if len(content) > max_length:
        raise ValueError(f"Content exceeds max length of {max_length} chars")


def _get_db():
    """Lazy-initialize Firestore client."""
    global _db
    if _db is None and _firestore_available:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if project:
            try:
                _db = firestore.Client(project=project, database="webclaw")
                logger.info(f"Firestore connected: project={project}, database=webclaw")
            except Exception as e:
                logger.error(f"Failed to initialize Firestore: {e}", exc_info=True)
                _db = None
        else:
            logger.warning("GOOGLE_CLOUD_PROJECT not set; Firestore disabled")
    return _db


def check_health() -> bool:
    """Check Firestore connectivity. Returns True if connected."""
    try:
        db = _get_db()
        if not db:
            return False
        # Try to list one document
        db.collection("sites").limit(1).stream()
        return True
    except Exception as e:
        logger.warning(f"Firestore health check failed: {e}")
        return False


# ========================================
# Site Configs
# ========================================


def firestore_get_site(site_id: str) -> dict | None:
    """Get a site config from Firestore."""
    try:
        _validate_site_id(site_id)
        db = _get_db()
        if not db:
            return None
        doc = db.collection("sites").document(site_id).get()
        if doc.exists:
            return doc.to_dict()
        return None
    except ValueError as e:
        logger.error(f"Invalid input to firestore_get_site: {e}")
        raise
    except Exception as e:
        logger.error(f"Error getting site {site_id} from Firestore: {e}", exc_info=True)
        raise


def firestore_set_site(site_id: str, config: dict) -> None:
    """Store or update a site config in Firestore."""
    try:
        _validate_site_id(site_id)
        if not isinstance(config, dict):
            raise ValueError("config must be a dictionary")
        db = _get_db()
        if not db:
            logger.warning(f"Firestore not available; skipping save for site {site_id}")
            return
        config["updated_at"] = time.time()
        db.collection("sites").document(site_id).set(config, merge=True)
        logger.info(f"Firestore: site config saved: {site_id}")
    except ValueError as e:
        logger.error(f"Invalid input to firestore_set_site: {e}")
        raise
    except Exception as e:
        logger.error(f"Error saving site {site_id} to Firestore: {e}", exc_info=True)
        raise


def firestore_list_sites() -> list[dict]:
    """List all site configs from Firestore."""
    try:
        db = _get_db()
        if not db:
            return []
        docs = db.collection("sites").stream()
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        logger.error(f"Error listing sites from Firestore: {e}", exc_info=True)
        return []


def firestore_delete_site(site_id: str) -> bool:
    """Delete a site config from Firestore."""
    try:
        _validate_site_id(site_id)
        db = _get_db()
        if not db:
            logger.warning(f"Firestore not available; skipping delete for site {site_id}")
            return False
        db.collection("sites").document(site_id).delete()
        logger.info(f"Firestore: site deleted: {site_id}")
        return True
    except ValueError as e:
        logger.error(f"Invalid input to firestore_delete_site: {e}")
        raise
    except Exception as e:
        logger.error(f"Error deleting site {site_id} from Firestore: {e}", exc_info=True)
        raise


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
    try:
        _validate_site_id(site_id)
        _validate_site_id(session_id)
        if not isinstance(messages, list):
            raise ValueError("messages must be a list")
        db = _get_db()
        if not db:
            logger.warning(f"Firestore not available; skipping save for session {session_id}")
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
    except ValueError as e:
        logger.error(f"Invalid input to firestore_save_session: {e}")
        raise
    except Exception as e:
        logger.error(f"Error saving session {session_id}: {e}", exc_info=True)
        raise


def firestore_get_session(site_id: str, session_id: str) -> dict | None:
    """Get a session's history."""
    try:
        _validate_site_id(site_id)
        _validate_site_id(session_id)
        db = _get_db()
        if not db:
            return None
        doc = db.collection("sites").document(site_id).collection("sessions").document(session_id).get()
        if doc.exists:
            return doc.to_dict()
        return None
    except ValueError as e:
        logger.error(f"Invalid input to firestore_get_session: {e}")
        raise
    except Exception as e:
        logger.error(f"Error getting session {session_id}: {e}", exc_info=True)
        return None


def firestore_list_sessions(
    site_id: str,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List recent sessions for a site."""
    try:
        _validate_site_id(site_id)
        if limit < 1 or limit > 100:
            raise ValueError("limit must be 1-100")
        if offset < 0:
            raise ValueError("offset must be >= 0")
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
    except ValueError as e:
        logger.error(f"Invalid input to firestore_list_sessions: {e}")
        raise
    except Exception as e:
        logger.error(f"Error listing sessions for {site_id}: {e}", exc_info=True)
        return []


# ========================================
# Knowledge Base (structured docs)
# ========================================


def firestore_set_knowledge(site_id: str, doc_id: str, content: str, title: str = "") -> None:
    """Store a knowledge base document for a site."""
    try:
        _validate_site_id(site_id)
        _validate_site_id(doc_id)
        if not isinstance(content, str):
            raise ValueError("content must be a string")
        _validate_content_length(content, max_length=50000)
        if not isinstance(title, str):
            raise ValueError("title must be a string")
        if len(title) > 500:
            raise ValueError("title exceeds max length of 500 chars")

        db = _get_db()
        if not db:
            logger.warning(f"Firestore not available; skipping save for knowledge {doc_id}")
            return

        db.collection("sites").document(site_id).collection("knowledge").document(doc_id).set({
            "title": title,
            "content": content,
            "updated_at": time.time(),
        })
    except ValueError as e:
        logger.error(f"Invalid input to firestore_set_knowledge: {e}")
        raise
    except Exception as e:
        logger.error(f"Error saving knowledge doc {doc_id}: {e}", exc_info=True)
        raise


def firestore_get_knowledge(site_id: str) -> list[dict]:
    """Get all knowledge base documents for a site."""
    try:
        _validate_site_id(site_id)
        db = _get_db()
        if not db:
            return []
        docs = db.collection("sites").document(site_id).collection("knowledge").stream()
        return [{"id": doc.id, **doc.to_dict()} for doc in docs]
    except ValueError as e:
        logger.error(f"Invalid input to firestore_get_knowledge: {e}")
        raise
    except Exception as e:
        logger.error(f"Error getting knowledge for {site_id}: {e}", exc_info=True)
        return []


def firestore_delete_knowledge(site_id: str, doc_id: str) -> bool:
    """Delete a knowledge base document."""
    try:
        _validate_site_id(site_id)
        _validate_site_id(doc_id)
        db = _get_db()
        if not db:
            logger.warning(f"Firestore not available; skipping delete for knowledge {doc_id}")
            return False
        db.collection("sites").document(site_id).collection("knowledge").document(doc_id).delete()
        return True
    except ValueError as e:
        logger.error(f"Invalid input to firestore_delete_knowledge: {e}")
        raise
    except Exception as e:
        logger.error(f"Error deleting knowledge doc {doc_id}: {e}", exc_info=True)
        raise


# ========================================
# Analytics (lightweight counters)
# ========================================


def firestore_increment_stats(site_id: str, stat_key: str, amount: int = 1) -> None:
    """Increment a site analytics counter."""
    try:
        _validate_site_id(site_id)
        if not isinstance(stat_key, str) or not stat_key:
            raise ValueError("stat_key must be non-empty string")
        if not isinstance(amount, int):
            raise ValueError("amount must be integer")
        db = _get_db()
        if not db:
            logger.warning(f"Firestore not available; skipping stats increment for {site_id}")
            return

        doc_ref = db.collection("sites").document(site_id).collection("stats").document("counters")
        doc_ref.set(
            {stat_key: firestore.Increment(amount), "updated_at": time.time()},
            merge=True,
        )
    except ValueError as e:
        logger.error(f"Invalid input to firestore_increment_stats: {e}")
        raise
    except Exception as e:
        logger.error(f"Error incrementing stats for {site_id}: {e}", exc_info=True)
        raise


def firestore_get_stats(site_id: str) -> dict:
    """Get analytics counters for a site."""
    try:
        _validate_site_id(site_id)
        db = _get_db()
        if not db:
            return {}
        doc = db.collection("sites").document(site_id).collection("stats").document("counters").get()
        return doc.to_dict() or {} if doc.exists else {}
    except ValueError as e:
        logger.error(f"Invalid input to firestore_get_stats: {e}")
        raise
    except Exception as e:
        logger.error(f"Error getting stats for {site_id}: {e}", exc_info=True)
        return {}
