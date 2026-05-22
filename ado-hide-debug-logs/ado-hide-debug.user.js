// ==UserScript==
// @name         ADO Hide Debug Logs
// @namespace    https://github.com/Bafff/userscripts
// @version      0.3.0
// @description  Toggle ##[debug] lines in Azure DevOps pipeline log viewer with one global button covering all jobs/tasks/stages. Sequentially re-packs visible rows so gaps don't appear even when intermediate debug rows are virtualized off-screen.
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
  const HIDE_CLASS = 'tm-ado-hide-debug';
  const DEBUG_LINE_CLASS = 'tm-ado-debug-line';
  const BTN_ID = 'tm-ado-hide-debug-btn';
  const DEBUG_MARKER = '##[debug]';
  const SLOT_SEL = '.bolt-fixed-height-list-row';

  // Persistent line classification across the lifetime of the page.
  // key = `<data-lsec>:<data-line>` → { lineIdx, lsec, isDebug }
  // Built incrementally as rows enter the DOM; survives virtual-scroller eviction.
  const lineMap = new Map();
  let rowHeight = 20;

  const style = document.createElement('style');
  style.textContent = `
    body.${HIDE_CLASS} ${SLOT_SEL}:has(.${DEBUG_LINE_CLASS}) { display: none !important; }
    body.${HIDE_CLASS} .${DEBUG_LINE_CLASS} { display: none !important; }
    #${BTN_ID} {
      position: fixed; right: 16px; bottom: 16px; z-index: 9999;
      padding: 8px 14px; border-radius: 6px;
      border: 1px solid rgba(120,120,120,0.4);
      background: rgba(30,30,30,0.85); color: #fff;
      font: 12px/1.2 -apple-system, Segoe UI, sans-serif;
      cursor: pointer; user-select: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
    #${BTN_ID}:hover { background: rgba(50,50,50,0.95); }
    #${BTN_ID}[data-active="true"] { background: #0078d4; border-color: #0078d4; }
  `;
  document.head.appendChild(style);

  const isHidden = () => localStorage.getItem(STORAGE_KEY) === '1';

  function lineInfo(slot) {
    const lineRow = slot.querySelector('.line-row');
    if (!lineRow) return null;
    const el = slot.querySelector('[data-line]');
    if (!el) return null;
    const lineIdx = parseInt(el.getAttribute('data-line'));
    if (isNaN(lineIdx)) return null;
    return { lineRow, lineIdx, lsec: el.getAttribute('data-lsec') || '', key: (el.getAttribute('data-lsec') || '') + ':' + lineIdx };
  }

  function captureSlot(slot) {
    const info = lineInfo(slot);
    if (!info) return;
    const text = info.lineRow.textContent || '';
    const isDebug = text.trimStart().startsWith(DEBUG_MARKER);
    if (isDebug) info.lineRow.classList.add(DEBUG_LINE_CLASS);
    const existing = lineMap.get(info.key);
    if (!existing || existing.isDebug !== isDebug) {
      lineMap.set(info.key, { lineIdx: info.lineIdx, lsec: info.lsec, isDebug });
    }
  }

  function captureAll() {
    const slots = Array.from(document.querySelectorAll(SLOT_SEL));
    for (const s of slots) captureSlot(s);
    // Detect rowHeight from ADO's set tops (skip slots we've already overridden).
    const samples = [];
    for (const s of slots) {
      if (s.dataset.tmAppliedTop) continue;
      const info = lineInfo(s);
      if (!info) continue;
      const t = parseFloat(s.style.top);
      if (!isNaN(t)) samples.push({ idx: info.lineIdx, top: t });
    }
    if (samples.length >= 2) {
      samples.sort((a, b) => a.idx - b.idx);
      for (let i = 1; i < samples.length; i++) {
        const dIdx = samples[i].idx - samples[i - 1].idx;
        const dTop = samples[i].top - samples[i - 1].top;
        if (dIdx > 0 && dTop > 0) {
          const rh = dTop / dIdx;
          if (rh > 5 && rh < 60) { rowHeight = rh; return; }
        }
      }
    }
  }

  // Each row's "original" position in ADO's layout is derived from its line index.
  const origTopOf = (info) => (info.lineIdx - 1) * rowHeight;

  let packing = false;

  // Sequential-anchor pack: visible (non-debug) rows in the rendered batch are placed at
  // anchor, anchor+rowHeight, anchor+2*rowHeight, ... where anchor = the first non-debug
  // row's original top. This keeps packed content where the user is scrolled to, and
  // — because we don't subtract a `debugs-in-batch` count — it works correctly even
  // when intermediate debug rows are off-screen / virtualized away.
  function applyPack() {
    if (packing) return;
    if (!isHidden()) return;
    packing = true;
    try {
      const slots = Array.from(document.querySelectorAll(SLOT_SEL));
      const items = [];
      for (const s of slots) {
        const info = lineInfo(s);
        if (!info) continue;
        const entry = lineMap.get(info.key);
        if (!entry) continue;
        items.push({ s, info, isDebug: entry.isDebug });
      }
      if (items.length === 0) return;
      items.sort((a, b) => a.info.lineIdx - b.info.lineIdx);

      const firstND = items.find((it) => !it.isDebug);
      if (!firstND) return;
      const anchor = origTopOf(firstND.info);

      let i = 0;
      for (const it of items) {
        if (it.isDebug) continue;
        const target = anchor + i * rowHeight;
        const ts = target + 'px';
        if (it.s.style.top !== ts) it.s.style.setProperty('top', ts);
        it.s.dataset.tmAppliedTop = String(target);
        i++;
      }
    } finally {
      packing = false;
    }
  }

  function applyRestore() {
    if (packing) return;
    packing = true;
    try {
      document.querySelectorAll(SLOT_SEL + '[data-tm-applied-top]').forEach((s) => {
        const info = lineInfo(s);
        if (info) s.style.setProperty('top', origTopOf(info) + 'px');
        delete s.dataset.tmAppliedTop;
      });
    } finally {
      packing = false;
    }
  }

  // Coalesce observer-driven work into one rAF — direct synchronous re-entry would
  // race with ADO's React-based render cycle and lock the page.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      captureAll();
      if (isHidden()) applyPack();
      else applyRestore();
    });
  }

  const obs = new MutationObserver((muts) => {
    if (packing) return;
    let touched = false;
    for (const m of muts) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (n instanceof Element && (n.classList?.contains('line-row') || n.matches?.(SLOT_SEL) || n.querySelector?.('.line-row'))) {
            touched = true;
          }
        });
      } else if (m.type === 'characterData') {
        if (m.target.parentElement?.closest?.('.line-row')) touched = true;
      } else if (m.type === 'attributes' && m.attributeName === 'style') {
        if (m.target instanceof Element && m.target.classList.contains('bolt-fixed-height-list-row')) touched = true;
      }
    }
    if (touched) schedule();
  });

  function startObserving() {
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  function updateBtn(btn) {
    const hidden = isHidden();
    btn.dataset.active = hidden ? 'true' : 'false';
    btn.textContent = hidden ? 'Show ##[debug]' : 'Hide ##[debug]';
  }

  function ensureBtn() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Toggle ##[debug] log lines (all jobs/tasks/stages)';
    btn.addEventListener('click', () => {
      localStorage.setItem(STORAGE_KEY, isHidden() ? '0' : '1');
      document.body.classList.toggle(HIDE_CLASS, isHidden());
      updateBtn(btn);
      if (isHidden()) applyPack();
      else applyRestore();
    });
    document.body.appendChild(btn);
    return btn;
  }

  function init() {
    const btn = ensureBtn();
    document.body.classList.toggle(HIDE_CLASS, isHidden());
    updateBtn(btn);
    captureAll();
    if (isHidden()) applyPack();
    startObserving();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
