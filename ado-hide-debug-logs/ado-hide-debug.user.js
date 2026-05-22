// ==UserScript==
// @name         ADO Hide Debug Logs
// @namespace    https://github.com/Bafff/userscripts
// @version      0.5.0
// @description  Hide ##[debug] lines in Azure DevOps pipeline log viewer. On toggle, extracts the full log via auto-scroll and renders a compact non-debug-only view in place of ADO's virtualized list — so distant non-debug lines are visible without scrolling through hidden debug rows.
// @author       baf
// @match        https://dev.azure.com/*/_build/results*
// @match        https://*.visualstudio.com/*/_build/results*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Bafff/userscripts/main/ado-hide-debug-logs/ado-hide-debug.user.js
// @downloadURL  https://raw.githubusercontent.com/Bafff/userscripts/main/ado-hide-debug-logs/ado-hide-debug.user.js
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'ado-hide-debug-logs:hidden';
  const COMPACT_ID = 'tm-ado-compact-view';
  const BTN_ID = 'tm-ado-hide-debug-btn';
  const DEBUG_MARKER = '##[debug]';
  const LOG_READER_SEL = '.log-reader';
  const LIST_SEL = '.bolt-fixed-height-list';
  const SLOT_SEL = '.bolt-fixed-height-list-row';

  // ─── State ───────────────────────────────────────────────────────────────
  // 'off'         — debug rows visible, ADO's list shown as normal
  // 'extracting'  — auto-scrolling to capture every line; button disabled
  // 'compact'     — custom view shown, ADO's list hidden
  let state = 'off';
  // Per-task extraction cache. key = `${lsec}:${lineIdx}` → captured row data.
  // Cleared on task switch.
  let extracted = new Map();
  // Order non-debug entries by lineIdx within their lsec; preserve lsec order
  // as we see them (matters for tasks with multiple log sections).
  let lsecOrder = []; // [lsec, ...]
  let currentTaskKey = ''; // detected from URL `t=` param
  let savedScrollTop = 0;
  let extractAbort = false;

  // ─── Styles ──────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #${COMPACT_ID} {
      padding: 0; margin: 0;
      background: inherit;
      font-family: inherit; font-size: inherit; color: inherit;
    }
    #${COMPACT_ID} .tm-ado-compact-row { display: block; white-space: pre; padding: 0; }
    #${COMPACT_ID} .tm-ado-compact-row > .line-row { display: block; }
    /* Hide ADO's virtualized list while the compact view is up */
    .${BTN_ID}-compact-on ${LOG_READER_SEL} > ${LIST_SEL} { display: none !important; }
    #${BTN_ID} {
      position: fixed; right: 16px; bottom: 16px; z-index: 99999;
      padding: 8px 14px; border-radius: 6px;
      border: 1px solid rgba(120,120,120,0.4);
      background: rgba(30,30,30,0.85); color: #fff;
      font: 12px/1.2 -apple-system, Segoe UI, sans-serif;
      cursor: pointer; user-select: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
    #${BTN_ID}:hover { background: rgba(50,50,50,0.95); }
    #${BTN_ID}[data-active="true"] { background: #0078d4; border-color: #0078d4; }
    #${BTN_ID}[disabled] { opacity: 0.6; cursor: progress; }
  `;
  document.head.appendChild(style);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const isHidden = () => localStorage.getItem(STORAGE_KEY) === '1';
  const getScroller = () => document.querySelector(LOG_READER_SEL);
  const getList = () => document.querySelector(LOG_READER_SEL + ' > ' + LIST_SEL)
    || document.querySelector(LIST_SEL);
  const getTaskKey = () => {
    try { return new URL(location.href).searchParams.get('t') || ''; } catch { return ''; }
  };

  function lineMeta(slot) {
    const lr = slot.querySelector('.line-row');
    if (!lr) return null;
    const el = slot.querySelector('[data-line]');
    if (!el) return null;
    const lineIdx = parseInt(el.getAttribute('data-line'));
    if (isNaN(lineIdx)) return null;
    const lsec = el.getAttribute('data-lsec') || '';
    return { lr, lineIdx, lsec, key: lsec + ':' + lineIdx };
  }

  function captureSlot(slot) {
    const m = lineMeta(slot);
    if (!m) return;
    const text = m.lr.textContent || '';
    const isDebug = text.trimStart().startsWith(DEBUG_MARKER);
    const prev = extracted.get(m.key);
    // Only re-clone if not yet captured (initial render) or text grew
    // (ADO sometimes paints lines progressively for live jobs).
    if (prev && prev.text.length >= text.length) return;
    const clone = m.lr.cloneNode(true);
    extracted.set(m.key, { lineIdx: m.lineIdx, lsec: m.lsec, isDebug, text, clone });
    if (!lsecOrder.includes(m.lsec)) lsecOrder.push(m.lsec);
  }

  function captureAllVisible() {
    document.querySelectorAll(SLOT_SEL).forEach(captureSlot);
  }

  // ─── Extraction (auto-scroll) ────────────────────────────────────────────
  function waitFor(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function runExtraction(progressCb) {
    extractAbort = false;
    const sc = getScroller();
    if (!sc) throw new Error('log-reader not found');
    savedScrollTop = sc.scrollTop;
    const total = sc.scrollHeight;
    const stepPx = Math.max(sc.clientHeight - 100, 400);

    captureAllVisible();
    let pos = 0;
    while (pos < total) {
      if (extractAbort) return;
      pos = Math.min(pos + stepPx, total);
      sc.scrollTop = pos;
      // Programmatic scrollTop alone doesn't trigger ADO's virtualizer —
      // it needs a scroll event to react.
      sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      await waitFor(300);
      captureAllVisible();
      if (progressCb) progressCb(Math.min(pos / total, 1));
    }
    // One more pass at the very bottom (in case the last step undershot).
    sc.scrollTop = total;
    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitFor(400);
    captureAllVisible();
    // Restore user's scroll. ADO will render the original viewport-batch back.
    sc.scrollTop = savedScrollTop;
    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  // ─── Custom compact view ─────────────────────────────────────────────────
  function ensureCompactContainer() {
    let c = document.getElementById(COMPACT_ID);
    if (c) return c;
    const sc = getScroller();
    if (!sc) return null;
    c = document.createElement('div');
    c.id = COMPACT_ID;
    sc.appendChild(c);
    return c;
  }

  function renderCompact() {
    const c = ensureCompactContainer();
    if (!c) return;
    c.replaceChildren();
    // Sort: lsec in observed order, lineIdx ascending within lsec
    const lsecIndex = new Map(lsecOrder.map((s, i) => [s, i]));
    const list = Array.from(extracted.values())
      .filter((e) => !e.isDebug)
      .sort((a, b) => {
        const la = lsecIndex.get(a.lsec) ?? 99999;
        const lb = lsecIndex.get(b.lsec) ?? 99999;
        if (la !== lb) return la - lb;
        return a.lineIdx - b.lineIdx;
      });
    const frag = document.createDocumentFragment();
    for (const e of list) {
      const wrap = document.createElement('div');
      wrap.className = 'tm-ado-compact-row';
      wrap.dataset.key = e.lsec + ':' + e.lineIdx;
      // Clone the captured line-row HTML structure so colors/links/spans carry over.
      wrap.appendChild(e.clone.cloneNode(true));
      frag.appendChild(wrap);
    }
    c.appendChild(frag);
  }

  function appendNewNonDebugIfMissing(key) {
    const e = extracted.get(key);
    if (!e || e.isDebug) return;
    const c = document.getElementById(COMPACT_ID);
    if (!c) return;
    if (c.querySelector(`.tm-ado-compact-row[data-key="${CSS.escape(key)}"]`)) return;
    // For live appends, just append at the end. Re-render later for proper ordering
    // if needed; in practice live job logs only grow forward.
    const wrap = document.createElement('div');
    wrap.className = 'tm-ado-compact-row';
    wrap.dataset.key = key;
    wrap.appendChild(e.clone.cloneNode(true));
    c.appendChild(wrap);
  }

  // ─── Toggle handlers ─────────────────────────────────────────────────────
  function setBtn(btn, label, opts = {}) {
    btn.textContent = label;
    btn.disabled = !!opts.disabled;
    if (opts.active !== undefined) btn.dataset.active = opts.active ? 'true' : 'false';
  }

  async function enterCompact(btn) {
    if (state === 'extracting' || state === 'compact') return;
    state = 'extracting';
    setBtn(btn, 'Extracting 0%…', { disabled: true, active: true });
    try {
      await runExtraction((p) => setBtn(btn, `Extracting ${Math.round(p * 100)}%…`, { disabled: true, active: true }));
    } catch (err) {
      console.warn('[ado-hide-debug] extraction failed:', err);
    }
    if (extractAbort) {
      state = 'off';
      setBtn(btn, 'Hide ##[debug]', { disabled: false, active: false });
      return;
    }
    renderCompact();
    document.body.classList.add(BTN_ID + '-compact-on');
    state = 'compact';
    setBtn(btn, 'Show ##[debug]', { disabled: false, active: true });
  }

  function exitCompact(btn) {
    document.body.classList.remove(BTN_ID + '-compact-on');
    const c = document.getElementById(COMPACT_ID);
    if (c) c.replaceChildren();
    state = 'off';
    setBtn(btn, 'Hide ##[debug]', { disabled: false, active: false });
  }

  function onToggleClick(btn) {
    if (state === 'extracting') return; // ignore
    if (state === 'off') {
      localStorage.setItem(STORAGE_KEY, '1');
      enterCompact(btn);
    } else if (state === 'compact') {
      localStorage.setItem(STORAGE_KEY, '0');
      exitCompact(btn);
    }
  }

  // ─── Button ──────────────────────────────────────────────────────────────
  function ensureBtn() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Toggle ##[debug] log lines (all jobs/tasks/stages)';
    setBtn(btn, 'Hide ##[debug]', { disabled: false, active: false });
    btn.addEventListener('click', () => onToggleClick(btn));
    document.body.appendChild(btn);
    return btn;
  }

  // ─── Task switch / live append ───────────────────────────────────────────
  function onTaskChange(btn) {
    extractAbort = true;
    extracted = new Map();
    lsecOrder = [];
    exitCompact(btn);
    // Don't auto-extract for the new task — user opts in by clicking Hide.
    // Reset the persisted flag so they get a clean Show state on load.
    localStorage.setItem(STORAGE_KEY, '0');
  }

  // Live captures (job streaming new lines while in compact mode).
  function onMutation(btn, muts) {
    let touched = false;
    for (const m of muts) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches && n.matches(SLOT_SEL)) { captureSlot(n); touched = true; }
          else if (n.querySelectorAll) n.querySelectorAll(SLOT_SEL).forEach((s) => { captureSlot(s); touched = true; });
        });
      } else if (m.type === 'characterData') {
        const slot = m.target.parentElement?.closest?.(SLOT_SEL);
        if (slot) { captureSlot(slot); touched = true; }
      }
    }
    if (touched && state === 'compact') {
      // Append newly-seen non-debug lines to compact view (no re-render).
      for (const [k, e] of extracted) {
        if (!e.isDebug) appendNewNonDebugIfMissing(k);
      }
    }
  }

  function init() {
    const btn = ensureBtn();
    currentTaskKey = getTaskKey();
    // Don't auto-restore "hidden" on load — extraction takes a couple seconds
    // and surprising the user with auto-scroll is rude. Reset to Show by default.
    if (isHidden()) localStorage.setItem(STORAGE_KEY, '0');

    const obs = new MutationObserver((muts) => onMutation(btn, muts));
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });

    setInterval(() => {
      const k = getTaskKey();
      if (k && k !== currentTaskKey) {
        currentTaskKey = k;
        onTaskChange(btn);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
