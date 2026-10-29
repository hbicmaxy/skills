/*
 * Protokit — a toolbar that sits on top of any HTML prototype.
 *
 * Variants (e.g. current vs prototype), presets, individual state controls, derived read-outs,
 * desktop / tablet / mobile viewports, and a shareable link for whatever you're looking at.
 *
 * Just loading this script gives you the viewport switcher. For the rest, describe the
 * prototype once its state exists:
 *
 *   Protokit.init({
 *     title: 'Billing',
 *     variants: { options: { current: 'Current page', prototype: 'Prototype' }, get: () => ui.design, set: (v) => (ui.design = v) },
 *     state,                       // the object your prototype renders from; the kit reads and writes it
 *     defaults,                    // optional: what "Reset" goes back to (defaults to state at init)
 *     presets: [{ name: 'Trial ended', values: { status: 'trial_ended' } }, …],
 *     controls: [{ group: 'Account' }, { key: 'role', label: 'Viewer', options: { admin: 'Admin', member: 'Member' } }, …],
 *     derived: () => ({ unbilled: … }),
 *     actions: [{ label: 'Show outlines', run: () => … }],
 *     onChange: (state) => render(),   // only needed if your prototype doesn't re-render by itself
 *     capture: { variants: ['prototype'] }, // which variants Timelapse screenshots (default: all)
 *     viewports: ['mobile', 'tablet'],     // sizes to offer (default: all); without desktop, opens at the first
 *     screen: 'screen',                    // for multi-screen apps: the state key saying which screen is showing
 *   });
 *
 * Everything is optional. With no controls, they're generated from the state's keys.
 *
 * Tablet and mobile load the same page again inside a device-sized iframe (a page can't narrow its
 * own window). That copy runs in "frame mode": no toolbar, and its state is mirrored with the
 * toolbar's over postMessage, both ways.
 */
(() => {
  if (window.Protokit) return;

  const FRAME = new URLSearchParams(location.search).has('pk-frame') && window.parent !== window;
  // A handover export (see handover.mjs) is a self-contained copy for reviewers: comments are
  // read-only and the history ships beside it instead of in .timelapse/.
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content;
  const EXPORT = !!meta('protokit-export');
  const VIEWPORTS = {
    desktop: { label: 'Desktop' },
    tablet: { label: 'Tablet', w: 768, h: 1024, radius: 18 },
    mobile: { label: 'Mobile', w: 390, h: 844, radius: 44 },
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .kit {
      --bg: #1e1e1e; --bg2: #2c2c2c; --bg3: #383838; --ink: #f5f5f5; --muted: #a0a0a0; --line: #444;
      --accent: #0d99ff; --accent-ink: #fff;
      font: 12px/1.4 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink); -webkit-font-smoothing: antialiased;
    }
    button, select, input { font: inherit; color: inherit; }
    button { background: none; border: 0; cursor: pointer; border-radius: 6px; }
    button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    svg { width: 16px; height: 16px; display: block; }

    /* ---------- bar ---------- */
    .bar {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483646;
      display: flex; align-items: center; gap: 4px; padding: 4px; max-width: calc(100vw - 32px);
      background: var(--bg); border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.28);
    }
    .bar.collapsed { left: auto; right: 16px; transform: none; }
    .bar.collapsed > :not(.logo) { display: none; }
    .logo { width: 32px; height: 32px; display: grid; place-items: center; flex: none; color: var(--ink); }
    .logo:hover, .ghost:hover { background: var(--bg3); }
    .sep { width: 1px; height: 20px; background: var(--line); margin: 0 2px; flex: none; }
    .seg { display: flex; background: var(--bg2); border-radius: 8px; padding: 2px; flex: none; }
    .seg button { height: 28px; padding: 0 10px; white-space: nowrap; color: var(--muted); }
    .seg button:hover { color: var(--ink); }
    .seg button.on { background: #f5f5f5; color: #1e1e1e; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
    .seg.icons button { width: 32px; padding: 0; display: grid; place-items: center; }
    .ghost { height: 32px; padding: 0 10px; display: flex; align-items: center; gap: 6px; white-space: nowrap; min-width: 0; }
    .ghost.on { background: var(--bg3); }
    .ghost.icon { width: 32px; padding: 0; justify-content: center; color: var(--muted); }
    .ghost.icon:hover { color: var(--ink); }
    .state-btn { max-width: 300px; }
    .state-btn .k { color: var(--muted); }
    .state-btn .v { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    .step { width: 28px; padding: 0; justify-content: center; font-size: 14px; color: var(--muted); }
    .step:hover { color: var(--ink); }
    .step:disabled { opacity: .3; cursor: default; background: none; }

    /* ---------- tooltip ---------- */
    .tip {
      position: fixed; z-index: 2147483647; pointer-events: none; display: flex; align-items: center; gap: 8px;
      padding: 5px 6px 5px 9px; border-radius: 6px; background: var(--bg); color: var(--ink); white-space: nowrap;
      box-shadow: 0 0 0 1px var(--line), 0 4px 14px rgba(0,0,0,.3); opacity: 0; transform: translateY(2px);
      transition: opacity .1s, transform .1s;
    }
    .tip.show { opacity: 1; transform: none; }
    .tip:not(:has(kbd)) { padding-right: 9px; }
    .tip kbd {
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 4px; background: var(--bg3); color: var(--muted);
      font: 600 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center;
    }
    @media (prefers-reduced-motion: reduce) { .tip { transition: none; } }

    /* ---------- device stage ---------- */
    .stage {
      position: fixed; inset: 0; z-index: 2147483645; display: none; overflow: hidden;
      background: #2b2b2b radial-gradient(#3a3a3a 1px, transparent 1px) 0 0 / 20px 20px;
    }
    .stage.on { display: block; }
    .device-label {
      position: absolute; left: 0; right: 0; top: 14px; text-align: center; color: var(--muted); font-variant-numeric: tabular-nums;
    }
    .device-label b { color: var(--ink); font-weight: 600; }
    .device {
      position: absolute; left: 50%; top: 44px; transform-origin: top center; background: #fff; overflow: hidden;
      box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 0 0 10px #111, 0 0 0 11px rgba(255,255,255,.1), 0 24px 60px rgba(0,0,0,.5);
    }
    .device iframe { border: 0; width: 100%; height: 100%; display: block; background: #fff; }

    /* ---------- panel ---------- */
    .panel {
      position: fixed; top: 12px; right: 12px; bottom: 72px; width: 320px; max-width: calc(100vw - 24px);
      z-index: 2147483647; display: none; flex-direction: column;
      background: var(--bg); border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.28);
    }
    .panel.open { display: flex; }
    .phead { display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 14px; border-bottom: 1px solid var(--line); }
    .phead .title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .phead button { width: 28px; height: 28px; color: var(--muted); }
    .phead button:hover { background: var(--bg3); color: var(--ink); }
    .pbody { overflow: auto; flex: 1; padding: 4px 0 12px; }
    .pfoot { display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--line); }
    .pfoot button { flex: 1; height: 30px; background: var(--bg2); }
    .pfoot button:hover { background: var(--bg3); }
    .pfoot button.primary { background: var(--accent); color: var(--accent-ink); }
    h6 {
      margin: 14px 14px 6px; font-size: 11px; font-weight: 600; color: var(--muted);
      text-transform: uppercase; letter-spacing: .04em;
    }
    .search {
      display: block; width: calc(100% - 28px); margin: 0 14px 6px; height: 28px; padding: 0 8px;
      background: var(--bg2); border: 1px solid transparent; border-radius: 6px;
    }
    .search::placeholder { color: var(--muted); }
    .presets { list-style: none; margin: 0; padding: 0 6px; }
    .presets button {
      width: 100%; text-align: left; padding: 6px 8px; display: flex; gap: 8px; align-items: baseline;
    }
    .presets button:hover { background: var(--bg2); }
    .presets button.on { background: var(--accent); color: var(--accent-ink); }
    .presets .n { color: var(--muted); font-variant-numeric: tabular-nums; width: 18px; flex: none; text-align: right; }
    .presets button.on .n { color: rgba(255,255,255,.75); }
    .row { display: grid; grid-template-columns: 1fr 1.2fr; align-items: center; gap: 8px; padding: 3px 14px; }
    .row label { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row select, .row input[type=number], .row input[type=text] {
      width: 100%; height: 28px; padding: 0 6px; background: var(--bg2); border: 1px solid transparent; border-radius: 6px;
    }
    .row select:hover, .row input:hover { border-color: var(--line); }
    .row.disabled { opacity: .4; }
    .row.bool { grid-template-columns: 1fr auto; cursor: pointer; }
    .row.bool label { color: var(--ink); white-space: normal; cursor: pointer; }
    .switch { position: relative; width: 28px; height: 16px; flex: none; }
    .switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .switch span { position: absolute; inset: 0; border-radius: 8px; background: var(--bg3); transition: background .12s; pointer-events: none; }
    .switch span::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
      background: var(--ink); transition: transform .12s;
    }
    .switch input:checked + span { background: var(--accent); }
    .switch input:checked + span::after { transform: translateX(12px); }
    .changed label::after { content: " \u2022"; color: var(--accent); }
    .derived { margin: 0 14px; padding: 8px 10px; background: var(--bg2); border-radius: 6px; font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .derived div { display: flex; gap: 8px; }
    .derived span:first-child { color: var(--muted); }
    .derived span:last-child { margin-left: auto; text-align: right; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px; }
    .actions button { height: 28px; padding: 0 10px; background: var(--bg2); }
    .actions button:hover { background: var(--bg3); }
    .toast {
      position: fixed; left: 50%; bottom: 68px; transform: translateX(-50%); z-index: 2147483647;
      background: var(--bg); color: var(--ink); padding: 6px 12px; border-radius: 8px; opacity: 0; transition: opacity .15s;
      pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,.25);
    }
    .toast.show { opacity: 1; }

    /* ---------- timeline ---------- */
    .tl-view {
      position: fixed; inset: 0; z-index: 2147483645; display: none; overflow: auto; padding: 24px 24px 260px;
      background: #2b2b2b radial-gradient(#3a3a3a 1px, transparent 1px) 0 0 / 20px 20px;
    }
    .tl-view.on { display: block; }
    .tl-view img { display: block; margin: 0 auto; max-width: 100%; background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
    .tl {
      position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); width: min(760px, calc(100vw - 32px));
      z-index: 2147483646; display: none; padding: 10px 12px 12px;
      background: var(--bg); border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.28);
    }
    .tl.open { display: block; }
    /* Share the bottom with the states panel instead of sliding under it. */
    .panel-open .tl { left: calc((100vw - 332px) / 2); width: min(760px, calc(100vw - 364px)); }
    .panel-open .tl-view { padding-right: 344px; }
    .tl-row { display: flex; align-items: center; gap: 6px; }
    .tl-row > button { height: 28px; padding: 0 8px; color: var(--muted); white-space: nowrap; flex: none; }
    .tl-row > button:hover { background: var(--bg3); color: var(--ink); }
    .tl-row > button.on { color: var(--accent); }
    .tl .play { width: 32px; height: 32px; padding: 0; border-radius: 50%; background: #f5f5f5; color: #1e1e1e; display: grid; place-items: center; }
    .tl .play:hover { background: #fff; color: #1e1e1e; }
    .track { position: relative; flex: 1; height: 28px; min-width: 120px; }
    .ticks { position: absolute; left: 7px; right: 7px; top: 50%; height: 0; pointer-events: none; }
    .ticks::before { content: ""; position: absolute; left: 0; right: 0; top: -1px; height: 2px; background: var(--bg3); border-radius: 1px; }
    .tick { position: absolute; top: -3px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: var(--bg); box-shadow: inset 0 0 0 1.5px #6a6a6a; }
    .tick.ch { top: -5px; width: 10px; height: 10px; margin-left: -5px; background: var(--accent); box-shadow: 0 0 0 2px var(--bg); }
    .track input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; cursor: pointer; }
    .track input::-webkit-slider-runnable-track { height: 2px; background: transparent; }
    .track input::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -6px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
    .track input::-moz-range-track { height: 2px; background: transparent; }
    .track input::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
    .tl .skip { display: flex; align-items: center; gap: 6px; flex: none; color: var(--muted); white-space: nowrap; cursor: pointer; padding: 0 4px; }
    .tl .skip:hover { color: var(--ink); }
    .tl-state {
      flex: 0 1 210px; min-width: 0; height: 28px; padding: 0 6px; border: 0; border-radius: 6px;
      background: var(--bg2); color: var(--ink); text-overflow: ellipsis;
    }
    .tl-pos { min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; flex: none; }
    .tl-meta { margin-top: 8px; color: var(--muted); display: flex; gap: 4px 10px; flex-wrap: wrap; align-items: baseline; }
    .tl-meta b { color: var(--ink); }
    .tl-meta .add { color: #3ecf8e; } .tl-meta .rem { color: #ff6b6b; }
    .tl-meta .warn { color: #f5a524; }
    .tl-note { margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tl-links { margin-top: 8px; display: flex; gap: 14px; }
    .tl-links a { color: var(--accent); text-decoration: none; }
    .tl-links a:hover { text-decoration: underline; }
    .tl-empty { display: flex; align-items: center; gap: 8px; }
    .tl-empty span { flex: 1; color: var(--muted); }
    .tl-empty button { width: 28px; height: 28px; color: var(--muted); }
    .hist { color: #f5a524; text-decoration: none; }

    /* ---------- handover ---------- */
    .ho {
      position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); width: min(440px, calc(100vw - 32px));
      z-index: 2147483646; display: none; flex-direction: column; gap: 10px; padding: 14px;
      background: var(--bg); border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.28);
    }
    .ho.open { display: flex; }
    .ho h3 { margin: 0; font-size: 13px; }
    .ho p { margin: 0; color: var(--muted); line-height: 1.5; }
    .ho ul { margin: 0; padding-left: 18px; color: var(--muted); line-height: 1.6; }
    .ho .warn { color: #f5a524; }
    .ho .pfoot { padding: 0; border: 0; }

    /* ---------- comments ---------- */
    .pins { position: fixed; inset: 0; z-index: 2147483644; pointer-events: none; }
    .pin {
      position: absolute; left: -13px; top: -13px; width: 26px; height: 26px; padding: 0; border-radius: 50% 50% 50% 4px;
      color: #fff; font-weight: 700; font-size: 11px; display: grid; place-items: center; pointer-events: auto;
      border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35); cursor: pointer; font-variant-numeric: tabular-nums;
    }
    .pin:hover, .pin.active { box-shadow: 0 0 0 3px rgba(255,255,255,.6), 0 2px 10px rgba(0,0,0,.45); z-index: 1; }
    .pin.static { position: static; flex: none; width: 22px; height: 22px; border-width: 1.5px; box-shadow: none; cursor: inherit; font-size: 10px; }
    .hover-box {
      position: fixed; display: none; z-index: 2147483643; pointer-events: none; border-radius: 3px;
      outline: 1.5px dashed #7c3aed; outline-offset: 1px; background: rgba(124, 58, 237, .06);
    }
    .pop {
      position: fixed; z-index: 2147483647; width: 336px; max-width: calc(100vw - 24px); display: none; flex-direction: column; gap: 8px; padding: 10px;
      background: var(--bg); border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.35);
    }
    .pop.open { display: flex; }
    .pop-head { display: flex; align-items: center; gap: 8px; }
    .pop-head .ctx { flex: 1; min-width: 0; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pop-head .x { width: 24px; height: 24px; color: var(--muted); }
    .pop-head .x:hover { background: var(--bg3); color: var(--ink); }
    .pop textarea {
      width: 100%; resize: vertical; min-height: 64px; padding: 8px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--bg2); color: var(--ink); font: 13px/1.45 inherit; font-family: inherit;
    }
    .pop textarea:focus { outline: none; border-color: var(--accent); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { height: 24px; padding: 0 8px; border-radius: 12px; background: var(--bg2); color: var(--muted); white-space: nowrap; }
    .chip::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--c); margin-right: 6px; vertical-align: 1px; }
    .chip.on { background: var(--bg3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--c); }
    .only { display: flex; align-items: center; gap: 8px; color: var(--muted); cursor: pointer; }
    .only input { margin: 0; accent-color: var(--accent); }
    .pop-foot { display: flex; gap: 6px; }
    .pop-foot .grow { flex: 1; }
    .pop-foot button { height: 28px; padding: 0 12px; background: var(--bg2); }
    .pop-foot button:hover { background: var(--bg3); }
    .pop-foot .primary { background: var(--accent); color: var(--accent-ink); }
    .pop-foot .danger { background: none; color: #ff6b6b; padding: 0 6px; }
    .clist { list-style: none; margin: 0; padding: 4px 6px; }
    .clist button { width: 100%; text-align: left; display: flex; gap: 10px; align-items: flex-start; padding: 8px; }
    .clist button:hover { background: var(--bg2); }
    .clist button.away { opacity: .55; }
    .cbody { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .ctext { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
    .cctx { color: var(--muted); font-size: 11px; }
    .hint { margin: 14px; color: var(--muted); line-height: 1.5; }
    .csave { border-top: 1px solid var(--line); }
    .csave .status { padding: 10px 14px 0; color: var(--muted); }
    .csave .status.warn { color: #f5a524; }
    .csave .pfoot { border-top: 0; }
    .pfoot button:disabled { opacity: .4; cursor: default; }
    .cm-btn { position: relative; }
    .cm-count {
      position: absolute; top: 2px; right: 1px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px;
      background: #7c3aed; color: #fff; font-size: 9px; font-weight: 700; line-height: 15px; text-align: center;
    }
    .hist b { color: var(--ink); }
    @media (max-width: 640px) {
      .state-btn .k, .seg.variants, .bar .sep.v { display: none; }
    }
  `;

  const ICONS = {
    logo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="2.5"/><rect x="2" y="9" width="5" height="5" rx="2.5"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
    desktop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2"/><path d="M5.5 13.5h5M8 11v2.5"/></svg>',
    tablet: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="1.5" width="10" height="13" rx="1.6"/><path d="M7 12.3h2"/></svg>',
    mobile: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4.5" y="1.5" width="7" height="13" rx="1.8"/><path d="M7.2 12.4h1.6"/></svg>',
    rotate: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="6" width="9" height="8" rx="1.2"/><path d="M8 2.2a5.5 5.5 0 0 1 5.8 5.3"/><path d="M12.2 6.2l1.6 1.4 1.3-1.7"/></svg>',
    history: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8"/><path d="M2.2 2.2v2.6h2.6"/><path d="M8 5v3.2l2.2 1.4"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.2v9.6c0 .5.5.8.9.5l7.3-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>',
    handover: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 10V2.5M5 5.2L8 2.3l3 2.9"/><path d="M3 8.5v4.2c0 .5.4.8.8.8h8.4c.4 0 .8-.3.8-.8V8.5"/></svg>',
    comment: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2.2c3.3 0 5.8 2.2 5.8 5s-2.5 5-5.8 5c-.7 0-1.4-.1-2-.3L3 13.4l.8-2.6C2.8 9.9 2.2 8.7 2.2 7.2c0-2.8 2.5-5 5.8-5z"/></svg>',
  };

  const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
  const human = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const plain = (o) => JSON.parse(JSON.stringify(o ?? {}));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pref = {
    get(k, f) { try { const v = localStorage.getItem(`protokit.${k}`); return v == null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { localStorage.setItem(`protokit.${k}`, JSON.stringify(v)); } catch {} },
  };
  const b64 = {
    enc: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))),
  };
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };

  let cfg = null, defaults = {}, presets = [], controls = [], variantKeys = [];
  let applied = null; // name of the last preset applied via an apply() function (can't be matched by value)
  let root, bar, panel, toast, stage, open = false, query = '';
  let viewport = 'desktop', rotated = false, frame = null;
  // The sizes this prototype offers (config.viewports), and the one it opens at.
  let sizes = Object.keys(VIEWPORTS), homeSize = 'desktop';
  const sizeOf = (v) => (v === 'desktop' ? { w: 1440, h: 900 } : { w: VIEWPORTS[v].w, h: VIEWPORTS[v].h });
  const hasStates = () => !!(cfg.state || presets.length);

  // ---------- state ----------
  const state = () => cfg.state || {};
  const variant = () => cfg.variants?.get?.();
  // remote: the change came from the other copy of the page, so don't echo it back.
  function changed(remote, extra) {
    tlPinned = null;
    cfg.onChange?.(state());
    if (!FRAME) syncUrl();
    if (!remote) pushToFrame(extra);
    refresh();
  }
  function setValues(patch) {
    Object.assign(state(), patch);
    applied = null;
    changed();
  }
  function applyPreset(p, remote) {
    if (!p) return;
    if (p.apply) { p.apply(state()); applied = p.name; }
    else { Object.assign(state(), plain(defaults), plain(p.values)); applied = null; }
    changed(remote, p.apply ? { preset: p.name } : undefined);
  }
  function setVariant(v) {
    if (!cfg.variants || v === variant()) return;
    cfg.variants.set(v);
    changed();
  }
  function reset() {
    applied = null;
    Object.assign(state(), plain(defaults));
    changed();
  }
  function runAction(i, remote) {
    cfg.actions[i].run();
    if (!remote) frame?.post({ type: 'action', i });
    changed(true);
  }
  function currentPreset() {
    if (applied) return presets.find((p) => p.name === applied) || null;
    const s = plain(state());
    return presets.find((p) => p.values && same(
      Object.fromEntries(Object.keys(s).map((k) => [k, k in p.values ? p.values[k] : defaults[k]])), s)) || null;
  }
  function diff() {
    const s = plain(state()), d = {};
    for (const k of Object.keys(s)) if (!same(s[k], defaults[k])) d[k] = s[k];
    return d;
  }

  // ---------- links ----------
  // ?variant=prototype&state=trial-ended&viewport=mobile, or &custom=<changes from defaults> for hand-tuned states.
  function stateParams(u) {
    ['variant', 'state', 'custom'].forEach((k) => u.searchParams.delete(k));
    if (cfg.variants) u.searchParams.set('variant', variant());
    const p = currentPreset(), d = diff();
    if (p) u.searchParams.set('state', slug(p.name));
    else if (Object.keys(d).length) u.searchParams.set('custom', b64.enc(d));
    return u;
  }
  function syncUrl() {
    const u = stateParams(new URL(location.href));
    u.searchParams.delete('viewport');
    u.searchParams.delete('rotated');
    if (viewport !== homeSize) u.searchParams.set('viewport', viewport);
    if (viewport !== 'desktop' && rotated) u.searchParams.set('rotated', '1');
    if (u.href !== location.href) history.replaceState(history.state, '', u);
  }
  function readUrl() {
    const q = new URLSearchParams(location.search);
    // Viewport first: applying a preset below rewrites the URL from the current viewport.
    if (!FRAME && sizes.includes(q.get('viewport'))) viewport = q.get('viewport');
    if (!FRAME) rotated = viewport !== 'desktop' && q.get('rotated') === '1';
    const v = q.get('variant');
    if (v && cfg.variants && v in cfg.variants.options) cfg.variants.set(v);
    const p = q.get('state') && presets.find((x) => slug(x.name) === q.get('state'));
    if (p) applyPreset(p, true);
    else if (q.get('custom')) {
      try { Object.assign(state(), plain(defaults), b64.dec(q.get('custom'))); cfg.onChange?.(state()); } catch {}
    }
  }

  // ---------- the framed copy (tablet / mobile) ----------
  const MSG = 'protokit';
  const snapshot = () => JSON.stringify({ s: plain(state()), v: variant() });

  // Toolbar side: owns the iframe and mirrors state into it.
  function pushToFrame(extra) {
    if (!frame || !hasStates()) return;
    frame.post({ type: 'state', state: plain(state()), variant: variant(), ...extra });
  }
  function onParentMessage(e) {
    if (!frame || e.source !== frame.el.contentWindow || e.data?.[MSG] !== 1) return;
    const m = e.data;
    if (m.type === 'ready') { pushToFrame(applied ? { preset: applied } : undefined); pushComments(); }
    else if (m.type === 'place') { const p = fromFrame(m.x, m.y); placeComment(m.anchor, p.x, p.y); }
    else if (m.type === 'pin') { const p = fromFrame(m.x, m.y); pinClicked(m.id, p.x, p.y); }
    else if (m.type === 'dismiss') closePop();
    else if (m.type === 'missing') say('That comment\u2019s element isn\u2019t on screen in this state');
    else if (m.type === 'sync' && hasStates()) {
      Object.assign(state(), m.state);
      if (cfg.variants && m.variant != null && m.variant !== variant()) cfg.variants.set(m.variant);
      changed(true);
    } else if (m.type === 'key') handleKey(m.key);
  }

  // Frame side: applies what the toolbar sends, and reports changes made by clicking around inside.
  let lastSnap = '';
  function startFrameMode() {
    const toParent = (m) => window.parent.postMessage({ [MSG]: 1, ...m }, '*');
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || e.data?.[MSG] !== 1) return;
      const m = e.data;
      if (m.type === 'state') {
        if (cfg.variants && m.variant != null && m.variant !== variant()) cfg.variants.set(m.variant);
        if (m.preset) applyPreset(presets.find((p) => p.name === m.preset), true);
        else { Object.assign(state(), m.state); cfg.onChange?.(state()); }
      } else if (m.type === 'action') cfg.actions?.[m.i]?.run();
      else if (m.type === 'comments') frameView?.update(m);
      else if (m.type === 'reveal') frameView?.reveal(m.id);
      lastSnap = snapshot();
    });
    if (hasStates()) {
      lastSnap = snapshot();
      setInterval(() => {
        const s = snapshot();
        if (s === lastSnap) return;
        lastSnap = s;
        toParent({ type: 'sync', state: plain(state()), variant: variant() });
      }, 300);
    }
    document.addEventListener('keydown', (e) => {
      if (!typing(e) && !(e.metaKey || e.ctrlKey || e.altKey) && ['\\', '[', ']', 's', 'S', 'v', 'V', 't', 'T', 'c', 'C', 'r', 'R', 'h', 'H', 'Escape'].includes(e.key)) {
        toParent({ type: 'key', key: e.key });
        e.preventDefault();
      }
    });
    startFrameComments(toParent);
    toParent({ type: 'ready' });
  }

  function setViewport(v, rot = rotated) {
    if (!sizes.includes(v)) return;
    viewport = v;
    rotated = viewport !== 'desktop' && rot;
    renderStage();
    syncUrl();
    refresh();
  }
  function renderStage() {
    const vp = VIEWPORTS[viewport];
    if (!vp.w) {
      stage.classList.remove('on');
      stage.replaceChildren();
      frame = null;
      document.documentElement.style.removeProperty('overflow');
      return;
    }
    const w = rotated ? vp.h : vp.w, hgt = rotated ? vp.w : vp.h;
    if (!frame) {
      const u = stateParams(new URL(location.href));
      ['viewport', 'rotated'].forEach((k) => u.searchParams.delete(k));
      u.searchParams.set('pk-frame', '1');
      const el = h('iframe', { src: u.href, title: `${vp.label} preview` });
      frame = { el, post: (m) => el.contentWindow?.postMessage({ [MSG]: 1, ...m }, '*') };
      stage.replaceChildren(h('div', { class: 'device-label' }), h('div', { class: 'device' }, el));
    }
    const device = stage.querySelector('.device');
    Object.assign(device.style, { width: `${w}px`, height: `${hgt}px`, borderRadius: `${vp.radius}px`, marginLeft: `${-w / 2}px` });
    stage.classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    fitDevice();
  }
  function fitDevice() {
    if (!frame) return;
    const vp = VIEWPORTS[viewport];
    const w = rotated ? vp.h : vp.w, hgt = rotated ? vp.w : vp.h;
    const k = Math.min(1, (innerWidth - 48) / (w + 22), (innerHeight - 44 - 84) / (hgt + 22));
    stage.querySelector('.device').style.transform = `scale(${k})`;
    const label = stage.querySelector('.device-label');
    label.replaceChildren(h('b', {}, vp.label), ` \u00b7 ${w} \u00d7 ${hgt}`, k < 0.999 ? ` \u00b7 ${Math.round(k * 100)}%` : '');
  }

  // ---------- timeline (Timelapse history) ----------
  // Timelapse saves history beside the prototype in .timelapse/<name>/ (frames.js plus screenshots).
  // An old version opened from the timeline lives at .timelapse/<name>/frames/0003.html.
  const HIST = location.pathname.match(/\/\.timelapse\/([^/]+)\/frames\/(\d+)\.html?$/);
  const pageName = HIST ? decodeURIComponent(HIST[1])
    : decodeURIComponent(location.pathname.split('/').pop().replace(/\.html?$/i, '')) || 'index';
  const historyBase = new URL(meta('protokit-history') || (HIST ? '../' : `.timelapse/${encodeURIComponent(pageName)}/`), location.href);
  const SPEEDS = [1, 2, 4];
  let tl = null, tlOpen = false, pos = 0, playTimer = null, pollTimer = null, speed = 1;
  let tlView, tlDrawer, tlEls = null, tlStruct = '';
  let changesOnly = pref.get('changesOnly', true);

  // file:// pages can't fetch JSON, so Timelapse also writes the history as a script.
  function loadHistory(done) {
    const s = document.createElement('script');
    const finish = () => {
      s.remove();
      const d = window.TIMELAPSE;
      if (d?.frames) {
        d.frames.forEach((f) => { if (!f.shots) f.shots = f.shot ? [{ state: 'Default', file: f.shot, hash: null }] : []; });
        tl = d;
      }
      done?.();
    };
    s.onload = finish;
    s.onerror = finish;
    s.src = new URL(`frames.js?t=${Date.now()}`, historyBase).href;
    document.head.append(s);
  }

  // The name Timelapse gave the state on screen (see exposeStates), or null if it isn't one it captures.
  function capturedName(p = currentPreset()) {
    const vs = cfg.variants ? (cfg.capture?.variants || variantKeys) : [null];
    if (cfg.variants && !vs.includes(variant())) return null;
    const prefix = cfg.variants && vs.length > 1 ? `${cfg.variants.options[variant()]} \u00b7 ` : '';
    if (presets.length) return p ? prefix + p.name : null;
    return cfg.variants ? cfg.variants.options[variant()] : null;
  }

  // The state key that says which screen of an app is showing: config.screen, or a control named
  // like one. Used to find the nearest preset when you've clicked into a state that isn't one.
  function screenKey() {
    if (cfg.screen) return cfg.screen;
    const names = ['screen', 'page', 'view', 'route', 'tab'];
    return controls.find((c) => c.key && names.includes(c.key))?.key ?? names.find((k) => k in state()) ?? null;
  }
  // The preset closest to the current state: on the same screen if we know what that means, then
  // the one sharing the most values.
  function closestPreset() {
    const s = plain(state()), key = screenKey();
    let pool = presets.filter((p) => p.values);
    const full = (p) => ({ ...defaults, ...p.values });
    if (key) {
      const sameScreen = pool.filter((p) => same(full(p)[key], s[key]));
      if (sameScreen.length) pool = sameScreen;
    }
    let best = null, bestScore = -1;
    for (const p of pool) {
      const f = full(p), score = Object.keys(s).filter((k) => same(f[k], s[k])).length;
      if (score > bestScore) { best = p; bestScore = score; }
    }
    return best;
  }

  // Which row of screenshots to follow: one picked in the timeline, else the current state if it
  // was captured, else the closest captured state, else the first one.
  let tlPinned = null;
  function track() {
    const frames = tl?.frames || [];
    const captured = (n) => n && frames.some((f) => f.shots.some((s) => s.state === n));
    if (captured(tlPinned)) return { name: tlPinned, exact: true };
    const want = capturedName();
    if (captured(want)) return { name: want, exact: true };
    const near = presets.length ? capturedName(closestPreset()) : null;
    if (captured(near)) return { name: near, exact: false, near: true };
    return { name: frames.at(-1)?.shots[0]?.state ?? 'Default', exact: !presets.length && !cfg.variants, wanted: want };
  }
  // Every state the history has screenshots of, newest version's order first.
  function capturedStates() {
    const names = [];
    [...(tl?.frames || [])].reverse().forEach((f) => f.shots.forEach((s) => { if (!names.includes(s.state)) names.push(s.state); }));
    return names;
  }
  function pickState(name) {
    stopPlay();
    const p = presets.find((x) => capturedName(x) === name);
    tlPinned = null;
    if (p) applyPreset(p); // the prototype moves there too, so the timeline follows it
    else { tlPinned = name; tlStruct = ''; updateTimeline(); }
  }
  const shotAt = (i, name) => tl.frames[i]?.shots.find((s) => s.state === name) || null;
  function changedAt(i, name) {
    const s = shotAt(i, name);
    if (!s) return false;
    for (let j = i - 1; j >= 0; j--) { const p = shotAt(j, name); if (p) return !s.hash || s.hash !== p.hash; }
    return true;
  }

  function setTimeline(v) {
    tlOpen = v;
    stopPlay();
    clearInterval(pollTimer);
    tlDrawer.classList.toggle('open', v);
    bar.querySelector('.tl-btn')?.classList.toggle('on', v);
    if (!v) { tlView.classList.remove('on'); return; }
    tlStruct = '';
    loadHistory(() => {
      pos = Math.max(0, (tl?.frames.length ?? 0) - 1); // the latest version
      const i = pendingFrame ? tl?.frames.findIndex((f) => f.n === pendingFrame) ?? -1 : -1;
      if (i >= 0) pos = i;
      pendingFrame = null;
      updateTimeline();
      preload();
    });
    // Pick up frames Timelapse saves while the timeline is open.
    pollTimer = setInterval(() => {
      const n = tl?.frames.length ?? 0;
      loadHistory(() => {
        if ((tl?.frames.length ?? 0) === n) return;
        if (pos >= n - 1) pos = tl.frames.length - 1; // stay on the latest
        updateTimeline();
      });
    }, 5000);
  }
  function preload() {
    if (!tl) return;
    const t = track();
    tl.frames.forEach((f, i) => { const s = shotAt(i, t.name) || f.shots[0]; if (s) new Image().src = new URL(s.file, historyBase).href; });
  }

  function go(i) {
    const n = tl?.frames.length ?? 0;
    pos = Math.max(0, Math.min(n - 1, i));
    updateTimeline();
  }
  // How many versions changed how a state looks.
  const changeCount = (name) => (tl?.frames || []).filter((_, i) => changedAt(i, name)).length;
  // Shift+arrows: the previous or next version where the followed state changed.
  function jumpChange(dir) {
    const n = tl?.frames.length ?? 0, name = track().name;
    for (let j = pos + dir; j >= 0 && j < n; j += dir) if (changedAt(j, name)) return go(j);
  }
  // The next version play should show, or -1 at the end.
  function nextIndex(from) {
    const n = tl.frames.length, name = track().name;
    for (let j = from + 1; j < n; j++) if (!changesOnly || changedAt(j, name)) return j;
    return -1;
  }
  function stopPlay() {
    clearInterval(playTimer);
    playTimer = null;
    if (tlEls) tlEls.play.innerHTML = ICONS.play;
  }
  function togglePlay() {
    if (!tl?.frames.length) return;
    if (playTimer) return stopPlay();
    // At the end, play starts again from the beginning.
    if (nextIndex(pos) < 0) pos = Math.max(0, nextIndex(-1));
    updateTimeline();
    playTimer = setInterval(() => {
      const next = nextIndex(pos);
      if (next < 0) return stopPlay();
      go(next);
      if (nextIndex(next) < 0) stopPlay();
    }, 800 / speed);
    tlEls.play.innerHTML = ICONS.pause;
  }

  // Rebuilds the drawer when the history or the followed state changes; otherwise just moves the playhead.
  function updateTimeline() {
    if (!tlOpen) return;
    const frames = tl?.frames || [], n = frames.length, t = track();
    const struct = [n, t.name].join('|');
    if (struct !== tlStruct) {
      tlStruct = struct;
      if (!n) {
        tlEls = null;
        tlView.classList.remove('on');
        tlDrawer.replaceChildren(h('div', { class: 'tl-empty' },
          h('b', {}, 'No history yet'),
          h('span', {}, 'Timelapse saves a frame after each Claude turn that changes this prototype.'),
          h('button', { title: 'Close (T)', 'aria-label': 'Close timeline', onclick: () => setTimeline(false) }, '\u2715')));
        return;
      }
      const range = h('input', {
        type: 'range', min: 0, max: Math.max(0, n - 1), step: 1, 'aria-label': 'Timeline position',
        oninput: (e) => { stopPlay(); go(+e.target.value); },
      });
      tlEls = {
        range,
        play: h('button', { class: 'play', title: 'Play (Space)', 'aria-label': 'Play or pause', html: playTimer ? ICONS.pause : ICONS.play, onclick: togglePlay }),
        pos: h('span', { class: 'tl-pos' }),
        picker: h('select', { class: 'tl-state', 'aria-label': 'State to show', title: 'State to show (versions where it changed)', onchange: (e) => pickState(e.target.value) },
          capturedStates().map((s) => h('option', { value: s }, `${s} (${changeCount(s)} of ${n})`))),
        speed: h('button', { title: 'Playback speed', onclick: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; if (playTimer) { stopPlay(); togglePlay(); } updateTimeline(); } }),
        meta: h('div', { class: 'tl-meta' }),
        note: h('div', { class: 'tl-note' }),
        links: h('div', { class: 'tl-links' }),
      };
      tlDrawer.replaceChildren(
        h('div', { class: 'tl-row' },
          tlEls.play,
          h('div', { class: 'track' },
            h('div', { class: 'ticks' },
              frames.map((_, i) => h('span', { class: changedAt(i, t.name) ? 'tick ch' : 'tick', style: `left:${n > 1 ? (i / (n - 1)) * 100 : 0}%` }))),
            range),
          tlEls.pos,
          tlEls.picker,
          tlEls.speed,
          h('label', { class: 'skip', title: 'When playing, skip versions where this state looks the same' },
            h('span', { class: 'switch' },
              h('input', { type: 'checkbox', checked: changesOnly, 'aria-label': 'Skip unchanged versions when playing',
                onchange: (e) => { changesOnly = e.target.checked; pref.set('changesOnly', changesOnly); } }),
              h('span')),
            'Skip unchanged'),
          h('button', { title: 'Close (T)', 'aria-label': 'Close timeline', onclick: () => setTimeline(false) }, '\u2715')),
        tlEls.meta, tlEls.note, tlEls.links,
      );
    }
    if (!tlEls) return;

    const f = frames[Math.min(pos, n - 1)];
    tlEls.range.value = pos;
    tlEls.pos.textContent = `${pos + 1} / ${n}`;
    tlEls.speed.textContent = `${speed}\u00d7`;
    if (tlEls.picker.value !== t.name) tlEls.picker.value = t.name;
    tlEls.picker.style.display = capturedStates().length > 1 ? '' : 'none';
    tlView.classList.add('on');
    const shot = shotAt(pos, t.name) || f.shots[0];
    const img = tlView.querySelector('img'), src = shot ? new URL(shot.file, historyBase).href : '';
    if (img.getAttribute('src') !== src) {
      // Screenshots are taken at 2x, so half the image's width is its size on screen.
      img.onload = () => { img.style.width = `${img.naturalWidth / 2}px`; };
      img.setAttribute('src', src);
    }
    img.alt = `Frame ${f.n}${shot ? `, ${shot.state}` : ''}`;

    const at = new Date(f.at);
    const meta = [
      h('b', {}, `#${f.n}`),
      h('span', {}, `${at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
    ];
    if (f.stat) meta.push(h('span', {}, h('span', { class: 'add' }, `+${f.stat.added}`), ' ', h('span', { class: 'rem' }, `\u2212${f.stat.removed}`)));
    if (shot) meta.push(h('span', {}, shot.state === 'Default' ? '' : `${shot.state}${changedAt(pos, shot.state) ? ' \u00b7 changed' : ' \u00b7 unchanged'}`));
    if (shot && shot.state !== 'Default') meta.push(h('span', {}, `changed in ${changeCount(shot.state)} of ${n} versions`));
    if (t.near) meta.push(h('span', {}, 'closest captured state to what\u2019s on screen'));
    else if (!t.exact && t.wanted !== undefined) {
      meta.push(h('span', { class: 'warn' }, t.wanted ? `\u201c${t.wanted}\u201d isn\u2019t in the history yet` : 'This state isn\u2019t captured'));
    }
    const shotW = f.viewport?.width ?? 1440, nowW = (rotated ? sizeOf(viewport).h : sizeOf(viewport).w);
    if (shotW !== nowW) meta.push(h('span', { class: 'warn' }, `Screenshots are ${shotW >= 1000 ? 'desktop' : shotW >= 700 ? 'tablet' : 'mobile'} size`));
    tlEls.meta.replaceChildren(...meta);
    // A one-line summary of what changed, never the prompt behind it.
    tlEls.note.textContent = f.summary || '';

    const links = [];
    if (f.html) {
      const version = stateParams(new URL(f.html, historyBase));
      if (viewport !== homeSize) version.searchParams.set('viewport', viewport);
      links.push(h('a', { href: version.href, target: '_blank', title: 'Open this version as a working prototype, in the current state' }, 'Open this version \u2197'));
    }
    links.push(h('a', { href: new URL('index.html', historyBase).href, target: '_blank' }, 'All frames \u2197'));
    tlEls.links.replaceChildren(...links);
  }

  // Shown on a past version opened from the timeline: which one it is, and a way back.
  function latestUrl() {
    const u = stateParams(new URL(`../../../${encodeURIComponent(pageName)}.html`, location.href));
    if (viewport !== homeSize) u.searchParams.set('viewport', viewport);
    return u.href;
  }

  // ---------- comments ----------
  // Pins are anchored to the element you clicked (a selector plus its text, and where inside it), so
  // they follow that element across states, layout changes and viewports. Comments live in the
  // prototype file, in <script type="application/json" id="protokit-comments">; edits are kept in
  // this browser until they're saved back into the file.
  const CATS = {
    note: { label: 'Note', color: '#7c3aed' },
    logic: { label: 'Logic', color: '#2563eb' },
    question: { label: 'Question', color: '#15803d' },
    reference: { label: 'Reference', color: '#db2777' },
  };
  const COMMENTS_ID = 'protokit-comments';
  const LS_COMMENTS = `comments.${location.pathname}`;
  let comments = [], fileComments = [], cmMode = false, activeId = null;
  let pinLayer, hoverBox, pop, cpanel, cmLoop = null, frameView = null;
  const pinEls = new Map(), anchored = new Map(); // comment id -> pin element / resolved element

  const hashOf = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return String(x >>> 0); };
  const textOf = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function readFileComments() {
    try { return JSON.parse(document.getElementById(COMMENTS_ID)?.textContent || '{}').comments || []; } catch { return []; }
  }
  // Unsaved edits in this browser, merged over whatever the file has now (Claude may have saved or
  // added comments since).
  function loadComments() {
    fileComments = readFileComments();
    if (HIST) { comments = plain(fileComments); return; }
    const local = pref.get(LS_COMMENTS, null);
    if (!local) { comments = plain(fileComments); return; }
    if (local.base === hashOf(JSON.stringify(fileComments))) { comments = local.comments; return; }
    const base = new Set(local.baseIds || []), mine = new Map(local.comments.map((c) => [c.id, c]));
    const merged = fileComments
      .filter((c) => !(base.has(c.id) && !mine.has(c.id))) // deleted here since the last save
      .map((c) => (mine.has(c.id) && (mine.get(c.id).updated || '') > (c.updated || '') ? mine.get(c.id) : c));
    local.comments.forEach((c) => { if (!base.has(c.id) && !merged.some((m) => m.id === c.id)) merged.push(c); });
    comments = merged;
  }
  function persistComments() {
    if (HIST) return;
    pref.set(LS_COMMENTS, { comments, base: hashOf(JSON.stringify(fileComments)), baseIds: fileComments.map((c) => c.id) });
    commentsChanged();
  }
  const unsaved = () => JSON.stringify(comments) !== JSON.stringify(fileComments);
  const commentsJson = () => JSON.stringify({ version: 1, comments }, null, 2);

  function currentContext() {
    const p = currentPreset(), d = diff();
    return {
      variant: cfg.variants ? variant() : null,
      variantLabel: cfg.variants ? cfg.variants.options[variant()] : null,
      state: p ? p.name : null,
      custom: !p && Object.keys(d).length ? d : null,
      viewport,
    };
  }
  function contextLabel(ctx) {
    return [
      ctx.state || (ctx.custom ? 'Custom state' : null),
      ctx.variant && cfg.variants ? cfg.variants.options[ctx.variant] : null,
      ctx.viewport ? VIEWPORTS[ctx.viewport]?.label : null,
    ].filter(Boolean).join(' \u00b7 ');
  }
  // "Only in this state" comments show only when the variant and state match where they were left.
  function inContext(c) {
    if (!c.only) return true;
    const ctx = c.context || {};
    if (cfg.variants && ctx.variant && ctx.variant !== variant()) return false;
    if (ctx.state) return currentPreset()?.name === ctx.state;
    if (ctx.custom) return same(diff(), ctx.custom);
    return true;
  }

  function selectorFor(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (el.id && document.querySelectorAll(`#${CSS_ESCAPE(el.id)}`).length === 1) { parts.unshift(`#${CSS_ESCAPE(el.id)}`); break; }
      const sibs = [...el.parentElement.children].filter((c) => c.tagName === el.tagName);
      const tag = el.tagName.toLowerCase();
      parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(el) + 1})` : tag);
      el = el.parentElement;
    }
    if (!parts[0]?.startsWith('#')) parts.unshift('body');
    return parts.join(' > ');
  }
  function anchorFor(el, x, y) {
    const r = el.getBoundingClientRect();
    return {
      selector: selectorFor(el), text: textOf(el),
      fx: r.width ? +((x - r.left) / r.width).toFixed(3) : 0.5,
      fy: r.height ? +((y - r.top) / r.height).toFixed(3) : 0.5,
    };
  }
  // The selector first; if the page has shifted, the same kind of element with the same text.
  function resolveAnchor(a) {
    let el = null;
    try { el = document.querySelector(a.selector); } catch {}
    if (el && a.text && textOf(el) !== a.text) {
      const tag = (a.selector.trim().split(/[\s>+~]+/).pop().match(/^[a-z][\w-]*/i) || [])[0];
      if (tag) el = [...document.querySelectorAll(tag)].find((e) => textOf(e) === a.text) || el;
    }
    return el;
  }
  function resolveAll() {
    anchored.clear();
    comments.forEach((c) => { const el = c.anchor && inContext(c) ? resolveAnchor(c.anchor) : null; if (el) anchored.set(c.id, el); });
  }
  function pinPoint(c) {
    const el = anchored.get(c.id);
    if (!el?.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + c.anchor.fx * r.width, y: r.top + c.anchor.fy * r.height };
  }

  // Draws pins into whichever page shows the prototype: this one, or the device frame's copy.
  function drawPins() {
    if (!pinLayer) return;
    const show = cmMode;
    pinLayer.style.display = show ? '' : 'none';
    if (!show) return;
    const seen = new Set();
    comments.forEach((c, i) => {
      const pt = pinPoint(c);
      let pin = pinEls.get(c.id);
      if (!pt) { if (pin) pin.style.display = 'none'; return; }
      if (!pin) {
        pin = h('button', { class: 'pin', 'aria-label': `Comment ${i + 1}`,
          onclick: (e) => { e.stopPropagation(); const p = pinPoint(c); (frameView ? frameView.pinClicked : pinClicked)(c.id, p.x, p.y); } });
        pinEls.set(c.id, pin);
        pinLayer.append(pin);
      }
      pin.textContent = i + 1;
      pin.title = c.text;
      pin.style.display = '';
      pin.style.background = (CATS[c.category] || CATS.note).color;
      pin.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
      pin.classList.toggle('active', c.id === activeId);
      seen.add(c.id);
    });
    pinEls.forEach((pin, id) => { if (!seen.has(id)) { pin.remove(); pinEls.delete(id); } });
  }
  function startPinLoop() {
    if (cmLoop) return;
    let last = 0;
    const tick = (t) => {
      if (!cmMode) { cmLoop = null; drawPins(); return; }
      if (t - last > 400) { resolveAll(); last = t; }
      drawPins();
      cmLoop = requestAnimationFrame(tick);
    };
    cmLoop = requestAnimationFrame(tick);
  }

  // Comment mode takes over clicks: hovering outlines what you'd pin to, clicking places a comment.
  const fromKit = (e) => e.composedPath().some((n) => n?.dataset?.protokit !== undefined);
  function bindPlacing(canPlace, place, dismiss) {
    const target = (e) => {
      const t = e.composedPath()[0];
      return t?.nodeType === 1 && t !== document.documentElement && t !== document.body ? t : null;
    };
    document.addEventListener('mousemove', (e) => {
      if (!canPlace() || fromKit(e)) { hoverBox.style.display = 'none'; return; }
      const t = target(e);
      if (!t) { hoverBox.style.display = 'none'; return; }
      const r = t.getBoundingClientRect();
      Object.assign(hoverBox.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }, true);
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick'].forEach((type) => document.addEventListener(type, (e) => {
      if (canPlace() && !fromKit(e)) { e.preventDefault(); e.stopPropagation(); }
    }, true));
    document.addEventListener('click', (e) => {
      if (!canPlace() || fromKit(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (dismiss()) return;
      const t = target(e) || document.body;
      place(anchorFor(t, e.clientX, e.clientY), e.clientX, e.clientY);
    }, true);
  }

  // ----- toolbar side: editing, list, saving -----
  let draft = null; // { comment, isNew }
  function setCommentMode(v) {
    cmMode = v;
    bar.querySelector('.cm-btn')?.classList.toggle('on', v);
    if (v) { setOpen(false); cpanel.classList.add('open'); renderCommentList(); }
    else { closePop(); cpanel.classList.remove('open'); hoverBox.style.display = 'none'; activeId = null; }
    syncPanelClass();
    if (v) { resolveAll(); startPinLoop(); } else drawPins();
    pushComments();
  }
  function commentsChanged() {
    const badge = bar?.querySelector('.cm-count');
    if (badge) { badge.textContent = comments.length || ''; badge.style.display = comments.length ? '' : 'none'; }
    resolveAll();
    if (cpanel?.classList.contains('open')) renderCommentList();
    pushComments();
  }
  function pushComments() {
    frame?.post({ type: 'comments', list: comments, on: cmMode, active: activeId, popOpen: !!pop?.classList.contains('open') });
  }

  // Frame coordinates (inside the scaled device) -> this page's coordinates.
  function fromFrame(x, y) {
    const r = frame.el.getBoundingClientRect(), k = r.width / frame.el.offsetWidth;
    return { x: r.left + x * k, y: r.top + y * k };
  }
  function pinClicked(id, x, y) {
    const c = comments.find((m) => m.id === id);
    if (c) openPop(c, false, x, y);
  }

  function placeComment(anchor, x, y) {
    const now = new Date().toISOString();
    const c = { id: newId(), text: '', category: 'note', anchor, context: currentContext(), only: false, created: now, updated: now };
    openPop(c, true, x, y);
  }
  function closePop() {
    pop.classList.remove('open');
    draft = null;
    activeId = null;
    pushComments();
  }
  // Clicking the page while the editor is open just closes it.
  const dismissPop = () => { if (!pop.classList.contains('open')) return false; closePop(); return true; };

  function openPop(c, isNew, x, y) {
    draft = { comment: plain(c), isNew };
    activeId = isNew ? null : c.id;
    const d = draft.comment, editable = !HIST && !EXPORT;
    const ta = h('textarea', { placeholder: isNew ? 'Add a comment\u2026' : '', rows: 3, 'aria-label': 'Comment' });
    ta.value = d.text;
    ta.readOnly = !editable;
    const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Category' },
      Object.entries(CATS).map(([k, cat]) => h('button', {
        class: d.category === k ? 'chip on' : 'chip', role: 'radio', 'aria-checked': String(d.category === k), style: `--c:${cat.color}`,
        disabled: !editable, onclick: (e) => {
          d.category = k;
          e.currentTarget.parentNode.querySelectorAll('.chip').forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        },
      }, cat.label)));
    const ctx = contextLabel(d.context || {});
    const canScope = !!(d.context?.state || d.context?.custom || (cfg.variants && d.context?.variant));
    const only = h('input', { type: 'checkbox', id: 'pk-only', disabled: !editable });
    only.checked = !!d.only;
    const save = () => {
      const text = ta.value.trim();
      if (!text) { if (!isNew) remove(d.id); closePop(); return; }
      d.text = text; d.only = only.checked; d.updated = new Date().toISOString();
      const i = comments.findIndex((m) => m.id === d.id);
      if (i >= 0) comments[i] = d; else comments.push(d);
      persistComments();
      closePop();
    };
    const remove = (id) => { comments = comments.filter((m) => m.id !== id); persistComments(); };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
    });
    const n = comments.findIndex((m) => m.id === d.id);
    pop.replaceChildren(...[
      h('div', { class: 'pop-head' },
        h('span', { class: 'pin static', style: `background:${(CATS[d.category] || CATS.note).color}` }, n >= 0 ? n + 1 : comments.length + 1),
        h('span', { class: 'ctx', title: 'Where this comment was left' }, ctx || 'Comment'),
        h('button', { class: 'x', 'aria-label': 'Close', title: 'Close (Esc)', onclick: closePop }, '\u2715')),
      ta,
      chips,
      canScope ? h('label', { class: 'only', for: 'pk-only' }, only, h('span', {}, `Only in this state${ctx ? ` (${contextLabel({ ...d.context, viewport: null })})` : ''}`)) : null,
      editable ? h('div', { class: 'pop-foot' },
        isNew ? null : h('button', { class: 'danger', onclick: () => { remove(d.id); closePop(); } }, 'Delete'),
        h('span', { class: 'grow' }),
        h('button', { onclick: closePop }, 'Cancel'),
        h('button', { class: 'primary', title: 'Save (\u2318\u21b5)', onclick: save }, isNew ? 'Comment' : 'Save')) : null,
    ].filter(Boolean));
    pop.classList.add('open');
    const w = Math.min(336, innerWidth - 24), ph = pop.offsetHeight || 200;
    pop.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x + 16))}px`;
    pop.style.top = `${Math.max(12, Math.min(innerHeight - ph - 72, y - 20))}px`;
    pushComments();
    if (editable) setTimeout(() => ta.focus(), 0);
  }

  function renderCommentList() {
    const vis = new Set(comments.filter((c) => anchored.has(c.id)).map((c) => c.id));
    const list = h('ul', { class: 'clist' }, comments.map((c, i) => h('li', {},
      h('button', { class: vis.has(c.id) || frame ? '' : 'away', onclick: () => goToComment(c) },
        h('span', { class: 'pin static', style: `background:${(CATS[c.category] || CATS.note).color}` }, i + 1),
        h('span', { class: 'cbody' },
          h('span', { class: 'ctext' }, c.text),
          h('span', { class: 'cctx' }, [contextLabel(c.context || {}), c.only ? 'only here' : null].filter(Boolean).join(' \u00b7 ')))))));
    const readOnly = HIST || EXPORT;
    const fsa = 'showOpenFilePicker' in window && !readOnly;
    cpanel.replaceChildren(
      h('div', { class: 'phead' },
        h('div', { class: 'title' }, `Comments \u00b7 ${comments.length}`),
        h('button', { title: 'Close list', 'aria-label': 'Close comment list', onclick: () => { cpanel.classList.remove('open'); syncPanelClass(); } }, '\u2715')),
      h('div', { class: 'pbody' },
        comments.length ? list : h('p', { class: 'hint' }, readOnly ? 'No comments.' : 'Click anywhere on the prototype to leave a comment. It sticks to the element you click, in every state and size where that element appears.')),
      h('div', { class: 'csave' },
        h('div', { class: unsaved() ? 'status warn' : 'status' }, HIST ? 'Comments from this version (read-only)' : EXPORT ? 'Comments from the handover (read-only)' : unsaved() ? 'Not saved to the file yet \u2014 kept in this browser' : 'All comments are saved in the file'),
        readOnly ? null : h('div', { class: 'pfoot' },
          h('button', { class: fsa ? '' : 'primary', disabled: !comments.length && !unsaved(), onclick: copyForClaude }, 'Copy for Claude'),
          fsa ? h('button', { class: 'primary', disabled: !unsaved(), onclick: saveToFile }, 'Save to file') : null)),
    );
  }

  function goToComment(c) {
    const ctx = c.context || {};
    if (cfg.variants && ctx.variant && ctx.variant !== variant()) cfg.variants.set(ctx.variant);
    const p = ctx.state && presets.find((x) => x.name === ctx.state);
    if (p && currentPreset() !== p) applyPreset(p);
    else if (ctx.custom && !same(diff(), ctx.custom)) { Object.assign(state(), plain(defaults), ctx.custom); applied = null; }
    changed();
    if (ctx.viewport && ctx.viewport !== viewport && sizes.includes(ctx.viewport)) setViewport(ctx.viewport);
    setTimeout(() => {
      if (frame) { frame.post({ type: 'reveal', id: c.id }); return; }
      resolveAll();
      const el = anchored.get(c.id);
      if (!el) { say('That comment\u2019s element isn\u2019t on screen in this state'); return; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { const pt = pinPoint(c); if (pt) openPop(c, false, pt.x, pt.y); }, 450);
    }, frame ? 600 : 150);
  }

  async function copyForClaude() {
    const where = location.protocol === 'file:' ? decodeURIComponent(location.pathname) : location.href.split('?')[0];
    const text = `Save my Protokit comments into ${where}\n\nReplace the contents of <script type="application/json" id="${COMMENTS_ID}"> with the JSON below (add the block just before </body> if it isn't there yet):\n\n\`\`\`json\n${commentsJson()}\n\`\`\`\n`;
    try { await navigator.clipboard.writeText(text); say('Copied \u2014 paste it to Claude'); }
    catch { say('Copy failed'); }
  }

  // Chrome, Edge and Arc can write the file directly (Brave and Safari can't).
  const idb = (mode, fn) => new Promise((resolve, reject) => {
    const req = indexedDB.open('protokit', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('handles', mode), r = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
  function withCommentsBlock(html) {
    const block = `<script type="application/json" id="${COMMENTS_ID}">\n${commentsJson().replace(/</g, '\\u003c')}\n</script>`;
    const re = new RegExp(`<script[^>]*id=["']${COMMENTS_ID}["'][^>]*>[\\s\\S]*?</script>`, 'i');
    if (re.test(html)) return html.replace(re, () => block);
    const i = html.toLowerCase().lastIndexOf('</body>');
    return i >= 0 ? `${html.slice(0, i)}${block}\n${html.slice(i)}` : `${html}\n${block}\n`;
  }
  async function saveToFile() {
    try {
      let handle = await idb('readonly', (s) => s.get(location.pathname)).catch(() => null);
      if (!handle) {
        say('Pick this prototype\u2019s file to save into');
        [handle] = await window.showOpenFilePicker({ types: [{ description: 'Prototype', accept: { 'text/html': ['.html', '.htm'] } }] });
      }
      if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
        && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      const html = await (await handle.getFile()).text();
      const expected = decodeURIComponent(location.pathname.split('/').pop() || '');
      if (expected && handle.name !== expected && !confirm(`Save comments into ${handle.name}? This page is ${expected}.`)) return;
      const w = await handle.createWritable();
      await w.write(withCommentsBlock(html));
      await w.close();
      await idb('readwrite', (s) => s.put(handle, location.pathname)).catch(() => {});
      fileComments = plain(comments);
      persistComments();
      say('Saved to file');
    } catch (e) {
      if (e?.name !== 'AbortError') say('Couldn\u2019t save \u2014 use Copy for Claude');
    }
  }

  // ----- frame side: the device copy draws pins and reports clicks -----
  function startFrameComments(toParent) {
    const host = h('div', { 'data-protokit': '' });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(h('style', {}, CSS));
    pinLayer = h('div', { class: 'pins' });
    hoverBox = h('div', { class: 'hover-box' });
    shadow.append(h('div', { class: 'kit' }, pinLayer, hoverBox));
    document.body.append(host);
    let popOpen = false;
    bindPlacing(
      () => cmMode,
      (anchor, x, y) => toParent({ type: 'place', anchor, x, y }),
      () => { if (!popOpen) return false; toParent({ type: 'dismiss' }); return true; },
    );
    frameView = {
      pinClicked: (id, x, y) => toParent({ type: 'pin', id, x, y }),
      update(m) {
        comments = m.list || [];
        activeId = m.active;
        popOpen = !!m.active || m.popOpen;
        const was = cmMode;
        cmMode = !!m.on;
        if (!cmMode) hoverBox.style.display = 'none';
        resolveAll();
        if (cmMode && !was) startPinLoop(); else drawPins();
      },
      reveal(id) {
        resolveAll();
        const el = anchored.get(id), c = comments.find((m) => m.id === id);
        if (!el || !c) return toParent({ type: 'missing' });
        el.scrollIntoView({ block: 'center' });
        setTimeout(() => { const pt = pinPoint(c); if (pt) toParent({ type: 'pin', id, x: pt.x, y: pt.y }); }, 150);
      },
    };
  }

  // ---------- handover ----------
  // Bundling a handover needs files and screenshots, so the toolbar asks Claude to run handover.mjs.
  let hoCard = null, pendingFrame = null;
  function toggleHandover(v = !hoCard?.classList.contains('open')) {
    if (!hoCard) return;
    hoCard.classList.toggle('open', v);
    bar.querySelector('.ho-btn')?.classList.toggle('on', v);
    if (!v) return;
    const pending = unsaved();
    hoCard.replaceChildren(
      h('h3', {}, 'Hand this prototype over'),
      h('p', {}, 'Claude bundles it into one private link you can put in a PR:'),
      h('ul', {},
        h('li', {}, 'a screenshot of every state, each opening the prototype in that state'),
        h('li', {}, 'your comments, with Logic notes first for developers'),
        h('li', {}, 'how it got here, prompt by prompt, with the timelapse'),
        h('li', {}, 'a self-contained copy of the prototype, toolbar included')),
      pending ? h('p', { class: 'warn' }, 'Your unsaved comments are included in the request, so Claude saves them first.') : null,
      h('div', { class: 'pfoot' },
        h('button', { onclick: () => toggleHandover(false) }, 'Close'),
        h('button', { class: 'primary', onclick: copyHandoverRequest }, 'Copy request for Claude')));
  }
  async function copyHandoverRequest() {
    const where = location.protocol === 'file:' ? decodeURIComponent(location.pathname) : location.href.split('?')[0];
    let text = `Prepare a Protokit handover for ${where}`;
    if (unsaved()) {
      text += `\n\nFirst save my comments into that file: replace the contents of <script type="application/json" id="${COMMENTS_ID}"> with this JSON (add the block just before </body> if it isn't there):\n\n\`\`\`json\n${commentsJson()}\n\`\`\`\n`;
    }
    try { await navigator.clipboard.writeText(text); say('Copied \u2014 paste it to Claude'); toggleHandover(false); }
    catch { say('Copy failed'); }
  }

  // Links from a handover page can open the timeline at a version, or open a comment.
  function openFromLink() {
    const q = new URLSearchParams(location.search);
    const frameN = +q.get('frame');
    if (q.get('timeline') || frameN) { pendingFrame = frameN || null; setTimeline(true); }
    const c = q.get('comment') && comments.find((m) => m.id === q.get('comment'));
    if (c) { setCommentMode(true); setTimeout(() => goToComment(c), 300); }
  }

  // ---------- tooltips ----------
  // Name and shortcut for the toolbar's buttons, shown as soon as the pointer is over one.
  let tipEl = null;
  function showTip(target) {
    const label = target?.dataset.tip;
    if (!label || bar.classList.contains('collapsed') && !target.classList.contains('logo')) return hideTip();
    tipEl.replaceChildren(h('span', {}, label), target.dataset.key ? h('kbd', {}, target.dataset.key) : null);
    tipEl.classList.add('show');
    const r = target.getBoundingClientRect(), w = tipEl.offsetWidth, ht = tipEl.offsetHeight;
    tipEl.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tipEl.style.top = `${r.top - ht - 8}px`;
  }
  function hideTip() {
    tipEl?.classList.remove('show');
  }
  function bindTips() {
    const over = (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (!t) return hideTip();
      showTip(t);
    };
    bar.addEventListener('pointerover', over);
    bar.addEventListener('pointerleave', hideTip);
    bar.addEventListener('pointerdown', hideTip);
    bar.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) showTip(e.target.closest('[data-tip]')); });
    bar.addEventListener('focusout', hideTip);
  }

  // ---------- ui ----------
  function build() {
    const host = h('div', { id: 'protokit-root', 'data-protokit': '' });
    root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, CSS));
    const kit = h('div', { class: 'kit' });
    stage = h('div', { class: 'stage' });
    bar = h('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Prototype toolbar' });
    panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'States' });
    toast = h('div', { class: 'toast', role: 'status' });
    tlView = h('div', { class: 'tl-view' }, h('img', { alt: '' }));
    tlDrawer = h('div', { class: 'tl', role: 'region', 'aria-label': 'Timeline' });
    pinLayer = h('div', { class: 'pins' });
    hoverBox = h('div', { class: 'hover-box' });
    pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Comment' });
    cpanel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Comments' });
    hoCard = h('div', { class: 'ho', role: 'dialog', 'aria-label': 'Handover' });
    tipEl = h('div', { class: 'tip', role: 'tooltip' });
    kit.append(pinLayer, hoverBox, stage, tlView, bar, tlDrawer, hoCard, panel, cpanel, pop, toast, tipEl);
    root.append(kit);
    document.body.append(host);
    if (pref.get('collapsed', false)) bar.classList.add('collapsed');
    open = hasStates() && pref.get('open', false);
    renderBar();
    bindTips();
    renderPanel();
    if (viewport !== 'desktop') renderStage();
    window.addEventListener('resize', fitDevice);
    window.addEventListener('message', onParentMessage);
    bindPlacing(() => cmMode && !frame && !HIST && !EXPORT, placeComment, dismissPop);
    // The comments block sits at the end of the file, so it may not be parsed yet.
    const loadAll = () => { loadComments(); commentsChanged(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAll); else loadAll();
  }

  function renderBar() {
    const kids = [h('button', {
      class: 'logo', 'data-tip': bar.classList.contains('collapsed') ? 'Show toolbar' : 'Hide toolbar', 'data-key': '\\', 'aria-label': 'Show or hide prototype toolbar',
      html: ICONS.logo, onclick: toggleCollapsed,
    })];
    if (variantKeys.length > 1) {
      kids.push(h('div', { class: 'seg variants', role: 'group', 'aria-label': 'Variant' },
        variantKeys.map((k) => h('button', { 'data-variant': k, onclick: () => setVariant(k) }, cfg.variants.options[k]))));
    }
    if (presets.length || controls.length) {
      if (variantKeys.length > 1) kids.push(h('div', { class: 'sep v' }));
      kids.push(
        h('button', { class: 'ghost step', 'data-step': '-1', 'data-tip': 'Previous state', 'data-key': '[', 'aria-label': 'Previous state', onclick: () => stepPreset(-1) }, '\u2039'),
        h('button', { class: 'ghost state-btn', 'data-tip': 'States', 'data-key': 'S', onclick: () => setOpen(!open) },
          h('span', { class: 'k' }, 'State'), h('span', { class: 'v' }, '')),
        h('button', { class: 'ghost step', 'data-step': '1', 'data-tip': 'Next state', 'data-key': ']', 'aria-label': 'Next state', onclick: () => stepPreset(1) }, '\u203a'),
      );
    }
    // Size controls: the switcher when there's a choice, rotate whenever a device size is possible.
    const sizeControls = [
      sizes.length < 2 ? null : h('div', { class: 'seg icons', role: 'group', 'aria-label': 'Viewport' },
        sizes.map((k) => [k, VIEWPORTS[k]]).map(([k, vp]) => h('button', {
          'data-viewport': k, 'data-tip': `${vp.label}${vp.w ? ` \u00b7 ${vp.w} \u00d7 ${vp.h}` : ''}`, 'data-key': 'V', 'aria-label': vp.label,
          html: ICONS[k], onclick: () => setViewport(k),
        }))),
      sizes.some((k) => k !== 'desktop')
        ? h('button', { class: 'ghost icon rotate', 'data-tip': 'Rotate', 'data-key': 'R', 'aria-label': 'Rotate device', html: ICONS.rotate, onclick: () => setViewport(viewport, !rotated) })
        : null,
    ].filter(Boolean);
    if (kids.length > 1) kids.push(h('div', { class: 'sep' }));
    if (sizeControls.length) kids.push(...sizeControls, h('div', { class: 'sep' }));
    if (HIST) {
      kids.push(h('a', { class: 'ghost hist', href: latestUrl(), 'data-tip': 'A past version from the timeline',
        onclick: (e) => { e.currentTarget.href = latestUrl(); } },
        h('b', {}, `Version #${+HIST[2]}`), h('span', {}, 'Back to latest \u2197')));
    } else {
      kids.push(h('button', { class: 'ghost icon tl-btn', 'data-tip': 'Timeline', 'data-key': 'T', 'aria-label': 'Timeline', html: ICONS.history, onclick: () => setTimeline(!tlOpen) }));
    }
    const cm = h('button', { class: 'ghost icon cm-btn', 'data-tip': 'Comments', 'data-key': 'C', 'aria-label': 'Comments', html: ICONS.comment, onclick: () => setCommentMode(!cmMode) });
    cm.append(h('span', { class: 'cm-count' }));
    kids.push(cm);
    if (!HIST && !EXPORT) kids.push(h('button', { class: 'ghost icon ho-btn', 'data-tip': 'Handover', 'data-key': 'H', 'aria-label': 'Handover', html: ICONS.handover, onclick: () => toggleHandover() }));
    bar.replaceChildren(...kids.filter(Boolean));
  }

  function renderPanel() {
    const body = h('div', { class: 'pbody' });
    if (presets.length) {
      body.append(h('h6', {}, `Presets \u00b7 ${presets.length}`));
      if (presets.length > 8) {
        body.append(h('input', {
          class: 'search', type: 'search', placeholder: 'Filter presets\u2026', value: query, 'aria-label': 'Filter presets',
          oninput: (e) => { query = e.target.value; renderPresetList(); },
        }));
      }
      body.append(h('ul', { class: 'presets' }));
    }
    let groupOpen = false;
    controls.forEach((c) => {
      if (c.group) { body.append(h('h6', {}, c.group)); groupOpen = true; return; }
      if (!groupOpen) { body.append(h('h6', {}, 'Controls')); groupOpen = true; }
      body.append(controlRow(c));
    });
    if (cfg.derived) body.append(h('h6', {}, 'Derived'), h('div', { class: 'derived' }));
    if (cfg.actions?.length) {
      body.append(h('h6', {}, 'Actions'), h('div', { class: 'actions' },
        cfg.actions.map((a, i) => h('button', { onclick: () => runAction(i) }, a.label))));
    }
    panel.replaceChildren(
      h('div', { class: 'phead' },
        h('div', { class: 'title' }, cfg.title || document.title || 'Prototype'),
        h('button', { title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => setOpen(false) }, '\u2715')),
      body,
      h('div', { class: 'pfoot' },
        h('button', { onclick: reset }, 'Reset'),
        EXPORT ? null : h('button', { class: 'primary', onclick: copyLink }, 'Copy link to this state')),
    );
    renderPresetList();
    panel.classList.toggle('open', open);
    syncPanelClass();
  }
  function syncPanelClass() {
    panel.parentNode?.classList.toggle('panel-open', open || !!cpanel?.classList.contains('open'));
  }

  function renderPresetList() {
    const ul = panel.querySelector('.presets');
    if (!ul) return;
    const q = query.trim().toLowerCase();
    ul.replaceChildren(...presets.map((p, i) => [p, i]).filter(([p]) => !q || p.name.toLowerCase().includes(q)).map(([p, i]) =>
      h('li', {}, h('button', { 'data-preset': p.name, onclick: () => applyPreset(p) },
        h('span', { class: 'n' }, i + 1), h('span', {}, p.name)))));
    refresh();
  }

  function controlRow(c) {
    const id = `pk-${slug(c.key)}`;
    let input;
    const read = () => state()[c.key];
    if (c.type === 'boolean') {
      input = h('input', { id, type: 'checkbox', role: 'switch', onchange: (e) => setValues({ [c.key]: e.target.checked }) });
      const row = h('div', { class: 'row bool', 'data-key': c.key },
        h('label', { for: id }, c.label), h('span', { class: 'switch' }, input, h('span')));
      row.sync = () => { input.checked = !!read(); };
      return row;
    }
    if (c.options) {
      const opts = Array.isArray(c.options) ? Object.fromEntries(c.options.map((o) => [o, o])) : c.options;
      input = h('select', { id, onchange: (e) => {
        const raw = e.target.value, orig = Object.keys(opts).find((k) => String(k) === raw);
        setValues({ [c.key]: typeof defaults[c.key] === 'number' ? Number(orig) : orig });
      } }, Object.entries(opts).map(([v, l]) => h('option', { value: v }, l)));
    } else if (c.type === 'number') {
      input = h('input', { id, type: 'number', min: c.min, max: c.max, step: c.step ?? 'any',
        onchange: (e) => setValues({ [c.key]: e.target.value === '' ? null : Number(e.target.value) }) });
    } else {
      input = h('input', { id, type: 'text', onchange: (e) => setValues({ [c.key]: e.target.value }) });
    }
    const row = h('div', { class: 'row', 'data-key': c.key }, h('label', { for: id, title: c.label }, c.label), input);
    row.sync = () => {
      if (root.activeElement !== input) input.value = read() ?? '';
    };
    return row;
  }

  // Keeps the toolbar in step with the prototype, including changes the prototype makes itself.
  function refresh() {
    if (!bar) return;
    if (tlOpen) updateTimeline();
    const v = variant();
    bar.querySelectorAll('[data-variant]').forEach((b) => b.classList.toggle('on', b.dataset.variant === v));
    bar.querySelectorAll('[data-viewport]').forEach((b) => b.classList.toggle('on', b.dataset.viewport === viewport));
    const rot = bar.querySelector('.rotate');
    if (rot) { rot.style.display = viewport === 'desktop' ? 'none' : ''; rot.classList.toggle('on', rotated); }
    const p = currentPreset();
    const label = bar.querySelector('.state-btn .v');
    if (label) label.textContent = p ? p.name : Object.keys(diff()).length ? 'Custom' : 'Default';
    bar.querySelector('.state-btn')?.classList.toggle('on', open);
    const i = p ? presets.indexOf(p) : -1;
    bar.querySelectorAll('[data-step]').forEach((b) => {
      b.disabled = !presets.length || (b.dataset.step === '-1' ? i === 0 : i === presets.length - 1);
    });
    if (!open) return;
    panel.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', !!p && b.dataset.preset === p.name));
    const s = state();
    panel.querySelectorAll('.row').forEach((row) => {
      const c = controls.find((x) => x.key === row.dataset.key);
      row.sync?.();
      const off = !!c?.disabled?.(s);
      row.classList.toggle('disabled', off);
      row.querySelectorAll('input, select').forEach((el) => { el.disabled = off; });
      row.classList.toggle('changed', c && !same(s[c.key], defaults[c.key]));
    });
    const d = panel.querySelector('.derived');
    if (d) {
      let vals = {};
      try { vals = cfg.derived(s) || {}; } catch (e) { vals = { error: e.message }; }
      d.replaceChildren(...Object.entries(vals).map(([k, val]) =>
        h('div', {}, h('span', {}, k), h('span', {}, val == null ? '\u2014' : String(val)))));
    }
  }

  function toggleCollapsed() {
    bar.classList.toggle('collapsed');
    bar.querySelector('.logo').dataset.tip = bar.classList.contains('collapsed') ? 'Show toolbar' : 'Hide toolbar';
    hideTip();
    pref.set('collapsed', bar.classList.contains('collapsed'));
    if (bar.classList.contains('collapsed')) setOpen(false);
  }
  function setOpen(v) {
    open = v && hasStates();
    pref.set('open', open);
    panel.classList.toggle('open', open);
    if (open) cpanel?.classList.remove('open');
    syncPanelClass();
    if (open) bar.classList.remove('collapsed');
    refresh();
  }
  function stepPreset(dir) {
    if (!presets.length) return;
    const i = presets.indexOf(currentPreset());
    const next = i < 0 ? (dir > 0 ? 0 : presets.length - 1) : i + dir;
    if (next < 0 || next >= presets.length) return;
    applyPreset(presets[next]);
    panel.querySelector(`[data-preset="${CSS_ESCAPE(presets[next].name)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  const CSS_ESCAPE = (s) => (window.CSS?.escape ? window.CSS.escape(s) : s.replace(/"/g, '\\"'));
  async function copyLink() {
    syncUrl();
    try { await navigator.clipboard.writeText(location.href); say('Link copied'); }
    catch { say('Copy failed \u2014 the link is in the address bar'); }
  }
  let toastTimer;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
  }

  const typing = (e) => {
    const t = e.composedPath()[0];
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  };
  function handleKey(key) {
    const order = sizes;
    if (key === '\\') toggleCollapsed();
    else if (key === '[') stepPreset(-1);
    else if (key === ']') stepPreset(1);
    else if (key === 's' || key === 'S') { if (!hasStates()) return false; setOpen(!open); }
    else if ((key === 'v' || key === 'V') && order.length > 1) setViewport(order[(order.indexOf(viewport) + 1) % order.length]);
    else if ((key === 't' || key === 'T') && !HIST) setTimeline(!tlOpen);
    else if ((key === 'r' || key === 'R') && viewport !== 'desktop') setViewport(viewport, !rotated);
    else if ((key === 'h' || key === 'H') && !HIST && !EXPORT) toggleHandover();
    else if (key === 'ArrowLeft' && tlOpen) { stopPlay(); go(pos - 1); }
    else if (key === 'ArrowRight' && tlOpen) { stopPlay(); go(pos + 1); }
    else if (key === ' ' && tlOpen) togglePlay();
    else if ((key === 'c' || key === 'C')) setCommentMode(!cmMode);
    else if (key === 'Escape' && pop?.classList.contains('open')) closePop();
    else if (key === 'Escape' && hoCard?.classList.contains('open')) toggleHandover(false);
    else if (key === 'Escape' && cmMode) setCommentMode(false);
    else if (key === 'Escape' && open) setOpen(false);
    else if (key === 'Escape' && tlOpen) setTimeline(false);
    else return false;
    return true;
  }
  function onKey(e) {
    hideTip();
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (tlOpen && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); stopPlay(); return jumpChange(e.key === 'ArrowLeft' ? -1 : 1);
    }
    if (handleKey(e.key)) e.preventDefault();
  }

  // ---------- Timelapse hand-off ----------
  // Timelapse (Prototypes/Timelapse) screenshots every state this lists, after each Claude turn.
  function exposeStates() {
    if (window.timelapse) return; // the prototype declared its own
    const vs = cfg.variants ? (cfg.capture?.variants || variantKeys) : [null];
    const list = [];
    vs.forEach((v) => {
      const prefix = v && vs.length > 1 ? `${cfg.variants.options[v]} \u00b7 ` : '';
      const setV = () => { if (v) cfg.variants.set(v); };
      const params = (p) => new URLSearchParams([...(v ? [['variant', v]] : []), ...(p ? [['state', slug(p.name)]] : [])]).toString();
      if (presets.length) presets.forEach((p) => list.push({ name: prefix + p.name, params: params(p), apply: () => { setV(); applyPreset(p); } }));
      else if (v) list.push({ name: cfg.variants.options[v], params: params(null), apply: () => { setV(); changed(); } });
    });
    // A prototype without desktop is captured at its own default size.
    const size = homeSize === 'desktop' ? null : { width: sizeOf(homeSize).w, height: sizeOf(homeSize).h, mobile: homeSize === 'mobile' };
    if (!list.length && !size) return;
    window.timelapse = {
      prepare: () => { root.host.style.display = 'none'; },
      states: list.length ? list : [{ name: 'Default', apply: () => {} }],
      viewport: size,
    };
  }

  // ---------- public ----------
  let started = false;
  function init(config = {}) {
    if (started) return api;
    started = true;
    cfg = config;
    defaults = plain(config.defaults || config.state);
    presets = (config.presets || []).map((p) => ({
      name: p.name, apply: p.apply, values: p.apply ? null : plain(p.values ?? p.state ?? p.s ?? {}),
    }));
    variantKeys = config.variants ? Object.keys(config.variants.options) : [];
    const wanted = (config.viewports || []).filter((v) => v in VIEWPORTS);
    if (wanted.length) sizes = Object.keys(VIEWPORTS).filter((v) => wanted.includes(v));
    // Opens at desktop when offered, otherwise at the first size listed.
    homeSize = sizes.includes('desktop') ? 'desktop' : (wanted[0] || sizes[0]);
    viewport = homeSize;
    const auto = config.state && !config.controls
      ? Object.keys(defaults).filter((k) => ['boolean', 'number', 'string'].includes(typeof defaults[k])).map((key) => ({ key }))
      : [];
    controls = (config.controls || auto).map((c) => (c.group ? c : {
      ...c,
      label: c.label || human(c.key),
      type: c.type || (c.options ? 'select' : typeof defaults[c.key] === 'boolean' ? 'boolean' : typeof defaults[c.key] === 'number' ? 'number' : 'text'),
    }));
    const start = () => {
      readUrl();
      if (FRAME) return startFrameMode();
      build();
      exposeStates();
      // After the comments block (end of the file) has been read.
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(openFromLink));
      else openFromLink();
      document.addEventListener('keydown', onKey);
      setInterval(refresh, 500);
      refresh();
    };
    document.body ? start() : document.addEventListener('DOMContentLoaded', start);
    return api;
  }

  // Prototypes that never call init still get the toolbar, with the viewport switcher.
  window.addEventListener('load', () => setTimeout(() => init(), 0));

  const api = {
    init, applyPreset: (name) => applyPreset(presets.find((p) => p.name === name)), setValues, setViewport, refresh,
    comments: () => commentsJson(), // for Claude: the comments as they should be saved into the file
  };
  window.Protokit = api;
})();
