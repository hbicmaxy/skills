#!/usr/bin/env node
// Timelapse — automatic history for HTML prototypes built with Claude Code.
//
// Hook modes (wired in .claude/settings.json, read hook JSON on stdin):
//   node timelapse.mjs prompt   UserPromptSubmit — remember what was asked
//   node timelapse.mjs edit     PostToolUse      — remember which prototype was touched
//   node timelapse.mjs stop     Stop             — screenshot + snapshot every prototype that changed
//
// Stop doesn't rely on the edit hook alone: it also looks through the session's folder for
// prototypes that already have history, and prototype files changed during the turn, so edits
// made by shell commands or by hand are caught too.
//
// Manual mode:
//   node timelapse.mjs capture <file.html> ["note"]
//
// Frames land next to the prototype in .timelapse/<name>/ — open index.html there for the canvas.
// If .timelapse/<name>/next-summary.txt exists when a version is recorded, its first line becomes
// that version's summary (Claude writes it; see the prototype skill).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(os.tmpdir(), 'claude-timelapse');
const LOG = path.join(STATE_DIR, 'log.txt');
const VIEWPORT = { width: 1440, height: 900, scale: 2 };
const MAX_HEIGHT = 2400;
const ASSET_EXT = /\.(css|js|mjs|jsx|ts|tsx|svg|json)$/i;
const BROWSERS = [
  process.env.TIMELAPSE_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

fs.mkdirSync(STATE_DIR, { recursive: true });
const log = (...a) => fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${a.join(' ')}\n`);

// ---------- hook state (per Claude session) ----------

const statePath = (sid) => path.join(STATE_DIR, `${sid || 'default'}.json`);
const loadState = (sid) => {
  try { return JSON.parse(fs.readFileSync(statePath(sid), 'utf8')); }
  catch { return { prompts: [], files: [] }; }
};
const saveState = (sid, s) => fs.writeFileSync(statePath(sid), JSON.stringify(s));

// The hooks run in every project, so only prototypes count: anything under a folder named
// "prototype(s)" (e.g. ~/Documents/Prototypes, docs/prototypes/billing), or anything that already
// has a .timelapse folder beside it (a manual capture opts a file in).
function inScope(file) {
  if (file.startsWith(HERE + path.sep)) return false;
  if (/[\\/](node_modules|dist|build|\.timelapse)[\\/]/.test(file)) return false;
  return /[\\/]prototypes?[\\/]/i.test(file) || fs.existsSync(path.join(path.dirname(file), '.timelapse'));
}

// An edited .html is the prototype itself; an edited asset belongs to the nearest index.html above it.
function resolveTarget(file, root) {
  if (!file || !inScope(file)) return null;
  if (/\.html?$/i.test(file)) return file;
  if (!ASSET_EXT.test(file)) return null;
  const own = path.dirname(file), asset = path.basename(file);
  try {
    const user = fs.readdirSync(own).filter((f) => /\.html?$/i.test(f))
      .find((f) => fs.readFileSync(path.join(own, f), 'utf8').includes(asset));
    if (user) return path.join(own, user);
  } catch {}
  let dir = own;
  for (let i = 0; i < 5; i++) {
    const idx = path.join(dir, 'index.html');
    if (fs.existsSync(idx)) return idx;
    if (root && path.resolve(dir) === path.resolve(root)) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// ---------- capture ----------

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// What a prototype looks like depends on its HTML and on the CSS, JS and images it loads from its
// own folder (and what that CSS pulls in). Files outside the folder, such as a shared toolbar
// script or a repo's fonts, aren't part of its design, so they don't count as a change.
const isLocalRef = (ref) => !!ref && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
const htmlRefs = (html) => [
  ...[...html.matchAll(/<(?:link|script|img|source|video|audio|iframe)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
  ...cssRefs(html),
];
const cssRefs = (css) => [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]);
// The line loading the Protokit toolbar isn't part of the design either: upgrading the toolbar
// shouldn't add a version.
const TOOLBAR_TAG = /<script\b[^>]*\bsrc\s*=\s*["'](?:[^"']*\/)?protokit\.js(?:[?#][^"']*)?["'][^>]*>\s*<\/script>/gi;
function contentHash(file, src, { ignoreToolbar = true } = {}) {
  const dir = path.dirname(file), seen = new Set();
  const h = crypto.createHash('sha1').update(ignoreToolbar ? src.replace(TOOLBAR_TAG, '<script data-protokit-toolbar></script>') : src);
  const add = (ref, from) => {
    if (!isLocalRef(ref)) return;
    const p = path.resolve(from, decodeURIComponent(ref.split(/[?#]/)[0]));
    if (seen.has(p) || !p.startsWith(dir + path.sep) || p.includes(`${path.sep}.timelapse${path.sep}`)) return;
    seen.add(p);
    let buf;
    try { buf = fs.readFileSync(p); } catch { return; }
    h.update(`\0${path.relative(dir, p)}\0`).update(buf);
    if (/\.css$/i.test(p)) cssRefs(buf.toString()).forEach((r) => add(r, path.dirname(p)));
  };
  htmlRefs(src).forEach((r) => add(r, dir));
  return h.digest('hex');
}

// Prototypes under root to check at the end of a turn: every one that already has history, and
// any prototype file modified since the turn began. Bounded so a large repo can't stall a turn.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', 'vendor', '__pycache__', '.venv']);
function findPrototypes(root, since) {
  const known = new Set(), recent = new Set(), started = Date.now();
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > 8 || ++visited > 5000 || Date.now() - started > 400) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const protoDir = /[\\/]prototypes?([\\/]|$)/i.test(dir) || entries.some((e) => e.name === '.timelapse');
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '.timelapse') {
          for (const sub of fs.readdirSync(p)) {
            try {
              const f = JSON.parse(fs.readFileSync(path.join(p, sub, 'frames.json'), 'utf8')).file;
              if (f && fs.existsSync(f) && inScope(f)) known.add(f);
            } catch {}
          }
        } else if (!SKIP_DIRS.has(e.name) && p !== HERE) walk(p, depth + 1);
      } else if (since && protoDir && (/\.html?$/i.test(e.name) || ASSET_EXT.test(e.name))) {
        try {
          if (fs.statSync(p).mtimeMs >= since) { const t = resolveTarget(p, root); if (t) recent.add(t); }
        } catch {}
      }
    }
  };
  if (root) walk(path.resolve(root), 0);
  return { known, recent };
}

// Rough "+added −removed" line counts against the previous snapshot.
function diffStat(prev, next) {
  const count = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = count(prev.split('\n')), b = count(next.split('\n'));
  let added = 0, removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) || 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) || 0));
  return { added, removed };
}

// Snapshots live three folders down (.timelapse/<name>/frames/), so point relative assets back up.
function withBase(html) {
  if (/<base\s/i.test(html)) return html;
  const tag = '<base href="../../../">';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`) : tag + html;
}

async function captureFrame(file, notes = []) {
  const src = fs.readFileSync(file, 'utf8');
  const hash = contentHash(file, src);
  const name = path.basename(file).replace(/\.html?$/i, '');
  const base = path.join(path.dirname(file), '.timelapse', name);
  const framesDir = path.join(base, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  const manifestPath = path.join(base, 'frames.json');
  let manifest = { name, file, frames: [] };
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
  const last = manifest.frames.at(-1);
  // Claude leaves a one-line summary of the turn's change here; it belongs to this version or none.
  const summaryPath = path.join(base, 'next-summary.txt');
  let summary = null;
  try { summary = fs.readFileSync(summaryPath, 'utf8').trim().split('\n')[0].slice(0, 300) || null; } catch {}
  fs.rmSync(summaryPath, { force: true });
  if (last?.hash === hash) { log('unchanged', file); return null; }
  // Versions saved before assets counted were hashed from the HTML alone: upgrade, don't re-capture.
  // Earlier versions hashed the HTML alone, or the toolbar line too: if one of those still matches,
  // nothing has changed since; upgrade the stored hash instead of capturing.
  if (last && (last.hash === sha1(src) || last.hash === contentHash(file, src, { ignoreToolbar: false }))) {
    last.hash = hash;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(base, 'frames.js'), `window.TIMELAPSE = ${JSON.stringify(manifest)};\n`);
    log('upgraded hash', file);
    return null;
  }

  const n = manifest.frames.length + 1;
  const id = String(n).padStart(4, '0');
  fs.writeFileSync(path.join(framesDir, `${id}.html`), withBase(src));

  let shots = [], viewport = null;
  try { ({ shots, viewport } = await screenshots(pathToFileURL(file).href, framesDir, id)); }
  catch (e) { log('screenshot failed', file, e.message); }

  let stat = null;
  if (last) {
    try { stat = diffStat(fs.readFileSync(path.join(base, last.html), 'utf8'), withBase(src)); } catch {}
  }

  manifest.title = src.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || name;
  manifest.file = file;
  manifest.frames.push({
    n, hash, at: new Date().toISOString(),
    notes: notes.map((p) => (p.length > 600 ? p.slice(0, 600) + '…' : p)),
    ...(summary ? { summary } : {}),
    shot: shots[0]?.file || null, shots, viewport, html: `frames/${id}.html`, stat,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  // file:// pages can't fetch JSON, so the viewer loads the same data as a script.
  fs.writeFileSync(path.join(base, 'frames.js'), `window.TIMELAPSE = ${JSON.stringify(manifest)};\n`);
  fs.copyFileSync(path.join(HERE, 'viewer.html'), path.join(base, 'index.html'));
  log('captured', file, `#${n}`);
  return path.join(base, 'index.html');
}

// Headless screenshots over the DevTools protocol (Node's built-in WebSocket, no dependencies).
//
// A prototype can opt in to multi-state capture by defining, once it has loaded:
//   window.timelapse = {
//     prepare() { ... },                              // optional: e.g. hide a dev control panel
//     viewport: { width: 390, height: 844, mobile: true }, // optional: capture size (default 1440 x 900)
//     states: [{ name: 'Trial ended', params: 'state=trial-ended', apply() { ... } }, ...],
//   }
// Each state is applied in turn and screenshotted. Without it, the page is captured once as "Default".
async function screenshots(url, framesDir, id) {
  const bin = BROWSERS.find((b) => fs.existsSync(b));
  if (!bin) throw new Error('no Chromium-based browser found (set TIMELAPSE_BROWSER)');
  const profile = fs.mkdtempSync(path.join(STATE_DIR, 'profile-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--mute-audio', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const kill = setTimeout(() => proc.kill('SIGKILL'), 120000);
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      proc.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
      proc.on('exit', () => reject(new Error('browser exited early')));
      setTimeout(() => reject(new Error('browser did not start')), 15000).unref();
    });

    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws failed')); });
    let seq = 0;
    const pending = new Map(), waiters = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        waiters.filter((w) => w.method === msg.method).forEach((w) => w.resolve(msg.params));
      }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const waitFor = (method, ms) => new Promise((resolve) => {
      waiters.push({ method, resolve });
      setTimeout(resolve, ms).unref();
    });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: VIEWPORT.scale, mobile: false,
    }, sessionId);
    const loaded = waitFor('Page.loadEventFired', 10000);
    await send('Page.navigate', { url }, sessionId);
    await loaded;
    await send('Runtime.evaluate', {
      expression: 'document.fonts ? document.fonts.ready.then(() => 1) : 1', awaitPromise: true,
    }, sessionId).catch(() => {});
    await new Promise((r) => setTimeout(r, 700)); // let entrance animations settle

    const evaluate = async (expression) => (await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, sessionId)).result?.value;
    // The page size: desktop unless the prototype asks for another (window.timelapse.viewport).
    const size = { width: VIEWPORT.width, height: VIEWPORT.height, mobile: false };
    // Full page, capped so a runaway layout doesn't produce a giant image.
    const metrics = (height) => send('Emulation.setDeviceMetricsOverride', {
      width: size.width, height, deviceScaleFactor: VIEWPORT.scale, mobile: size.mobile,
    }, sessionId);
    // Something pinned to the bottom of the screen (a tab bar, a sticky footer)?
    const pinnedToBottom = () => evaluate(`[...document.querySelectorAll('body *')].some((el) => {
      const p = getComputedStyle(el).position;
      if (p !== 'fixed' && p !== 'sticky') return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom >= innerHeight - 2 && r.top > innerHeight / 2;
    })`);
    const shoot = async (file) => {
      const height = await evaluate(
        `Math.min(${MAX_HEIGHT}, Math.max(${size.height}, document.documentElement.scrollHeight, document.body?.scrollHeight || 0))`);
      // A full-page capture draws pinned elements where the screen ends, i.e. mid-page. Making the
      // screen as tall as the page puts them at the bottom, where they belong.
      const stretch = height > size.height && await pinnedToBottom();
      if (stretch) {
        await metrics(height);
        await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
      }
      const { data } = await send('Page.captureScreenshot', {
        format: 'webp', quality: 88, captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height, scale: 1 },
      }, sessionId);
      if (stretch) await metrics(size.height);
      const buf = Buffer.from(data, 'base64');
      fs.writeFileSync(path.join(framesDir, file), buf);
      // w/h: the screenshot's size on screen (it's taken at 2x), so viewers can lay it out uncropped.
      return { file: `frames/${file}`, hash: sha1(buf), w: size.width, h: height };
    };

    const names = await evaluate(`(async () => {
      const t = window.timelapse;
      if (!t || !Array.isArray(t.states) || !t.states.length) return null;
      if (t.prepare) await t.prepare();
      return t.states.map((s, i) => ({ name: String(s.name || 'State ' + (i + 1)), params: s.params ? String(s.params) : undefined }));
    })()`).catch(() => null);

    const wanted = await evaluate('(window.timelapse && window.timelapse.viewport) || null').catch(() => null);
    if (wanted?.width && wanted?.height) {
      Object.assign(size, { width: Math.round(wanted.width), height: Math.round(wanted.height), mobile: !!wanted.mobile });
      await send('Emulation.setDeviceMetricsOverride', {
        width: size.width, height: size.height, deviceScaleFactor: VIEWPORT.scale, mobile: !!wanted.mobile,
      }, sessionId);
      await new Promise((r) => setTimeout(r, 400)); // let the layout settle at the new size
    }

    const shots = [];
    if (!names) shots.push({ state: 'Default', ...(await shoot(`${id}.webp`)) });
    else {
      for (const [i, { name: state, params }] of names.entries()) {
        await evaluate(`(async () => {
          await window.timelapse.states[${i}].apply();
          window.scrollTo(0, 0);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        })()`).catch((e) => log('state failed', state, e.message));
        await new Promise((r) => setTimeout(r, 250)); // let transitions finish
        // params: the prototype's link to this state (Protokit provides it), used by handovers.
        shots.push({ state, params, ...(await shoot(`${id}-${String(i + 1).padStart(2, '0')}.webp`)) });
      }
    }
    await send('Browser.close').catch(() => {});
    ws.close();
    return { shots, viewport: size };
  } finally {
    clearTimeout(kill);
    if (proc.exitCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000).unref())]);
    }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
}

// ---------- entry ----------

const readHookInput = () => {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
};

const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === 'prompt') {
    const input = readHookInput();
    const s = loadState(input.session_id);
    if (input.prompt?.trim()) s.prompts = [...s.prompts, input.prompt.trim()].slice(-6);
    // When the turn began, kept across an interrupted turn until a Stop handles it.
    s.since ??= Date.now() - 1000;
    saveState(input.session_id, s);
  } else if (mode === 'edit') {
    const input = readHookInput();
    const target = resolveTarget(input.tool_input?.file_path, input.cwd);
    if (target) {
      const s = loadState(input.session_id);
      if (!s.files.includes(target)) s.files.push(target);
      saveState(input.session_id, s);
    }
  } else if (mode === 'stop') {
    const input = readHookInput();
    const s = loadState(input.session_id);
    const { known, recent } = findPrototypes(input.cwd, s.since);
    const thisTurn = new Set([...s.files, ...recent]);
    let captured = false;
    for (const f of new Set([...thisTurn, ...known])) {
      if (!fs.existsSync(f)) continue;
      // Changes from before this turn (by hand, or another tool) aren't explained by its prompts.
      const notes = thisTurn.has(f) ? s.prompts : ['Edited outside Claude'];
      const done = await captureFrame(f, notes).catch((e) => log('capture failed', f, e.stack));
      if (done && thisTurn.has(f)) captured = true;
    }
    // Prompts carry over until something from the turn is captured, so a frame explains every turn behind it.
    saveState(input.session_id, captured ? { prompts: [], files: [] } : { prompts: s.prompts, files: [] });
  } else if (mode === 'capture') {
    const file = path.resolve(args[0] || '');
    if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
    const viewer = await captureFrame(file, args[1] ? [args[1]] : ['Manual capture']);
    console.log(viewer || 'Unchanged since last frame — nothing captured.');
  } else {
    console.log('usage: timelapse.mjs prompt|edit|stop  (hooks)  ·  timelapse.mjs capture <file.html> ["note"]');
  }
} catch (e) {
  log('error', mode, e.stack);
  if (mode === 'capture') { console.error(e.message); process.exitCode = 1; }
}
