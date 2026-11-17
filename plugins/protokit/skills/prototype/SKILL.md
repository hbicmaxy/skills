---
name: prototype
description: Set up and maintain an HTML prototype with the Protokit toolbar (states, flows, variants, device sizes, timeline, comments). Use whenever creating a new HTML prototype, editing one that loads protokit.js, adding states, presets or flow steps to a prototype, or when the user pastes "Save my Protokit comments".
---

# Prototypes with Protokit

Protokit is a toolbar that sits on any HTML prototype. Once a prototype describes itself, the designer can:

- switch between states and variants
- view it at desktop, tablet and mobile sizes
- replay its history
- leave comments
- hand it over as one link

This plugin's Timelapse hooks record a version after every turn that changes a prototype.

The full reference is in `../../README.md` (relative to this skill). Read its "Adding it to a prototype" section before writing a `Protokit.init` call for the first time, and its "Comments" section only when the user asks you to save or add comments.

## Where prototypes live

Timelapse only records prototypes that are inside a folder named `prototype` or `prototypes` (any case), or that already have a `.timelapse` folder beside them. Put new prototypes there, for example:

- `~/Documents/Prototypes/<name>/index.html`
- `docs/prototypes/<name>/index.html` in a repo

Prefer one folder per prototype. A prototype can be a single HTML file or HTML plus its own CSS/JS; edits to any of them count as a new version.

## Load the toolbar

Add this line before the prototype's own scripts:

```html
<script src="https://cdn.jsdelivr.net/gh/hbicmaxy/skills@protokit--v1.2.1/plugins/protokit/toolbar/protokit.js"></script>
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
- **`device`**: when the prototype draws its own devices (an iPhone, an Android phone, a desktop window) from a state key, name that key, e.g. `device: 'device'`, so the flow view opens on the right flow for the state you're on. If the prototype draws its own phone frame, hide it when the page is inside Protokit's device frame (the URL has `pk-frame`), so the mobile size and rotate don't show a phone inside a phone.
- **`viewports`**: the sizes to offer, from `desktop`, `tablet` and `mobile`. Leave it out for a responsive web page. For a mobile app, use `['mobile', 'tablet']`. It then opens on a phone and is recorded at phone size, and on a real phone it shows full screen without the toolbar (`?toolbar` brings it back, `?bare` hides it anywhere). Don't add your own bare mode. Make the page work at the phone's own width, with `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` and safe-area padding. Ask the user if it's unclear.

Don't build your own state-switching panel or layout controls into the page. The toolbar provides them.

## The flow

For any prototype with more than one screen, keep a **`flows`** list in `Protokit.init`: how a user gets from one preset to the next. The toolbar draws it as a flowchart of screenshots (`F`), Timelapse clicks through every step on each version to check it still lands where it says, and the handover lists it. You write and maintain it; the user reviews it.

```js
flows: [{
  name: 'Finding something to do',
  steps: [
    { from: 'First question', to: 'Halfway through', label: 'Answer', at: '[data-do="answer"]' },
    { from: 'Halfway through', label: 'Answer the last one', decision: 'Anything fit?', branches: { Yes: 'Late on the sofa', No: 'Nothing fits' } },
    { from: 'Editing a hobby', to: { external: 'Confirm remove (system dialog)' }, label: 'Remove' },
  ],
  alternates: { 'Late on the sofa': ['Free afternoon at the table'] },
}],
```

- `from` and `to` are preset names. `label` is what the user does, using the button's own visible text where there is one, so the arrow starts from that button. Add `at: '<selector>'` when the text doesn't find it (an icon button, or text that appears more than once).
- A **decision** is a choice the product makes, not the user: `decision: 'Question?'` with `branches` naming each outcome's preset.
- `{ external: '…' }` is a destination outside the prototype (a system dialog, another product, an email).
- `alternates` lists presets that show the same place with different data, so they sit with it instead of needing their own steps.

Rules:

1. **Every preset is reachable.** Each one is either a `from`/`to` in a flow or an alternate. When you add a preset, add the step that leads to it in the same edit. If you can't say how a user would get there, that's a design gap: ask the user rather than leaving it off.
2. **As few flows as possible.** Use one flow and decision points by default. Split into separate flows only when the device changes the journey, usually desktop vs mobile. iOS and Android are one mobile flow unless their screens really differ; where they only differ by a step (e.g. which store), use a decision such as *Which phone?*.
3. **Ask, don't guess,** where the journey starts and any logic the prototype only fakes (e.g. *is the user signed in?*). Read the rest from the prototype's code.
4. **Say what changed.** When you change the flow, add one line to your reply, e.g. *Flow: added Stash → Export, new decision "Has items?"*.
5. **Fix red steps.** A step the last capture found broken shows red in the flow, with where it went instead. Fix the prototype or the step in the next turn, or ask the user if it's unclear which is right. Steps that start from something Protokit can't click (no matching button) aren't checked, and that's fine.

## Testing on the user's phone

When the user wants to try a prototype on their phone:

1. Serve the prototype's folder on every address, in the background, so the phone can reach it: `python3 -m http.server <port> --bind 0.0.0.0` (pick a free port; reuse a server that's already running for this folder instead of starting another).
2. Find the Mac's Wi-Fi address with `ipconfig getifaddr en0` and give the user `http://<that address>:<port>/<file>.html`. The phone needs to be on the same Wi-Fi.
3. **Do your own checking at `http://localhost:<port>/<file>.html`**, never at the Wi-Fi address. It's the same server and the same files, but the browser pane treats a `192.168.x.x` address as an outside site and asks the user to approve every step.

A mobile app prototype shows full screen on the phone without the toolbar (see `viewports` above), so don't add `?bare` to the link.

## Summarise every change

The timeline and its All Frames page caption each version with a one-line summary of what changed, never the user's prompt. Timelapse records the version when your turn ends, so write the summary before you finish.

**In every turn where you change a prototype**, write one sentence to `.timelapse/<file name without .html>/next-summary.txt` inside the prototype's folder (create the folders if needed). For example, `~/Documents/Prototypes/stash/.timelapse/index/next-summary.txt` for `stash/index.html`. Overwrite whatever is there. Describe the change as a reviewer would see it, e.g. *Stash list now groups hobbies by where you can do them*. Don't restate the prompt. If nothing visible changed, say what did (e.g. *Fixed the results order when two hobbies tie; no visual change*).

## Comments

Comments are the designer's own notes. **Never add, change or delete comments on your own initiative**, including when building a prototype, adding states, or explaining your work. Put your explanations in your reply instead. Only touch comments in the two cases below.

Comments live in `<script type="application/json" id="protokit-comments">` just before `</body>`. The format is in the README. Categories are `note`, `logic`, `question` and `reference`.

- **When the user pastes "Save my Protokit comments into …"**, replace the contents of that block in the named file with the JSON they pasted (add the block if it's missing). Don't change the comments themselves.
- **When the user asks you to add a comment**, write it into the block with a unique `id`. Its `anchor` should use a selector plus the element's visible `text`, so the pin finds it again.

## Handover

When the user asks to hand a prototype over, or pastes "Prepare a Protokit handover for …", use this plugin's `handover` skill.
