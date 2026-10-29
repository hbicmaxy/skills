---
name: handover
description: Bundle a Protokit prototype into one private link for a PR (every state's screenshot, the comments, a summary of each version, and a self-contained copy of the prototype), then draft the PR description. Use when the user asks to hand over a prototype, or pastes "Prepare a Protokit handover for …".
---

# Prototype handover

The handover is one private link with:

- an overview page of every state's latest screenshot
- the comments, grouped Logic, Questions, Notes, References
- "How it got here": one line per version
- a self-contained copy of the prototype with the toolbar built in

The export script is `../../toolbar/handover.mjs` (relative to this skill). Below it's called `handover.mjs`. Use its full path when running it.

## Steps

1. **Save comments.** If the request includes comment JSON, first replace the contents of `<script type="application/json" id="protokit-comments">` in the prototype file with it (add the block just before `</body>` if it's missing).

2. **Summarise the versions.** Run `node handover.mjs <prototype.html> --versions`. It launches a headless browser for a fresh Timelapse capture, so run it outside the sandbox. It prints every version that has no summary yet, with:
   - its prompts
   - the states that looked different
   - the HTML lines added and removed

   Write one short sentence per version saying what changed, as a reviewer would describe it: e.g. *Count Assist trial button renamed from "Start free trial" to "Try Count Assist free"*. Don't restate the prompt. If a version changed nothing visible, say what it did (e.g. *Added the design comments; no change to the design itself.*). Save them in one go:

   ```
   node handover.mjs <prototype.html> --describe '{"3": "…", "4": "…"}'
   ```

   Summaries are kept in the history, so later handovers only list new versions.

3. **Export.** Run `node handover.mjs <prototype.html> --no-capture`. It prints JSON with:
   - `page`: the overview page to publish
   - `files`: everything else, as published path → local path
   - `prDescription`: the drafted PR description
   - `warnings`: e.g. local fonts or images it couldn't find

   Mention any warnings that affect what reviewers see.

4. **Publish.** Use the Artifact tool with `file_path` = `page` and `files` = `files`. The link is private, and the user shares it from the page's Share menu. To update an earlier handover of the same prototype, publish to its existing URL. Only send files that changed.

5. **Draft the PR description.** Read `prDescription`, replace `{{HANDOVER_LINK}}` with the link, and show it to the user. Only put it on a PR after the user says yes, since that's visible to the team.
