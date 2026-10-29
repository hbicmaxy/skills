---
name: prototype
description: Set up and maintain an HTML prototype with the Protokit toolbar (states, variants, device sizes, timeline, comments). Use whenever creating a new HTML prototype, editing one that loads protokit.js, adding states or presets to a prototype, or when the user pastes "Save my Protokit comments".
---

# Prototypes with Protokit

Protokit is a toolbar that sits on any HTML prototype. Once a prototype describes itself, the designer can:

- switch between states and variants
- view it at desktop, tablet and mobile sizes
- replay its history
- leave comments
- hand it over as one link

This plugin's Timelapse hooks record a version after every turn that changes a prototype.

The full reference is in `../../README.md` (relative to this skill). Read its "Adding it to a prototype" and "Comments" sections before writing a `Protokit.init` call for the first time.

## Where prototypes live

Timelapse only records prototypes that are inside a folder named `prototype` or `prototypes` (any case), or that already have a `.timelapse` folder beside them. Put new prototypes there, for example:

- `~/Documents/Prototypes/<name>/index.html`
- `docs/prototypes/<name>/index.html` in a repo

Prefer one folder per prototype. A prototype can be a single HTML file or HTML plus its own CSS/JS; edits to any of them count as a new version.

## Load the toolbar

Add this line before the prototype's own scripts:

```html
<script src="https://cdn.jsdelivr.net/gh/hbicmaxy/skills@protokit--v1.0.2/plugins/protokit/toolbar/protokit.js"></script>
```

Keep the version pinned. To move a prototype to a newer release, change the tag (`protokit--vX.Y.Z`).

On its own, that line gives the toolbar with the device-size switcher, timeline and comments. Everything else comes from `Protokit.init`.

## Describe the prototype

Call `Protokit.init({...})` once the prototype's state exists and before the page finishes loading. Inside a Vue `setup()`, call it just before `return`. Build it up as you build the prototype:

- **`state`**: the object the page renders from. The toolbar reads and writes it. Plain HTML/JS prototypes also pass `onChange: render`.
- **`presets`**: one per meaningful state the design must handle (empty, loading, error, trial ended, a member without permission, and so on), named in the product's language. Add a preset whenever you add a state to the design. Every preset is screenshotted on every version, and reviewers browse them in the handover. Use `apply(state) { … }` instead of `values` when a state needs more than values, such as an open dialog or a failed action, so Timelapse can capture it.
- **`controls`**: the individual settings behind the presets, grouped with `{ group: '…' }`, with clear labels.
- **`derived`**: read-only values worth checking (e.g. which layout the logic picked).
- **`variants`**: only when there is an existing page to compare against. Label them `{ current: 'Current page', prototype: 'Prototype' }`, and set `capture: { variants: ['prototype'] }` so Timelapse records the new design only. With no existing page, leave `variants` out and no switch appears.
- **`screen`**: for an app with several screens, the state key that says which screen is showing (e.g. `'screen'`). Give every screen at least one preset, so its history is captured. The timeline uses `screen` to follow the right one when the user has clicked into a state that isn't a preset.
- **`viewports`**: the sizes to offer, from `desktop`, `tablet` and `mobile`. Leave it out for a responsive web page. For a mobile app, use `['mobile', 'tablet']`. It then opens on a phone and is recorded at phone size. Ask the user if it's unclear.

Don't build your own state-switching panel or layout controls into the page. The toolbar provides them.

## Comments

Comments live in `<script type="application/json" id="protokit-comments">` just before `</body>`. The format is in the README. Categories are `note`, `logic`, `question` and `reference`.

- **When the user pastes "Save my Protokit comments into …"**, replace the contents of that block in the named file with the JSON they pasted (add the block if it's missing). Don't change the comments themselves.
- **When the user asks you to add a comment**, write it into the block with a unique `id`. Its `anchor` should use a selector plus the element's visible `text`, so the pin finds it again.

## Handover

When the user asks to hand a prototype over, or pastes "Prepare a Protokit handover for …", use this plugin's `handover` skill.
