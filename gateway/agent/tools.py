"""WebClaw Agent: DOM action tools for website interaction."""

from typing import Any


def click_element(selector: str, description: str = "") -> dict[str, Any]:
    """Click an element on the page.

    Args:
        selector: CSS selector or aria label to identify the element.
        description: Human-readable description of what is being clicked.

    Returns:
        dict: Action result with status and details.
    """
    return {
        "action": "click",
        "selector": selector,
        "description": description,
        "status": "pending",
    }


def type_text(selector: str, text: str, clear_first: bool = True) -> dict[str, Any]:
    """Type text into an input field.

    Args:
        selector: CSS selector or aria label of the input element.
        text: The text to type into the field.
        clear_first: Whether to clear existing content before typing.

    Returns:
        dict: Action result with status and details.
    """
    return {
        "action": "type",
        "selector": selector,
        "text": text,
        "clear_first": clear_first,
        "status": "pending",
    }


def scroll_to(selector: str = "", direction: str = "down", amount: int = 300) -> dict[str, Any]:
    """Scroll the page or scroll to a specific element.

    Args:
        selector: CSS selector to scroll to. If empty, scrolls the page by amount.
        direction: Scroll direction - 'up' or 'down'. Only used when selector is empty.
        amount: Pixels to scroll. Only used when selector is empty.

    Returns:
        dict: Action result with status and details.
    """
    return {
        "action": "scroll",
        "selector": selector,
        "direction": direction,
        "amount": amount,
        "status": "pending",
    }


def navigate_to(url: str) -> dict[str, Any]:
    """Navigate to a URL within the current website.

    Args:
        url: The URL or path to navigate to (relative or absolute within the site).

    Returns:
        dict: Action result with status and details.
    """
    return {
        "action": "navigate",
        "url": url,
        "status": "pending",
    }


def highlight_element(selector: str, message: str = "") -> dict[str, Any]:
    """Highlight an element on the page to draw user attention.

    Args:
        selector: CSS selector or aria label of the element to highlight.
        message: Optional tooltip message to show near the highlighted element.

    Returns:
        dict: Action result with status and details.
    """
    return {
        "action": "highlight",
        "selector": selector,
        "message": message,
        "status": "pending",
    }


def read_page(selector: str = "body") -> dict[str, Any]:
    """Read and extract text content from the page or a specific element.

    Args:
        selector: CSS selector of the element to read. Defaults to body (full page).

    Returns:
        dict: Action result with the extracted content.
    """
    return {
        "action": "read",
        "selector": selector,
        "status": "pending",
    }


def select_option(selector: str, value: str) -> dict[str, Any]:
    """Select an option from a dropdown or select element.

    Args:
        selector: CSS selector of the select/dropdown element.
        value: The value or visible text of the option to select.

    Returns:
        dict: Action result with status and details.
    """
    return {
        "action": "select",
        "selector": selector,
        "value": value,
        "status": "pending",
    }


def check_checkbox(selector: str, checked: bool = True) -> dict[str, Any]:
    """Check or uncheck a checkbox element.

    Args:
        selector: CSS selector of the checkbox element.
        checked: Whether to check (True) or uncheck (False) the checkbox.

    Returns:
        dict: Action result with status and details.
    """
    return {
        "action": "check",
        "selector": selector,
        "checked": checked,
        "status": "pending",
    }


# All tools exposed to the ADK agent
DOM_TOOLS = [
    click_element,
    type_text,
    scroll_to,
    navigate_to,
    highlight_element,
    read_page,
    select_option,
    check_checkbox,
]
