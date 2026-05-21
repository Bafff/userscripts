// ==UserScript==
// @name         ADO Hide Debug Logs
// @namespace    https://github.com/baf/userscripts
// @version      0.1.0
// @description  Toggle ##[debug] lines in Azure DevOps pipeline log viewer with one global button covering all jobs/tasks/stages
// @author       baf
// @match        https://dev.azure.com/*/_build/results*
// @match        https://*.visualstudio.com/*/_build/results*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/baf/userscripts/main/ado-hide-debug-logs/ado-hide-debug.user.js
// @downloadURL  https://raw.githubusercontent.com/baf/userscripts/main/ado-hide-debug-logs/ado-hide-debug.user.js
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'ado-hide-debug-logs:hidden';
  const HIDE_CLASS = 'tm-ado-hide-debug';
  const DEBUG_LINE_CLASS = 'tm-ado-debug-line';
  const BTN_ID = 'tm-ado-hide-debug-btn';

  const DEBUG_MARKER = '##[debug]';

  // CSS: hide tagged rows when body has the hide class.
  // Use visibility:collapse on tr (table rows) and display:none on divs to cover both layouts ADO uses.
  const style = document.createElement('style');
  style.textContent = `
    body.${HIDE_CLASS} .${DEBUG_LINE_CLASS} { display: none !important; }
    #${BTN_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 9999;
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid rgba(120,120,120,0.4);
      background: rgba(30,30,30,0.85);
      color: #fff;
      font: 12px/1.2 -apple-system, Segoe UI, sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      user-select: none;
    }
    #${BTN_ID}:hover { background: rgba(50,50,50,0.95); }
    #${BTN_ID}[data-active="true"] { background: #0078d4; border-color: #0078d4; }
  `;
  document.head.appendChild(style);

  const isHidden = () => localStorage.getItem(STORAGE_KEY) === '1';
  const applyBodyState = () => {
    document.body.classList.toggle(HIDE_CLASS, isHidden());
    updateBtn();
  };

  // Mark a single line-row if its text starts with ##[debug] (after the line number gutter).
  function tagRow(row) {
    if (!row || row.classList.contains(DEBUG_LINE_CLASS)) return;
    // ADO renders a tree-item span for the line number first; the actual content is in .content
    const content = row.querySelector('.content');
    const text = (content || row).textContent || '';
    // Trim leading whitespace; the debug marker is at the very start of the log text.
    if (text.trimStart().startsWith(DEBUG_MARKER)) {
      row.classList.add(DEBUG_LINE_CLASS);
    }
  }

  function tagAll(root) {
    const rows = (root || document).querySelectorAll('.line-row');
    rows.forEach(tagRow);
  }

  // MutationObserver: ADO uses a virtual scroller — rows come and go.
  // We tag any new .line-row added to the DOM, plus any subtree-change inside an existing row
  // (text loads asynchronously).
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.classList && n.classList.contains('line-row')) tagRow(n);
          else if (n.querySelectorAll) n.querySelectorAll('.line-row').forEach(tagRow);
        });
      } else if (m.type === 'characterData') {
        // Re-tag the enclosing row if text changed
        const row = m.target.parentElement?.closest?.('.line-row');
        if (row) tagRow(row);
      }
    }
  });

  function startObserving() {
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // Toggle button — single global control, fixed in the corner so it covers any selected job/stage/task.
  function ensureBtn() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Toggle ##[debug] log lines (all jobs/tasks/stages)';
    btn.textContent = 'Hide ##[debug]';
    btn.addEventListener('click', () => {
      const next = !isHidden();
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      applyBodyState();
    });
    document.body.appendChild(btn);
    updateBtn();
  }

  function updateBtn() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const hidden = isHidden();
    btn.dataset.active = hidden ? 'true' : 'false';
    btn.textContent = hidden ? 'Show ##[debug]' : 'Hide ##[debug]';
  }

  // ADO is a SPA — re-tag after URL changes (different job selected = whole log area rebuilt).
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Give ADO a moment to render the new log area
      setTimeout(tagAll, 250);
      setTimeout(tagAll, 1000);
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
