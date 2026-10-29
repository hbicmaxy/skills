#!/usr/bin/env node
// Protokit handover — bundles a prototype for reviewers into one folder to publish as a link.
//
//   node Protokit/handover.mjs <prototype.html> [--out <dir>] [--no-capture]
//   node Protokit/handover.mjs <prototype.html> --versions [all]       what changed in versions without a summary
//   node Protokit/handover.mjs <prototype.html> --describe '{"3": "…"}' save one-line summaries for versions
//
// The handover shows a short summary of each version instead of the prompt behind it. Claude
// writes those (from --versions) and saves them with --describe; they're kept in the history.
//
// The folder (default: .timelapse/<name>/handover/ beside the prototype) holds:
//   index.html           overview for reviewers: every state, the comments, how it got here
//   prototype.html       self-contained copy: toolbar, local CSS/JS/images/fonts inlined
//   history/             Timelapse screenshots (deduplicated) plus the canvas viewer
//   pr-description.md    a PR description to paste, with {{HANDOVER_LINK}} to fill in (not published)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Timelapse sits beside the toolbar: timelapse/ in the plugin (Timelapse/ in older local setups).
const TIMELAPSE = ['timelapse', 'Timelapse'].map((d) => path.join(HERE, '..', d)).find((d) => fs.existsSync(d)) || path.join(HERE, '..', 'timelapse');
const MAX_SHOTS = 300; // keeps a publish well under the artifact file limits

const args = process.argv.slice(2);
const WITH_VALUE = ['--out', '--describe'];
const flag = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return null;
  const takes = WITH_VALUE.includes(f) || (f === '--versions' && args[i + 1] === 'all');
  return args.splice(i, takes ? 2 : 1)[1] ?? true;
};
const outArg = flag('--out'), noCapture = flag('--no-capture'), versionsArg = flag('--versions'), describeArg = flag('--describe');
if (!args[0]) { console.error('usage: handover.mjs <prototype.html> [--out <dir>] [--no-capture]'); process.exit(1); }
const file = path.resolve(args[0]);
if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(1); }

const name = path.basename(file).replace(/\.html?$/i, '');
const dir = path.dirname(file);
const histDir = path.join(dir, '.timelapse', name);
const out = path.resolve(outArg || path.join(histDir, 'handover'));
const warnings = [];

// ---------- 1. fresh capture, so the screenshots match the file as it is now ----------
if (!noCapture && !describeArg) {
  const tl = path.join(TIMELAPSE, 'timelapse.mjs');
  if (fs.existsSync(tl)) {
    const r = spawnSync(process.execPath, [tl, 'capture', file, 'Prepared the handover'], { encoding: 'utf8' });
    if (r.status !== 0) warnings.push(`Timelapse capture failed: ${(r.stderr || '').trim()}`);
  } else warnings.push('Timelapse not found, so the screenshots may be out of date');
}

let manifest = { frames: [] };
try { manifest = JSON.parse(fs.readFileSync(path.join(histDir, 'frames.json'), 'utf8')); }
catch { warnings.push('No Timelapse history yet, so the handover has no screenshots'); }
const source = fs.readFileSync(file, 'utf8');
const title = manifest.title || source.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || name;

// ---------- version summaries ----------
const writeManifest = () => {
  fs.writeFileSync(path.join(histDir, 'frames.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(histDir, 'frames.js'), `window.TIMELAPSE = ${JSON.stringify(manifest)};\n`);
};
if (describeArg) {
  const given = JSON.parse(describeArg);
  for (const [n, text] of Object.entries(given)) {
    const f = manifest.frames.find((x) => x.n === +n);
    if (f) f.summary = String(text).trim();
    else warnings.push(`No version #${n}`);
  }
  writeManifest();
  console.log(JSON.stringify({ described: Object.keys(given).length, warnings }));
  process.exit(0);
}
if (versionsArg) {
  // What Claude needs to summarise each version: the prompt(s), which states looked different, and
  // the lines that changed in the HTML (a rough diff, trimmed).
  const readSnap = (f) => { try { return fs.readFileSync(path.join(histDir, f.html), 'utf8'); } catch { return ''; } };
  const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const list = manifest.frames.map((f, i) => {
    if (versionsArg !== 'all' && f.summary) return null;
    const prev = manifest.frames[i - 1];
    const before = new Set(prev ? lines(readSnap(prev)) : []), after = lines(readSnap(f));
    const afterSet = new Set(after);
    const cut = (l) => (l.length > 160 ? `${l.slice(0, 160)}\u2026` : l);
    const shots = f.shots || [];
    const changedStates = shots.filter((s) => {
      const p = prev?.shots?.find((x) => x.state === s.state);
      return !p || p.hash !== s.hash;
    }).map((s) => s.state);
    return {
      n: f.n, at: f.at, summary: f.summary || null,
      prompts: (f.notes || []).map((t) => (t.length > 400 ? `${t.slice(0, 400)}\u2026` : t)),
      changedStates: prev ? changedStates : ['(first version)'],
      added: prev ? after.filter((l) => !before.has(l)).slice(0, 40).map(cut) : [],
      removed: prev ? [...before].filter((l) => !afterSet.has(l)).slice(0, 40).map(cut) : [],
    };
  }).filter(Boolean);
  console.log(JSON.stringify(list, null, 2));
  process.exit(0);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'history', 'shots'), { recursive: true });

// ---------- 2. history: newest frames first, screenshots stored once per distinct image ----------
const keep = [], seen = new Set();
for (const f of [...manifest.frames].reverse()) {
  const shots = f.shots || (f.shot ? [{ state: 'Default', file: f.shot, hash: null }] : []);
  const fresh = shots.filter((s) => !seen.has(s.hash || s.file));
  if (keep.length && seen.size + fresh.length > MAX_SHOTS) break;
  fresh.forEach((s) => seen.add(s.hash || s.file));
  keep.unshift({ ...f, shots });
}
const dropped = manifest.frames.length - keep.length;
if (dropped) warnings.push(`Left out the ${dropped} oldest versions to keep the bundle small`);

const frames = keep.map((f) => ({
  ...f,
  html: null, // reviewers get screenshots of past versions, not their source
  shots: f.shots.map((s) => {
    const key = (s.hash || path.basename(s.file || '', '.webp')).slice(0, 16);
    const src = s.file && path.join(histDir, s.file), dest = `shots/${key}.webp`;
    if (src && fs.existsSync(src) && !fs.existsSync(path.join(out, 'history', dest))) fs.copyFileSync(src, path.join(out, 'history', dest));
    return { ...s, file: dest };
  }),
}));
frames.forEach((f) => { f.shot = f.shots[0]?.file || null; });
const history = { name, title, frames };
fs.writeFileSync(path.join(out, 'history', 'frames.js'), `window.TIMELAPSE = ${JSON.stringify(history)};\n`);
fs.copyFileSync(path.join(TIMELAPSE, 'viewer.html'), path.join(out, 'history', 'index.html'));

// ---------- 3. self-contained prototype ----------
const MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const isLocal = (ref) => !!ref && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
const findLocal = (ref, from) => {
  const p = path.resolve(from, decodeURIComponent(ref.split(/[?#]/)[0]));
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  warnings.push(`Couldn't find ${ref} (it will be missing in the copy)`);
  return null;
};
const dataUri = (p) => `data:${MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(p).toString('base64')}`;
const attr = (tag, a) => tag.match(new RegExp(`\\b${a}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
const cssUrls = (css, from) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
  if (!isLocal(ref)) return m;
  const p = findLocal(ref, from);
  return p ? `url("${dataUri(p)}")` : m;
});

let proto = source;
proto = proto.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => cssUrls(block, dir));
proto = proto.replace(/<link\b[^>]*>/gi, (tag) => {
  if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
  const href = attr(tag, 'href');
  const p = isLocal(href) && findLocal(href, dir);
  return p ? `<style>/* ${href} */\n${cssUrls(fs.readFileSync(p, 'utf8'), path.dirname(p))}\n</style>` : tag;
});
proto = proto.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
  // The toolbar is usually loaded from its hosted copy, which published pages may not load, so
  // the copy gets this plugin's own protokit.js built in.
  const kit = /(^|\/)protokit\.js([?#]|$)/i.test(src) && path.join(HERE, 'protokit.js');
  const p = kit || (isLocal(src) && findLocal(src, dir));
  if (!p) return tag;
  const code = fs.readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script');
  const rest = `${a} ${b}`.replace(/\s+/g, ' ').trim();
  return `<script${rest ? ` ${rest}` : ''}>/* ${path.basename(src)} */\n${code}\n</script>`;
});
proto = proto.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (m, pre, q, src) => {
  const p = isLocal(src) && findLocal(src, dir);
  return p ? `${pre}${q}${dataUri(p)}${q}` : m;
});
const metas = '<meta name="protokit-export" content="1">\n<meta name="protokit-history" content="history/">';
proto = /<head[^>]*>/i.test(proto) ? proto.replace(/<head[^>]*>/i, (m) => `${m}\n${metas}`) : `${metas}\n${proto}`;
if (!/protokit/i.test(source)) warnings.push('This prototype doesn’t load Protokit, so the copy has no toolbar');
fs.writeFileSync(path.join(out, 'prototype.html'), proto);

// ---------- 4. overview page ----------
let comments = [];
try { comments = JSON.parse(source.match(/<script[^>]*id=["']protokit-comments["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || '{}').comments || []; } catch {}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
const day = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const time = (iso) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const CATS = { logic: 'Logic', question: 'Questions', note: 'Notes', reference: 'References' };

const latest = frames.at(-1);
// Screenshot shape: a mobile prototype gets portrait cards and thumbnails.
const shotSize = latest?.viewport || { width: 1440, height: 900 };
const portrait = shotSize.width < shotSize.height;
const shapeVars = `--ar: ${shotSize.width} / ${shotSize.height}; --card-min: ${portrait ? 160 : 250}px; --thumb-w: ${portrait ? 64 : 132}px;`;
const states = latest?.shots || [];
const stateLink = (s) => `prototype.html?${s.params || `state=${slug(s.state)}`}`;
// For each state, the last version that changed how it looks.
const lastChange = (stateName) => {
  for (let i = frames.length - 1; i >= 0; i--) {
    const cur = frames[i].shots.find((s) => s.state === stateName);
    const prev = frames.slice(0, i).reverse().map((f) => f.shots.find((s) => s.state === stateName)).find(Boolean);
    if (cur && (!prev || cur.hash !== prev.hash)) return frames[i];
  }
  return null;
};
const stateComments = (stateName) => comments.filter((c) => c.context?.state && (stateName === c.context.state || stateName.endsWith(` · ${c.context.state}`)));
const commentLink = (c) => {
  const q = new URLSearchParams();
  if (c.context?.variant) q.set('variant', c.context.variant);
  if (c.context?.state) q.set('state', slug(c.context.state));
  if (c.context?.viewport && c.context.viewport !== 'desktop') q.set('viewport', c.context.viewport);
  q.set('comment', c.id);
  return `prototype.html?${q}`;
};
const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);
const where = (c) => [
  c.context?.state || (c.context?.custom ? 'Custom state' : null),
  c.context?.variantLabel || cap(c.context?.variant), // older comments only have the variant's code name
  cap(c.context?.viewport),
].filter(Boolean).join(' \u00b7 ');
const changedIn = (i) => frames[i].shots.filter((s) => {
  const prev = frames.slice(0, i).reverse().map((f) => f.shots.find((p) => p.state === s.state)).find(Boolean);
  return !prev || prev.hash !== s.hash;
});
const range = frames.length ? (day(frames[0].at) === day(latest.at) ? day(latest.at) : `${day(frames[0].at)} – ${day(latest.at)}`) : '';

const stateCards = states.map((s) => {
  const lc = lastChange(s.state), n = stateComments(s.state).length;
  return `<li><a class="state" href="${esc(stateLink(s))}">
      <span class="shot"><img src="history/${esc(s.file)}" alt="${esc(s.state)}, latest version" loading="lazy" decoding="async"></span>
      <span class="state-name">${esc(s.state)}</span>
      <span class="state-meta">${[n ? plural(n, 'comment') : null, lc ? `last changed in #${lc.n}` : null].filter(Boolean).map(esc).join(' · ')}</span>
    </a></li>`;
}).join('\n');

const order = new Map(comments.map((c, i) => [c.id, i + 1]));
const commentGroups = Object.entries(CATS).map(([cat, label]) => {
  const list = comments.filter((c) => (c.category || 'note') === cat);
  if (!list.length) return '';
  return `<div class="cgroup cat-${cat}">
      <h3>${label} <span class="count">${list.length}</span></h3>
      <ul class="clist">${list.map((c) => `
        <li><a class="ccard" href="${esc(commentLink(c))}" title="Show in the prototype">
          <span class="pin" aria-hidden="true">${order.get(c.id)}</span>
          <span class="cbody">
            <span class="ctext">${esc(c.text)}</span>
            <span class="cmeta">${esc(where(c) || 'Everywhere')}${c.only ? ' · only in this state' : ''}</span>
          </span>
          <span class="go" aria-hidden="true">→</span>
        </a></li>`).join('')}
      </ul>
    </div>`;
}).join('\n');

const versions = frames.map((f, i) => {
  const ch = changedIn(i), first = ch[0];
  const replay = `prototype.html?timeline=1&frame=${f.n}${first?.params ? `&${first.params}` : first ? `&state=${slug(first.state)}` : ''}`;
  const thumbs = ch.slice(0, 4).map((s) => `<img src="history/${esc(s.file)}" alt="${esc(s.state)}" loading="lazy" decoding="async" title="${esc(s.state)}">`).join('');
  return `<li class="version">
      <div class="vhead"><span class="vnum">#${f.n}</span><span>${esc(day(f.at))}, ${esc(time(f.at))}</span>${f.stat ? `<span class="diff"><span class="add">+${f.stat.added}</span> <span class="rem">−${f.stat.removed}</span> lines</span>` : ''}</div>
      ${f.summary ? `<p class="vsummary">${esc(f.summary)}</p>` : ''}
      <p class="vchanged">${i === 0 ? `First version, ${plural(f.shots.length, 'state')}` : ch.length ? `Changed ${ch.length} of ${f.shots.length} states` : 'No visible change'}${ch.length && i ? `: ${ch.slice(0, 3).map((s) => esc(s.state)).join(', ')}${ch.length > 3 ? ', …' : ''}` : ''}</p>
      ${thumbs && i ? `<div class="thumbs">${thumbs}</div>` : ''}
      <a class="vlink" href="${esc(replay)}">Replay from here</a>
    </li>`;
}).reverse().join('\n');

const counts = Object.keys(CATS).map((k) => [k, comments.filter((c) => (c.category || 'note') === k).length]).filter(([, n]) => n)
  .map(([k, n]) => [k === 'logic' || n === 1 ? k : `${k}s`, n]);
const page = `<title>${esc(title)} handover</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  /* Spec sheet for engineers: a short masthead with one way in, then states, comments, history. */
  :root {
    --paper: #f5f6f8; --surface: #ffffff; --ink: #14171c; --muted: #5a6270; --line: #dce0e6;
    --accent: #0a66b8; --accent-ink: #ffffff; --hover: #eef3f9;
    --logic: #2457d6; --question: #15803d; --note: #7036d9; --reference: #c42a72; --add: #13804a; --rem: #c8323c;
    --display: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
    --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #111317; --surface: #191c21; --ink: #e8ebf0; --muted: #98a1ae; --line: #2a2e36;
      --accent: #5aaeff; --accent-ink: #0b1220; --hover: #20252d;
      --logic: #7ea4ff; --question: #4cd38a; --note: #b394ff; --reference: #ff7fb5; --add: #4cd38a; --rem: #ff7a82;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --paper: #111317; --surface: #191c21; --ink: #e8ebf0; --muted: #98a1ae; --line: #2a2e36;
    --accent: #5aaeff; --accent-ink: #0b1220; --hover: #20252d;
    --logic: #7ea4ff; --question: #4cd38a; --note: #b394ff; --reference: #ff7fb5; --add: #4cd38a; --rem: #ff7a82;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--paper); color: var(--ink); font: 15px/1.55 var(--body);
    padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding-block: 40px 64px; display: grid; gap: 56px; }
  a { color: var(--accent); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  h1, h2, h3 { font-family: var(--display); font-weight: 600; letter-spacing: -0.01em; text-wrap: balance; margin: 0; }
  h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.05; }
  h2 { font-size: 26px; display: flex; align-items: baseline; gap: 10px; }
  h3 { font-size: 18px; display: flex; align-items: baseline; gap: 8px; }
  .count { font: 500 13px var(--mono); color: var(--muted); }
  .eyebrow { margin: 0; font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .section-head { padding-bottom: 14px; border-bottom: 1px solid var(--line); margin-bottom: 20px; }

  .masthead { display: grid; gap: 18px; justify-items: start; }
  .btn {
    display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border-radius: 8px; text-decoration: none;
    font-weight: 500; background: var(--accent); color: var(--accent-ink);
  }
  .btn:hover { filter: brightness(1.08); }

  .states { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--card-min)), 1fr)); gap: 24px 20px; }
  .state { display: grid; gap: 6px; text-decoration: none; color: var(--ink); }
  .shot { display: block; aspect-ratio: var(--ar); max-width: 100%; overflow: hidden; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); }
  .shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform .2s ease; }
  .state:hover .shot { border-color: var(--accent); }
  .state:hover .shot img { transform: scale(1.02); }
  .state-name { font-weight: 600; line-height: 1.3; }
  .state-meta { font: 12px var(--mono); color: var(--muted); min-height: 1em; }

  .cgroups { display: grid; gap: 28px; }
  .cgroup { --c: var(--note); }
  .cat-logic { --c: var(--logic); } .cat-question { --c: var(--question); } .cat-reference { --c: var(--reference); }
  .cgroup h3::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--c); align-self: center; }
  .clist { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .clist li { background: var(--surface); }
  .ccard { display: flex; gap: 14px; align-items: flex-start; padding: 14px 16px; color: var(--ink); text-decoration: none; transition: background .12s; }
  .ccard:hover { background: var(--hover); }
  .ccard:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 0; }
  .go { margin-left: auto; align-self: center; color: var(--muted); transition: color .12s, transform .12s; }
  .ccard:hover .go { color: var(--accent); transform: translateX(2px); }
  .pin {
    flex: none; width: 26px; height: 26px; border-radius: 50% 50% 50% 4px; background: var(--c); color: var(--surface);
    display: grid; place-items: center; font: 600 12px var(--mono); font-variant-numeric: tabular-nums;
  }
  .cbody { min-width: 0; display: grid; gap: 4px; }
  .ctext { max-width: 70ch; }
  .cmeta { font-size: 13px; color: var(--muted); }

  .versions { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
  .version { position: relative; display: grid; gap: 8px; padding: 0 0 28px 28px; border-left: 2px solid var(--line); margin-left: 6px; }
  .version::before { content: ""; position: absolute; left: -7px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--surface); border: 2px solid var(--accent); }
  .version:last-child { padding-bottom: 0; }
  .vhead { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; font: 13px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
  .vnum { font: 600 17px var(--display); color: var(--ink); }
  .add { color: var(--add); } .rem { color: var(--rem); }
  .vsummary { margin: 0; max-width: 70ch; }
  .vchanged { margin: 0; color: var(--muted); font-size: 14px; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumbs img { width: var(--thumb-w); max-width: 100%; aspect-ratio: var(--ar); object-fit: cover; object-position: top; border-radius: 4px; border: 1px solid var(--line); background: var(--surface); }
  .vlink { font-size: 14px; justify-self: start; }
  footer { color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); padding-top: 16px; }
  @media (prefers-reduced-motion: reduce) { .shot img { transition: none; } }
</style>

<main class="wrap" style="${shapeVars}">
  <header class="masthead">
    <p class="eyebrow">${esc(day(new Date().toISOString()))}</p>
    <h1>${esc(title)}</h1>
    <a class="btn" href="prototype.html">Open the prototype</a>
  </header>

  ${states.length ? `<section id="states" aria-labelledby="states-h">
    <div class="section-head"><h2 id="states-h">States <span class="count">${states.length}</span></h2></div>
    <ul class="states">
${stateCards}
    </ul>
  </section>` : ''}

  ${comments.length ? `<section id="comments" aria-labelledby="comments-h">
    <div class="section-head"><h2 id="comments-h">Comments <span class="count">${comments.length}</span></h2></div>
    <div class="cgroups">${commentGroups}</div>
  </section>` : ''}

  ${frames.length ? `<section id="history" aria-labelledby="history-h">
    <div class="section-head"><h2 id="history-h">How it got here <span class="count">${frames.length}</span></h2></div>
    <ol class="versions" reversed>
${versions}
    </ol>
  </section>` : ''}

  <footer>Made with Protokit and Timelapse. Screenshots are ${shotSize.width}px ${shotSize.width >= 1000 ? 'desktop' : shotSize.width >= 700 ? 'tablet' : 'mobile'} captures.</footer>
</main>
`;
// Entities instead of raw non-ASCII, so the page reads right with or without a declared charset.
fs.writeFileSync(path.join(out, 'index.html'), page.replace(/[^\x00-\x7f]/gu, (c) => `&#${c.codePointAt(0)};`));

// ---------- 5. PR description ----------
const logic = comments.filter((c) => c.category === 'logic');
const md = [
  `## Prototype handover`,
  ``,
  `**[Open the handover]({{HANDOVER_LINK}})**: every state of the prototype, the design comments, and how it got here.`,
  ``,
  `- **States:** ${states.length}${states.length ? ` (${states.slice(0, 6).map((s) => s.state).join(', ')}${states.length > 6 ? ', …' : ''})` : ''}`,
  `- **Comments:** ${comments.length}${counts.length ? ` (${counts.map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}`,
  `- **Versions:** ${frames.length}${range ? `, ${range}` : ''}`,
  ...(logic.length ? [``, `### Logic notes`, ...logic.map((c, i) => `${i + 1}. ${c.text}${where(c) ? ` _(${where(c)})_` : ''}`)] : []),
  ``,
].join('\n');
fs.writeFileSync(path.join(out, 'pr-description.md'), md);

// ---------- summary (for Claude) ----------
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(out).filter((p) => !p.endsWith('pr-description.md'));
const bytes = files.reduce((n, p) => n + fs.statSync(p).size, 0);
console.log(JSON.stringify({
  out,
  page: path.join(out, 'index.html'),
  files: Object.fromEntries(files.filter((p) => !p.endsWith(`${path.sep}index.html`) || p.includes(`${path.sep}history${path.sep}`))
    .map((p) => [path.relative(out, p).split(path.sep).join('/'), p])),
  prDescription: path.join(out, 'pr-description.md'),
  sizeMB: +(bytes / 1048576).toFixed(1),
  counts: { states: states.length, comments: comments.length, versions: frames.length, files: files.length },
  warnings,
}, null, 2));
