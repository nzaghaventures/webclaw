"""WebClaw Agent: Core ADK agent definition."""

from google.adk.agents import Agent

from .prompts import WEBCLAW_SYSTEM_PROMPT
from .tools import DOM_TOOLS

# The root agent for WebClaw gateway
# Uses gemini-2.0-flash-live-001 for Live API streaming support
root_agent = Agent(
    name="webclaw_agent",
    model="gemini-2.0-flash-exp-image-generation",
    description="A live website operations agent that can see, hear, speak, and act on web pages.",
    instruction=WEBCLAW_SYSTEM_PROMPT,
    tools=DOM_TOOLS,
)
