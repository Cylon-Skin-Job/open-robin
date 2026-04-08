# Dropdown Code Block Rendering Specification

## Overview

This specification defines the visual treatment and behavior of code blocks rendered **inside dropdown/collapsible containers** for `WriteFile` and `StrReplaceFile` tool results. This is a **narrow-scope addition** that does not affect:

- Regular markdown code blocks in assistant messages
- Inline code formatting
- Syntax highlighting behavior
- Copy button functionality

---

## Design Goals

1. **Containment** - Code stays visually grouped within its tool operation dropdown
2. **Familiarity** - Follows existing code block conventions (same fonts, syntax highlighting)
3. **Distinction** - Slight visual separation from regular code blocks to indicate "tool context"
4. **Minimal Intrusion** - No changes to existing code block rendering outside dropdowns

---

## Visual Specification

### Container: Tool Dropdown

```css
.tool-dropdown {
  /* Container for entire tool operation */
  margin: 12px 0;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  overflow: hidden;
}
```

### Header: Tool Dropdown Header

```css
.tool-dropdown-header {
  /* Clickable header to expand/collapse */
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(var(--theme-primary-rgb), 0.08);
  border-bottom: 1px solid var(--theme-border);
  cursor: pointer;
  user-select: none;
}

.tool-dropdown-header:hover {
  background: rgba(var(--theme-primary-rgb), 0.12);
}

/* Left side: Icon + Tool name + File path */
.tool-dropdown-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-primary);
}

/* Right side: Status + Expand/Collapse icon */
.tool-dropdown-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
```

### Body: Dropdown Content Area

```css
.tool-dropdown-body {
  /* Collapsible content container */
  background: rgba(0, 0, 0, 0.4);
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.2s ease-out;
}

.tool-dropdown-body.expanded {
  max-height: 600px; /* Or calculated based on content */
  overflow-y: auto;
}
```

---

## Code Block Within Dropdown

### Key Difference: Dark Grey Background

Unlike regular code blocks (which use `rgba(0, 0, 0, 0.3)`), code blocks inside dropdowns use a **darker grey background** to maintain contrast against the dropdown's own dark background:

```css
/* Regular code block (for reference) */
.markdown-content pre {
  background: rgba(0, 0, 0, 0.3);
  border-left: 1px solid var(--theme-border);
  border-right: 1px solid var(--theme-border);
  border-bottom: 1px solid var(--theme-border);
  border-radius: 0 0 8px 8px;
  padding: 12px;
  max-height: 200px;
  overflow: auto;
}

/* Dropdown-contained code block */
.tool-dropdown-body pre {
  background: #1a1a1a; /* Dark grey, not pure black */
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 12px;
  margin: 12px;
  max-height: 400px;
  overflow: auto;
}
```

### Code Block Header (Inside Dropdown)

```css
.tool-dropdown-body .code-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  margin: 12px 12px 0 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
}
```

### Syntax Highlighting

Syntax highlighting remains **unchanged** - uses existing highlight.js integration:

```javascript
// Same highlighting as regular code blocks
hljs.highlightElement(codeElement);
```

### Typography

```css
.tool-dropdown-body code {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #e0e0e0;
}

/* Inline code within dropdown body */
.tool-dropdown-body :not(pre) > code {
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 12px;
}
```

---

## Content Structure

### WriteFile Tool Dropdown

```
┌─────────────────────────────────────────────────────────────┐
│ 📄 Write File                          │ ✓ Success  ▼       │  ← Header
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📁 src/components/Button.js                             │ │  ← File path
│ ├─────────────────────────────────────────────────────────┤ │
│ │ javascript                                   [Copy]     │ │  ← Code header
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ const Button = ({ label, onClick }) => {            │ │ │
│ │ │   return (                                          │ │ │
│ │ │     <button className="btn" onClick={onClick}>      │ │ │  ← Code body
│ │ │ │     {label}                                       │ │ │    (dark grey bg)
│ │ │     </button>                                       │ │ │
│ │ │   );                                                │ │ │
│ │ │ };                                                  │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### StrReplaceFile Tool Dropdown

```
┌─────────────────────────────────────────────────────────────┐
│ ✏️ Edit File                           │ ✓ Success  ▼       │  ← Header
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📁 src/components/Button.js                             │ │  ← File path
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Replaced 2 occurrences:                                 │ │  ← Edit summary
│ │                                                         │ │
│ │ javascript                                   [Copy]     │ │  ← Code header
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ const Button = ({ label, onClick, variant }) => {   │ │ │  ← Result code
│ │ │   const className = `btn btn--${variant}`;          │ │ │    (dark grey bg)
│ │ │   return (                                          │ │ │
│ │ │     <button className={className} onClick={onClick} │ │ │
│ │ │ │     {label}                                       │ │ │
│ │ │     </button>                                       │ │ │
│ │ │   );                                                │ │ │
│ │ │ };                                                  │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Interaction Behavior

### Expand/Collapse

1. **Default State**: Dropdown is **expanded** when tool result first appears
2. **Click Header**: Toggles expanded/collapsed state
3. **Animation**: Smooth `max-height` transition (200ms ease-out)
4. **Icon**: Chevron rotates 180° when expanded

```javascript
// Toggle behavior
toolDropdownHeader.addEventListener('click', () => {
  const body = dropdown.querySelector('.tool-dropdown-body');
  const icon = dropdown.querySelector('.expand-icon');
  
  body.classList.toggle('expanded');
  icon.style.transform = body.classList.contains('expanded') 
    ? 'rotate(180deg)' 
    : 'rotate(0deg)';
});
```

### Copy Functionality

Copy button works identically to regular code blocks:

```javascript
copyBtn.onclick = () => {
  navigator.clipboard.writeText(codeContent);
  copyBtn.textContent = 'Copied!';
  setTimeout(() => copyBtn.textContent = 'Copy', 2000);
};
```

---

## Data Structure

### Tool Result Message (from WebSocket)

```json
{
  "type": "tool_result",
  "toolCallId": "call_123",
  "toolName": "WriteFile",
  "toolArgs": {
    "path": "src/components/Button.js",
    "content": "const Button = ({ label }) => { ... }"
  },
  "toolOutput": "File written successfully",
  "toolDisplay": [
    {
      "type": "file_operation",
      "operation": "write",
      "path": "src/components/Button.js",
      "language": "javascript",
      "content": "const Button = ({ label }) => { ... }"
    }
  ],
  "isError": false,
  "turnId": "uuid-v4"
}
```

### Rendering Function Signature

```javascript
/**
 * Renders a tool result inside a dropdown container
 * @param {HTMLElement} container - Parent element to append to
 * @param {Object} toolResult - The tool_result message data
 * @returns {HTMLElement} The created dropdown element
 */
function renderToolDropdown(container, toolResult) {
  // Creates dropdown structure
  // Renders code blocks with dark grey background
  // Returns reference to dropdown element
}
```

---

## CSS Variables Reference

| Variable | Value | Usage |
|----------|-------|-------|
| `--dropdown-code-bg` | `#1a1a1a` | Code block background inside dropdown |
| `--dropdown-code-border` | `rgba(255, 255, 255, 0.08)` | Subtle border for code blocks |
| `--dropdown-header-bg` | `rgba(var(--theme-primary-rgb), 0.08)` | Dropdown header background |
| `--dropdown-header-hover` | `rgba(var(--theme-primary-rgb), 0.12)` | Header hover state |
| `--dropdown-body-bg` | `rgba(0, 0, 0, 0.4)` | Dropdown body background |

---

## Implementation Checklist

- [ ] Create `.tool-dropdown` container styles
- [ ] Create `.tool-dropdown-header` with hover state
- [ ] Create `.tool-dropdown-body` with expand/collapse animation
- [ ] Add dark grey background (`#1a1a1a`) for code blocks inside dropdowns
- [ ] Ensure syntax highlighting still applies correctly
- [ ] Add copy button functionality
- [ ] Wire up expand/collapse click handler
- [ ] Add status indicator (success/error) to header
- [ ] Test with both WriteFile and StrReplaceFile tools
- [ ] Verify no impact on regular code blocks

---

## Scope Confirmation

This spec affects **ONLY**:
- ✓ `tool_result` messages with `toolDisplay` content
- ✓ Code blocks rendered inside `.tool-dropdown-body`

This spec does **NOT** affect:
- ✗ Regular markdown code blocks in assistant messages
- ✗ Code blocks outside of tool dropdowns
- ✗ Any other UI elements or components
