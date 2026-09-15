---
name: annotate
description: Add a toggleable comment layer to any HTML prototype for engineering handover — numbered category-typed pins with notes, saved to the file
---

# Prototype Comment Layer

Adds an engineering-handover comment layer to an HTML prototype. Designers place numbered pins with categorised notes directly on screens. Comments are saved into the HTML file itself, so the prototype is self-contained for handover.

## Categories

| Key          | Color   | Use for                                               |
|--------------|---------|-------------------------------------------------------|
| `note`       | Purple  | General design notes (default)                        |
| `logic`      | Blue    | How something works — flows, logic, interactions      |
| `reference`  | Pink    | "See Figma", external links, related resources        |

## Workflow

### 1. Identify the target prototype

If the user names a file, use that. Otherwise look for HTML files in the working directory. If multiple exist, ask which one. The target must be an HTML prototype file.

### 2. Read the prototype and check for existing comments

Read the target file. Look for `<script id="ann-module">` — if present, the comment layer is already injected. Skip to step 4.

### 3. Inject the comment module

Read the module template from `.claude/skills/annotate-module.html`.

**Before injecting, configure the `ann-data` JSON block:**

Examine the prototype's DOM structure and set the config values:

- `screenSelector` — CSS selector for screen containers (e.g. `.screen`, `section`, `[data-screen]`). Look for elements that represent distinct views/screens.
- `activeClass` — class that marks the visible screen (e.g. `active`, `visible`, `show`). Check how the prototype shows/hides screens.
- `containerSelector` — the scrollable parent that holds all screens (e.g. `.main`, `.content`, `main`). Set this if screens are children of a specific scrollable container. Leave `null` to auto-detect.
- `subTabSelector` — if screens have sub-tabs/sub-views, set the selector for tab content panels (e.g. `.tab-content`). Leave `null` if not applicable.

**Inject the entire module block at the end of the file**, just before the closing `</body>` tag (or at the very end if no `</body>`). Do not modify any other part of the file.

### 4. Start the preview / browser

Start or reuse a dev server preview so the user can see and interact with the prototype. The comment toggle button appears in the bottom-right corner.

Tell the user:
- Click the **pin button** (bottom-right) to toggle comments on/off
- Click **Add comment** in the toolbar, then click anywhere on the screen to place a pin
- Click a pin to read or edit its note
- Use **Cmd/Ctrl+Enter** to save a note, **Esc** to cancel
- Each pin can be categorised: Note (purple), Logic (blue), Reference (pink)
- Click **All comments** to open a drawer listing every comment — click one to jump to its screen
- **Comments default to hidden** — click the pin button to reveal them

### 5. Save comments back to the file

When the user says "save comments" (or similar), persist the browser state to the file:

1. Execute JavaScript in the browser: `window.__getAnnotationData()`
2. Parse the returned JSON string
3. In the prototype file, find the `<script type="application/json" id="ann-data">` block
4. Replace its contents with the new JSON (pretty-printed, 2-space indent)
5. Confirm to the user that comments are saved

### 6. Pre-seeding comments

If the user asks you to add comments (e.g. "annotate the builder screen with notes about the URL paste interaction"), you can write them directly into the `ann-data` JSON block without using the browser. Follow the data format:

```json
{
  "config": { ... },
  "annotations": {
    "screen-id": [
      {
        "id": 1,
        "x": 45.5,
        "y": 200,
        "text": "The comment text",
        "category": "note",
        "created": "2026-09-15"
      }
    ]
  }
}
```

- `id` — unique integer across ALL screens (find the current max and increment)
- `x` — percentage from left edge of the screen container (0–100)
- `y` — pixels from top of the screen container
- `text` — the comment text
- `category` — one of: `note`, `logic`, `reference`
- `created` — ISO date string (YYYY-MM-DD)

Screen keys match the screen element's `id` attribute. For sub-tabs, the key format is `screenId:tabId`.

### Updating existing comments

When editing the comment data, always read the current state first (from the file or browser), merge changes, and write back. Never overwrite the entire annotations object unless the user explicitly asks to clear all comments.

## Notes

- The comment layer uses z-index 10000+ to float above all prototype content
- Pin styling uses purple (#7c3aed) as the accent to stay visually distinct from most product color schemes
- Comments are backed up to localStorage as a safety net, but the file is the source of truth
- The module is a self-contained IIFE with no external dependencies
- All comment DOM uses `ann-` prefixed IDs/classes to avoid conflicts with the prototype
