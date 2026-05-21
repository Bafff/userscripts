// ==UserScript==
// @name         ADO Hide Debug Logs
// @namespace    https://github.com/Bafff/userscripts
// @version      0.2.0
// @description  Toggle ##[debug] lines in Azure DevOps pipeline log viewer with one global button covering all jobs/tasks/stages. Collapses gaps left by the virtualized list.
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
  // Selector for the absolute-positioned slot that wraps each .line-row in ADO's virtualized list.
  const SLOT_SEL = '.bolt-fixed-height-list-row';

  // CSS:
  //   - hide the whole slot (not just .line-row) so the parent's absolute slot is gone from layout
  //   - :has() is widely supported in modern Chrome; we also keep the .line-row rule as a fallback
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

  // Tag a .line-row whose visible text starts with ##[debug]
  function tagRow(row) {
    if (!row || row.classList.contains(DEBUG_LINE_CLASS)) return;
    const content = row.querySelector('.content');
    const text = (content || row).textContent || '';
    if (text.trimStart().startsWith(DEBUG_MARKER)) {
      row.classList.add(DEBUG_LINE_CLASS);
    }
  }

  function tagAll(root) {
    (root || document).querySelectorAll('.line-row').forEach(tagRow);
  }

  // ─── Repositioning (collapse gaps) ───────────────────────────────────────
  //
  // ADO renders each log line inside an absolutely-positioned wrapper
  // (`.bolt-fixed-height-list-row`) with an inline `top: Npx`. Hiding the
  // wrapper via display:none removes it from layout, but it leaves its
  // absolute slot empty — surviving wrappers stay at their original `top`,
  // so the user sees vertical gaps.
  //
  // Fix: for every surviving wrapper, subtract `(debug-wrappers-above) * rowHeight`
  // from its `top`. We track each wrapper's ORIGINAL top so toggling back
  // restores correctly even after ADO has re-laid-out during scrolls.

  // line-id (data-line + data-lsec) → original top in px
  const origTops = new Map();

  function rowKey(slot) {
    const lineEl = slot.querySelector('[data-line]');
    if (!lineEl) return null;
    return (lineEl.getAttribute('data-line') || '') + ':' + (lineEl.getAttribute('data-lsec') || '');
  }

  function detectRowHeight(slots) {
    const tops = [];
    for (const s of slots) {
      const t = parseFloat(s.style.top);
      if (!isNaN(t)) tops.push(t);
    }
    tops.sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) {
      const d = tops[i] - tops[i - 1];
      if (d > 0) return d;
    }
    return 18; // fallback
  }

  function refreshOrigTops(slots) {
    for (const s of slots) {
      const k = rowKey(s);
      if (!k) continue;
      const currentTop = parseFloat(s.style.top);
      if (isNaN(currentTop)) continue;
      const lastApplied = s.dataset.tmAppliedTop !== undefined ? parseFloat(s.dataset.tmAppliedTop) : null;
      // If current top matches our last-applied, ADO didn't change it; keep stored orig.
      // Otherwise ADO set a fresh top — record as the new original.
      if (lastApplied === null || Math.abs(currentTop - lastApplied) > 0.5) {
        origTops.set(k, currentTop);
      }
    }
  }

  function packLines() {
    const slots = Array.from(document.querySelectorAll(SLOT_SEL));
    if (slots.length === 0) return;

    refreshOrigTops(slots);

    if (!isHidden()) return;

    const rowHeight = detectRowHeight(slots);

    // Build sortable list of (slot, origTop, isDebug)
    const items = [];
    for (const s of slots) {
      const k = rowKey(s);
      const origTop = k ? origTops.get(k) : null;
      if (origTop === undefined || origTop === null) continue;
      items.push({ s, origTop, isDebug: !!s.querySelector('.' + DEBUG_LINE_CLASS) });
    }
    items.sort((a, b) => a.origTop - b.origTop);

    let debugCount = 0;
    for (const it of items) {
      if (it.isDebug) { debugCount++; continue; }
      const target = it.origTop - debugCount * rowHeight;
      const targetStr = target + 'px';
      if (it.s.style.top !== targetStr) {
        it.s.style.setProperty('top', targetStr);
      }
      it.s.dataset.tmAppliedTop = String(target);
    }
  }

  function restoreLines() {
    document.querySelectorAll(SLOT_SEL + '[data-tm-applied-top]').forEach((s) => {
      const k = rowKey(s);
      const orig = k ? origTops.get(k) : null;
      if (orig !== undefined && orig !== null) {
        s.style.setProperty('top', orig + 'px');
      }
      delete s.dataset.tmAppliedTop;
    });
  }

  // Coalesce frequent calls into a single rAF tick
  let scheduled = false;
  function schedulePack() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (isHidden()) packLines();
      else restoreLines();
    });
  }

  // ─── Observer ────────────────────────────────────────────────────────────

  const obs = new MutationObserver((mutations) => {
    let touched = false;
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.classList && n.classList.contains('line-row')) { tagRow(n); touched = true; }
          else if (n.querySelectorAll) {
            const rows = n.querySelectorAll('.line-row');
            if (rows.length) { rows.forEach(tagRow); touched = true; }
          }
        });
      } else if (m.type === 'characterData') {
        const row = m.target.parentElement && m.target.parentElement.closest && m.target.parentElement.closest('.line-row');
        if (row) { tagRow(row); touched = true; }
      } else if (m.type === 'attributes' && m.attributeName === 'style') {
        const t = m.target;
        if (t instanceof Element && t.classList.contains('bolt-fixed-height-list-row')) {
          // ADO repositioned a slot — re-pack
          touched = true;
        }
      }
    }
    if (touched) schedulePack();
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

  // ─── Toggle button ───────────────────────────────────────────────────────

  function updateBtn() {
    const b = document.getElementById(BTN_ID);
    if (!b) return;
    const hidden = isHidden();
    b.dataset.active = hidden ? 'true' : 'false';
    b.textContent = hidden ? 'Show ##[debug]' : 'Hide ##[debug]';
  }

  function applyBodyState() {
    document.body.classList.toggle(HIDE_CLASS, isHidden());
    updateBtn();
    schedulePack();
  }

  function ensureBtn() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Toggle ##[debug] log lines (all jobs/tasks/stages)';
    btn.addEventListener('click', () => {
      localStorage.setItem(STORAGE_KEY, isHidden() ? '0' : '1');
      applyBodyState();
    });
    document.body.appendChild(btn);
  }

  // ADO is a SPA — react to URL changes (different job/task selected)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Different task = a fresh batch of rows; clear position cache so we re-capture originals
      origTops.clear();
      setTimeout(() => { tagAll(); schedulePack(); }, 250);
      setTimeout(() => { tagAll(); schedulePack(); }, 1000);
    }
  }, 500);

  function init() {
    ensureBtn();
    applyBodyState();
    tagAll();
    startObserving();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
