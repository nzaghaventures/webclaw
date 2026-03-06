"""WebClaw Context Broker: Manages knowledge base and permissions between site and agent."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class SiteConfig:
    """Configuration for a WebClaw-integrated website."""

    site_id: str
    domain: str
    persona_name: str = "WebClaw"
    persona_voice: str = "friendly and helpful"
    welcome_message: str = "Hi! I'm here to help. What can I do for you?"
    knowledge_base: str = ""
    allowed_actions: list[str] = field(default_factory=lambda: [
        "click", "type", "scroll", "navigate", "highlight", "read", "select", "check",
    ])
    restricted_actions: list[str] = field(default_factory=list)
    escalation_email: str = ""
    max_actions_per_session: int = 100


# In-memory store for MVP; Firestore in production
_site_configs: dict[str, SiteConfig] = {}

# Default demo config
_site_configs["demo"] = SiteConfig(
    site_id="demo",
    domain="localhost",
    persona_name="Claw",
    welcome_message="Hey! I'm Claw, your website assistant. Ask me anything or tell me what you need help with.",
    knowledge_base="This is a demo e-commerce site selling tech products. We offer free shipping on orders over $50. Returns accepted within 30 days.",
)


def get_site_config(site_id: str) -> SiteConfig | None:
    """Retrieve configuration for a site."""
    return _site_configs.get(site_id)


def set_site_config(config: SiteConfig) -> None:
    """Store or update a site configuration."""
    _site_configs[config.site_id] = config
    logger.info(f"Site config updated: {config.site_id} ({config.domain})")


def list_site_configs() -> list[SiteConfig]:
    """List all registered site configurations."""
    return list(_site_configs.values())


def build_agent_context(site_id: str, user_context: dict | None = None) -> dict:
    """Build the context that gets injected into the agent for a session.

    This is the core of the context broker: it merges site knowledge with
    (optionally) user context from a Personal WebClaw, while enforcing
    asymmetric privacy (site knowledge flows to agent; user data stays private
    from the site).

    Args:
        site_id: The site identifier.
        user_context: Optional personal context from browser extension.

    Returns:
        dict with 'system_prompt_additions' and 'permissions'.
    """
    config = get_site_config(site_id)
    if not config:
        return {
            "system_prompt_additions": "",
            "permissions": {"allowed_actions": ["read", "highlight", "scroll"]},
        }

    context: dict = {
        "system_prompt_additions": "",
        "permissions": {
            "allowed_actions": config.allowed_actions,
            "restricted_actions": config.restricted_actions,
            "max_actions": config.max_actions_per_session,
        },
    }

    parts = []
    if config.knowledge_base:
        parts.append(f"## Site Knowledge\n{config.knowledge_base}")

    if user_context and user_context.get("preferences"):
        parts.append(f"## User Preferences\n{user_context['preferences']}")

    context["system_prompt_additions"] = "\n\n".join(parts)
    return context
