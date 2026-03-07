# DOM Tools Reference

WebClaw's agent interacts with web pages through 8 DOM tools registered as function-calling tools with the Gemini model via Google ADK. This document covers each tool's definition, the smart element finder, and the client-side execution engine.

## Tool Execution Pipeline

When the agent decides to take a page action, the following pipeline executes:

```
Agent Decision (Gemini)
    │ functionCall event
    ▼
Gateway (main.py downstream_task)
    │ Serialized as JSON event
    ▼
Client WebSocket (gateway-client.ts)
    │ Event with functionCall part
    ▼
DOM Actions Module (dom-actions.ts)
    │ Smart element finder + action executor
    ▼
Target Element (actual DOM)
    │ Action performed
    ▼
Result sent back (dom_result)
    │
    ▼
Agent receives confirmation
```

## Tool Definitions

Each tool is a Python function in `gateway/agent/tools.py` that returns an action descriptor. The agent calls these via Gemini's function-calling capability.

---

### `click_element`

Click a button, link, tab, menu item, or any clickable element.

**Signature:**

```python
def click_element(selector: str, description: str = "") -> dict
```

**Parameters:**

| Name | Type | Required | Description |
|:-----|:-----|:---------|:-----------|
| `selector` | string | Yes | CSS selector or ARIA label to identify the element |
| `description` | string | No | Human-readable description of what is being clicked |

**Action descriptor:**

```json
{
  "action": "click",
  "selector": "#add-to-cart",
  "description": "Add to Cart button",
  "status": "pending"
}
```

**Client execution:** Finds the element, calls `element.click()`, returns success/failure.

**Example agent usage:**
- User: "Add this to my cart"
- Agent calls: `click_element(selector=".btn-add-cart", description="Add to Cart")`

---

### `type_text`

Type text into an input field, textarea, or contenteditable element.

**Signature:**

```python
def type_text(selector: str, text: str, clear_first: bool = True) -> dict
```

**Parameters:**

| Name | Type | Required | Default | Description |
|:-----|:-----|:---------|:--------|:-----------|
| `selector` | string | Yes | — | CSS selector or ARIA label of the input |
| `text` | string | Yes | — | Text to type |
| `clear_first` | bool | No | `True` | Clear existing content before typing |

**Action descriptor:**

```json
{
  "action": "type",
  "selector": "#email-input",
  "text": "john@example.com",
  "clear_first": true,
  "status": "pending"
}
```

**Client execution:** Finds the element, optionally clears it, sets `element.value`, dispatches `input` and `change` events for framework reactivity.

---

### `scroll_to`

Scroll to a specific element or scroll the page by a pixel amount.

**Signature:**

```python
def scroll_to(selector: str = "", direction: str = "down", amount: int = 300) -> dict
```

**Parameters:**

| Name | Type | Required | Default | Description |
|:-----|:-----|:---------|:--------|:-----------|
| `selector` | string | No | `""` | CSS selector to scroll to. If empty, scrolls the page. |
| `direction` | string | No | `"down"` | Scroll direction: `"up"` or `"down"` |
| `amount` | int | No | `300` | Pixels to scroll (only when `selector` is empty) |

**Modes:**

1. **Selector provided:** Uses `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`
2. **No selector:** Uses `window.scrollBy(0, amount)` (negative for up)

---

### `navigate_to`

Navigate to a URL within the current website.

**Signature:**

```python
def navigate_to(url: str) -> dict
```

**Parameters:**

| Name | Type | Required | Description |
|:-----|:-----|:---------|:-----------|
| `url` | string | Yes | URL or path to navigate to (relative or absolute within the site) |

**Client execution:** Sets `window.location.href`. The agent should only navigate within the current domain. Cross-origin navigation is blocked by the browser's security model.

---

### `highlight_element`

Draw visual attention to an element with a glow border and optional tooltip.

**Signature:**

```python
def highlight_element(selector: str, message: str = "") -> dict
```

**Parameters:**

| Name | Type | Required | Default | Description |
|:-----|:-----|:---------|:--------|:-----------|
| `selector` | string | Yes | — | CSS selector or ARIA label of the element |
| `message` | string | No | `""` | Tooltip text to show near the element |

**Client execution:** Finds the element, applies a temporary CSS outline/glow effect (e.g., `outline: 3px solid #4285f4; box-shadow: 0 0 10px #4285f4`), optionally creates a tooltip overlay. The highlight auto-removes after 3 seconds.

**Example agent usage:**
- User: "Where is the search bar?"
- Agent calls: `highlight_element(selector='input[type="search"]', message="Here's the search bar")`

---

### `read_page`

Extract and return text content from the page or a specific element.

**Signature:**

```python
def read_page(selector: str = "body") -> dict
```

**Parameters:**

| Name | Type | Required | Default | Description |
|:-----|:-----|:---------|:--------|:-----------|
| `selector` | string | No | `"body"` | CSS selector of the element to read |

**Client execution:** Finds the element, returns `element.innerText` (trimmed, limited to first 2000 characters).

**Example agent usage:**
- User: "What does the shipping section say?"
- Agent calls: `read_page(selector="#shipping-info")`

---

### `select_option`

Choose an option from a `<select>` dropdown.

**Signature:**

```python
def select_option(selector: str, value: str) -> dict
```

**Parameters:**

| Name | Type | Required | Description |
|:-----|:-----|:---------|:-----------|
| `selector` | string | Yes | CSS selector of the `<select>` element |
| `value` | string | Yes | Option value or visible text to select |

**Client execution:** Finds the `<select>`, searches options by `value` attribute first, then by `textContent`. Sets `element.value` and dispatches `change` event.

---

### `check_checkbox`

Toggle a checkbox element.

**Signature:**

```python
def check_checkbox(selector: str, checked: bool = True) -> dict
```

**Parameters:**

| Name | Type | Required | Default | Description |
|:-----|:-----|:---------|:--------|:-----------|
| `selector` | string | Yes | — | CSS selector of the checkbox |
| `checked` | bool | No | `True` | Whether to check (`True`) or uncheck (`False`) |

**Client execution:** Finds the checkbox, sets `element.checked`, dispatches `change` event.

---

## Smart Element Finder

The DOM actions module uses a three-tier element resolution strategy. When the agent provides a selector (which may be a CSS selector, ARIA label, or natural language description), the finder tries each strategy in order:

### Strategy 1: CSS Selector

```javascript
const element = document.querySelector(selector);
```

Direct CSS selector match. Works for selectors like `#buy-btn`, `.product-card:first-child`, `button[data-action="add"]`.

### Strategy 2: ARIA Label

```javascript
const element = document.querySelector(`[aria-label="${selector}"]`);
```

Matches elements by their accessibility label. Works for selectors like `"Add to Cart"`, `"Close dialog"`, `"Search"`. This is particularly effective because:
- ARIA labels are designed to be human-readable descriptions
- The agent naturally generates human-readable descriptions
- Accessible websites have ARIA labels on interactive elements

### Strategy 3: Text Content Search

```javascript
const interactiveElements = document.querySelectorAll(
  'button, a, [role="button"], input[type="submit"], [onclick]'
);
for (const el of interactiveElements) {
  if (el.textContent.trim().toLowerCase().includes(selector.toLowerCase())) {
    return el;
  }
}
```

Scans all interactive elements for matching text content. This handles natural language selectors like `"Add to Cart"` or `"Sign Up"` even when there are no IDs or ARIA labels.

### Resolution Order

```
Input: "Add to Cart"

1. document.querySelector("Add to Cart")        → null (not valid CSS)
2. [aria-label="Add to Cart"]                    → <button aria-label="Add to Cart">
   └─ FOUND ✓

Input: "#checkout-btn"

1. document.querySelector("#checkout-btn")       → <button id="checkout-btn">
   └─ FOUND ✓

Input: "Submit Order"

1. document.querySelector("Submit Order")        → null
2. [aria-label="Submit Order"]                   → null
3. Scan buttons for text "submit order"          → <button>Submit Order</button>
   └─ FOUND ✓
```

### Failure Handling

If all three strategies fail, the action returns a failure result:

```json
{
  "action": "click",
  "success": false,
  "error": "Element not found: #nonexistent-btn",
  "selector": "#nonexistent-btn"
}
```

The agent receives this failure and can:
- Try a different selector
- Ask the user for clarification
- Use `read_page` to understand the current page structure
- Request a new DOM snapshot

## Safety Constraints

The agent's system prompt includes safety rules that apply to all tools:

1. **No payment submission without confirmation.** The agent will ask "Should I submit this payment?" before clicking submit on payment forms.
2. **No password entry.** The agent will never type into password fields.
3. **Form confirmation.** Before submitting forms with personal data, the agent confirms with the user.
4. **Site boundary.** The agent stays within the current website's domain.
5. **Permission enforcement.** Tools in `restricted_actions` are not available to the agent.
