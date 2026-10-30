# Protokit

A Claude Code plugin for designing with HTML prototypes. It adds three things:

- **A toolbar** that sits on any prototype: states, variants, device sizes, a timeline and comments.
- **Timelapse**, which records a version of a prototype after every Claude turn that changes it.
- **Handover**, which bundles a prototype into one private link for a PR.

## Install

In Claude Code:

```
/plugin install protokit --marketplace hbicmaxy/skills
```

Or from a terminal:

```
claude plugin install protokit --marketplace hbicmaxy/skills
```

That’s it. Timelapse starts recording prototypes in your next session, and Claude uses the toolbar whenever it builds one. To update later: `/plugin update protokit`.

You’ll also need **Node.js** and a Chromium-based browser (**Chrome, Brave, Edge or Chromium**) installed, which Timelapse uses to take screenshots.

## Using it

1. Ask Claude for a prototype in a folder named `prototypes`, e.g. *"new prototype in ~/Documents/Prototypes/checkout for a 3-step checkout"*, or under `docs/prototypes/` in a repo.
2. Claude builds it with the toolbar and describes its states as it goes. Every turn that changes it becomes a version.
3. Open the prototype in your browser and use the toolbar. Hover any button for its name and shortcut.
4. When it’s ready, click **Handover** on the toolbar and paste the copied request to Claude. You get a private link for the PR.

## The toolbar

Once a prototype describes itself, the toolbar gives you: 

- **Variants**: a switch such as *Current page / Prototype*, for comparing against an existing page. Leave `variants` out when there's no existing page, and the switch doesn't appear.
- **Presets**: named states you can jump between. Use `[` and `]` to step through them.
- **Controls**: the individual settings behind each state (dropdowns, switches, numbers), plus read-only **derived** values.
- **Viewport**: desktop, tablet (768 × 1024) or mobile (390 × 844), with a rotate button. A prototype can offer only some of these. A mobile app might offer just mobile and tablet; it then opens on a phone, and its history is captured at phone size. Tablet and mobile show the prototype in a device frame, scaled down to fit your window when needed. Everything stays in sync both ways: presets and controls reach the device, and anything you click inside the device updates the toolbar.
- **Links to any state**: the address bar always describes what you're looking at (`?variant=prototype&state=past-due&viewport=mobile`, or `&custom=…` for hand-tuned states). **Copy link to this state** puts it on your clipboard for a PR, Slack or a handover note.
- **Timeline**: the prototype's history, Procreate-timelapse style. A scrubber has a dot for each saved version: a large blue dot where the state you're on changed, a small grey ring where it looked the same. The drawer says how many versions changed it (e.g. *Stash changed in 2 of 4 versions*), and so does each state in its dropdown. Press play to watch it evolve, or drag back to any moment. With **Skip unchanged** switched on (the default), play skips versions where the state looked the same. The page shows that moment's screenshot of the state you're on, and switching presets while scrubbing shows that state's history instead. If you've clicked into a state that isn't a preset, it follows the closest preset on the same screen. A dropdown in the timeline lists every captured state, so you can jump to any of them. It opens on the latest version; close it (`T`) to get back to the working prototype. Each version is captioned with a one-line summary of what changed, never the prompt behind it. **Open this version** opens that moment as a working prototype, in the same state.
- **Timelapse states**: if [Timelapse](#timelapse) is on, every preset gets screenshotted after each Claude turn, with no extra setup. That's where the timeline's history comes from.
- **Comments**: Figma-style pins for design notes and handover. See [Comments](#comments) below.

The toolbar's styles are sealed off from the prototype, so neither affects the other's look.

## Shortcuts

Hover over any toolbar button to see its name and shortcut.

| Key | Does |
|---|---|
| `S` | Open or close the states panel |
| `[` / `]` | Previous / next preset |
| `V` | Cycle desktop → tablet → mobile |
| `R` | Rotate the tablet or phone |
| `T` | Open or close the timeline |
| `←` / `→` | Step back / forward through the timeline (while it's open) |
| `Shift` `←` / `→` | Jump to the previous / next version where the state changed |
| `Space` | Play / pause the timeline (while it's open) |
| `C` | Comment mode on / off |
| `H` | Open the handover card |
| `⌘↵` | Save the comment you're writing |
| `\` | Hide or show the whole toolbar |
| `Esc` | Close the open comment, panel or mode |

## Adding it to a prototype

Claude does this for you (see the `prototype` skill). Loading the script on its own gives you the toolbar with the viewport switcher, timeline and comments:

```html
<script src="https://cdn.jsdelivr.net/gh/hbicmaxy/skills@protokit--v1.0.7/plugins/protokit/toolbar/protokit.js"></script>
```

For variants, presets and controls, describe the prototype once its state exists, before the page finishes loading. [toolbar/example.html](toolbar/example.html) is a small working example in plain HTML.

```html
<script src="https://cdn.jsdelivr.net/gh/hbicmaxy/skills@protokit--v1.0.7/plugins/protokit/toolbar/protokit.js"></script>
<script>
  Protokit.init({
    title: 'Project list',
    state,                         // the object the page renders from; the toolbar reads and changes it
    onChange: render,              // plain HTML only; Vue and similar re-render by themselves
    variants: {
      options: { current: 'Current page', prototype: 'Prototype' },
      get: () => design,
      set: (v) => { design = v; render(); },
    },
    presets: [
      { name: 'Empty', values: { projects: 0 } },   // values are applied on top of the defaults
      { name: 'Error', values: { error: true } },
    ],
    controls: [
      { group: 'Data' },
      { key: 'projects', type: 'number', min: 0 },
      { key: 'error', label: 'Failed to load', disabled: (s) => s.loading },
      { key: 'role', label: 'Viewer', options: { admin: 'Admin', member: 'Member' } },
    ],
    derived: (s) => ({ 'shows list': s.projects > 0 }),
    actions: [{ label: 'Toggle outlines', run: () => toggleOutlines() }],
    capture: { variants: ['prototype'] },   // which variants Timelapse screenshots (default: all)
    viewports: ['mobile', 'tablet'],         // sizes to offer (default: all three)
    screen: 'screen',                        // multi-screen apps: the state key saying which screen is showing
  });
</script>
```

Everything is optional:

- Leave out `controls` and they're generated from the state's keys.
- Leave out `variants` when there's nothing to compare against; with one variant, the switch is hidden too.
- `screen` names the state key that says which screen of an app is showing. Without it, a control named `screen`, `page`, `view`, `route` or `tab` is used. Give every screen at least one preset so its history is captured.
- `viewports` lists the sizes to offer, from `desktop`, `tablet` and `mobile`. With desktop listed, it opens at desktop; without it, it opens at the first size listed. With a single size, the size switch is hidden.
- Leave out `defaults` and the state as it is when `init` runs becomes what **Reset** returns to.
- A preset can use `apply(state) { … }` instead of `values` when it needs to do more than set values, such as opening a modal.

The easiest way to set it up is to ask Claude: *"add Protokit to this prototype"*.

### How tablet and mobile work

A page can't make its own window narrower, so the toolbar loads the same prototype a second time inside a device-sized frame (with `pk-frame=1` added to its address). That copy shows no toolbar. The two copies send state changes to each other, so they always match. You don't need to do anything for this, but it does mean the prototype runs twice while a device view is open.

## Comments

Press `C` (or the speech-bubble button) to enter comment mode. It works like Figma:

- **Pins are visible**, and clicking anywhere on the prototype leaves a comment there. While comment mode is on, clicks don't reach the prototype. Press `C` or `Esc` to get back to clicking around.
- **Each comment has a category**: Note (purple), Logic (blue), Question (green) or Reference (pink).
- **Pins stick to the element you clicked**, not to a spot on the screen. A pin on the "Update card" button follows that button through layout changes, other states and the tablet and mobile views. It hides wherever the button isn't shown.
- **"Only in this state"** keeps a comment to the state and variant it was left in (e.g. *Past due · Prototype*). Otherwise it shows everywhere its element appears.
- **Each comment records where it was left** (state, variant and device). Clicking it in the list takes you there and opens it.
- **Comment mode works inside the tablet and mobile views too.**

### Saving comments

Comments are saved in the browser as you go, so nothing is lost on reload. The panel says when some aren't in the file yet. To save them into the prototype file:

- **Copy for Claude** (any browser): copies the comments with instructions. Paste it to Claude and it writes them into the file.
- **Save to file** (Chrome, Edge, Arc): writes straight into the file. The first time, you pick the prototype file to give the browser permission. Brave and Safari don't allow this, so the button doesn't appear there.

Once saved, comments are part of the prototype, so they travel with it to devs and PRs, and show up in Timelapse history. If Claude adds or changes comments in the file while you have unsaved ones, both sets are kept.

### For Claude: the comment format

Comments live in a JSON block in the prototype, just before `</body>`:

```html
<script type="application/json" id="protokit-comments">
{
  "version": 1,
  "comments": [
    {
      "id": "c-checkout-1",
      "text": "Opens the card form, then retries the failed invoice.",
      "category": "logic",
      "anchor": { "selector": "#content button.btn-danger", "text": "Update card", "fx": 0.5, "fy": 0.5 },
      "context": { "variant": "prototype", "variantLabel": "Prototype", "state": "Past due", "custom": null, "viewport": "desktop" },
      "only": false,
      "created": "2026-10-29T06:00:00Z",
      "updated": "2026-10-29T06:00:00Z"
    }
  ]
}
</script>
```

- `anchor.selector` and `anchor.text` find the element. If the selector stops matching, the toolbar looks for the same kind of element with the same text.
- `fx` / `fy` say where inside the element the pin goes (0–1).
- `category` is `note`, `logic`, `question` or `reference`.
- `context.state` is a preset name, and `context.variantLabel` is the variant's name as the toolbar shows it. `only: true` limits the comment to that state and variant.
- When adding comments by hand, give each a unique `id`.
- Escape `<` as `<` inside the JSON.

In a browser Claude can control, `Protokit.comments()` returns the JSON for the comments currently on screen.

## Handover

The **Handover** button (the arrow-out-of-a-tray icon) copies a request to paste to Claude. Claude then bundles the prototype into one private link for a PR:

- **An overview page for reviewers.** It shows every state's latest screenshot (each opens the prototype in that state) and the comments grouped by type, with Logic first. It also shows how the prototype got here: each version with a one-line summary of what changed (not the prompt behind it) and the states it changed.
- **A self-contained copy of the prototype**, toolbar included. Local CSS, scripts, images and fonts are built into the file. Comments are read-only, and the timeline plays from screenshots bundled alongside.
- **The Timelapse history** with the canvas view.
- **A suggested PR description** that links to it all.

If you have unsaved comments, the copied request includes them, so Claude saves them into the file first.

### How Claude prepares it

Claude follows the plugin’s `handover` skill. It saves any pasted comments, writes a one-line summary of each new version, runs `toolbar/handover.mjs`, publishes the result as a private link, and drafts the PR description, which it only adds to a PR when you say so.

The export script’s flags: `--versions` and `--describe` for the summaries, `--out <dir>` to choose the folder (default `.timelapse/<name>/handover/`), and `--no-capture` to skip the fresh capture.

Run on a prototype inside a repo, the export also embeds fonts and images that the prototype loads from elsewhere in the repo, so the copy looks exactly like the original.

## Timelapse

Timelapse records a version of a prototype every time Claude finishes a turn that changed it: a screenshot of every state, a copy of the HTML, and the prompt behind it. The toolbar’s timeline plays these back, and handovers summarise them.

It only records prototypes: files in a folder named `prototype` or `prototypes` (e.g. `~/Documents/Prototypes`, `docs/prototypes/billing`), or files that already have a `.timelapse` folder beside them. Add `.timelapse/` to your global git ignore (`~/.config/git/ignore`) so history never ends up in a commit.

### How it works

The plugin adds three Claude Code hooks, which call `timelapse/timelapse.mjs`:

| Hook | Mode | What it does |
|---|---|---|
| `UserPromptSubmit` | `prompt` | Remembers what you asked |
| `PostToolUse` (Write/Edit) | `edit` | Notes which prototype was touched. An `.html` edit counts directly; a `.css`/`.js` edit maps to the HTML file beside it that uses it, or else the nearest `index.html` above it |
| `Stop` | `stop` | Checks every prototype in the session's folder that already has history, plus any prototype file changed during the turn (however it was changed). Each one that changed gets screenshotted and saved as a frame |

A prototype counts as changed when its HTML changes, or any CSS, JS or image it loads from its own folder (including what that CSS loads). Files outside its folder, like Protokit or a repo's fonts, don't count, and neither does the line that loads the toolbar, so upgrading Protokit never adds a version.

Claude writes a one-line summary of each turn's change to `.timelapse/<name>/next-summary.txt`; Timelapse attaches it to the version it records, which is the caption you see on the timeline and the All Frames page. The prompt is kept too, but only used to write summaries later. Changes made during the turn are attributed to that turn's prompt, whether Claude made them with its editing tools or a shell command. Changes from before the turn, e.g. by hand, are captioned "Edited outside Claude".

Screenshots come from a headless Chromium browser (Chrome, Chromium, Brave or Edge, whichever is installed; override with `TIMELAPSE_BROWSER`) at 2x. The size is 1440×900, or the prototype's own size when it offers no desktop view (see Protokit's `viewports`). There are no npm dependencies.

### Where versions are kept

Next to the prototype:

```
my-prototype.html
.timelapse/my-prototype/
  index.html     ← open this: the canvas
  frames.json    ← manifest (time, prompts, +/− line counts)
  frames/0001.webp, 0001.html, …
```

Each `frames/NNNN.html` is the full source at that moment, so **Open live** gives you a working, clickable version of any past frame.

### The canvas

- The All Frames page shows every version left to right, with one row per state (or per day, for a prototype without states). Each version is captioned with its summary and line changes, and states that didn't change are faded.
- Each screenshot is shown whole, as tall as the page, so changes below the fold are visible. A row is as tall as its tallest screenshot.
- Scroll to pan, ⌘-scroll or pinch to zoom, ⇧1 to fit, ←/→ to step through frames.
- Double-click a frame (or press Enter) to inspect it. In the inspector, **C** compares with the previous frame using a draggable divider, and **O** opens the frame live.
- An open canvas picks up new frames every few seconds while you keep working.

### Capturing by hand

```
node <plugin folder>/timelapse/timelapse.mjs capture path/to/prototype.html "optional note"
```

### Troubleshooting

Errors go to `$TMPDIR/claude-timelapse/log.txt`. Capture never blocks or fails a Claude turn.

### Limits

- One screenshot per state, of the page after it loads and the preset is applied. Anything behind a click, hover or scroll (menus, dialogs, tooltips) isn't captured unless a preset opens it.
- Screenshots are of the full page, up to 2,400px tall. Anything pinned to the bottom of the screen (a tab bar, a sticky footer) is drawn at the bottom of the page.
- Hand edits are only picked up once the prototype already has history, and only when a Claude turn ends in that folder.
- Snapshots copy the HTML file only. Relative CSS/JS/images point back to the current files, not historic copies.
- Only HTML prototypes are recorded, not native apps.
