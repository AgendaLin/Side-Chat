/**
 * SideChat – Side Conversations for ChatGPT & Claude
 * One docked side conversation per main conversation.
 * (Internal DOM ids / storage keys keep the legacy "tangent" prefix so
 *  existing bindings survive the rename.)
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  const CONFIG = {
    minSelectionLength: 1,   // any non-empty (trimmed) selection shows the Side Chat button
    panelWidth: 480,         // initial docked panel width in pixels
    panelMinWidth: 320
  };

  const PLATFORM = window.location.hostname.includes('claude.ai') ? 'claude' : 'chatgpt';

  const CONTEXT_HASH = '#tangent-side-chat';
  const CONTEXT_STORAGE_KEY = 'tangent-side-chat-context';

  // ============================================
  // STATE
  // ============================================
  let selectedText = '';

  // Scroll origin state (captured at selection time)
  let selectionScrollTop = 0;
  let selectionOriginElements = []; // DOM references to block elements in selection

  // One side chat per main conversation, kept alive for the page session
  const sessionPanels = new Map(); // convKey -> { element, minimized, originScrollTop, originSelectedText, originElements }
  let currentConvKey = null;
  let dockWidth = CONFIG.panelWidth;

  // convKey -> side conversation URL, persisted in the site's localStorage.
  // A binding only exists once the user turns off temporary mode inside the
  // side chat, making it a real saved conversation on the platform.
  const bindings = {};

  // ============================================
  // MAIN CONVERSATION KEY
  // ============================================
  function getConvKey() {
    // Not anchored: ChatGPT project/GPT conversations live under
    // /g/<project>/c/<id>, Claude project chats under /project/.../chat/<id>.
    const path = location.pathname;
    const m = PLATFORM === 'claude'
      ? path.match(/\/chat\/([\w-]+)/)
      : path.match(/\/c\/([\w-]+)/);
    return m ? m[1] : 'new';
  }

  // Bindings live in the site origin's localStorage — no extension
  // permission needed, and they are naturally scoped per platform.
  const BINDINGS_KEY = 'tangent-side-chat-bindings';

  function loadBindings() {
    try {
      Object.assign(bindings, JSON.parse(localStorage.getItem(BINDINGS_KEY) || '{}'));
    } catch (e) { /* corrupted store — start fresh */ }
  }

  function persistBindings() {
    try {
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
    } catch (e) {
      console.log('SideChat: could not persist bindings:', e.message);
    }
  }

  function saveBinding(convKey, url) {
    if (convKey === 'new') return; // no stable identity to bind to
    bindings[convKey] = url;
    persistBindings();
    console.log('SideChat: binding saved for', convKey, '->', url);
  }

  function removeBinding(convKey) {
    delete bindings[convKey];
    persistBindings();
  }

  // ============================================
  // SELECTION ORIGIN CAPTURE
  // ============================================
  const BLOCK_SELECTORS = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6';

  function findNearestBlock(el) {
    if (!el) return null;
    const block = el.closest(BLOCK_SELECTORS);
    if (block) return block;
    // Fallback: walk up and find first element with block-level display
    // (catches KaTeX formulas, code blocks, and other non-standard containers)
    let node = el;
    while (node && node !== document.body) {
      if (node.nodeType === 1) {
        const display = window.getComputedStyle(node).display;
        if (display === 'block' || display === 'flex') {
          return node;
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  function getBlockElementsFromSelection(selection) {
    if (!selection.rangeCount) return [];

    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const endNode = range.endContainer;

    const startEl = startNode.nodeType === 1 ? startNode : startNode.parentElement;
    const endEl = endNode.nodeType === 1 ? endNode : endNode.parentElement;

    const startBlock = findNearestBlock(startEl);
    if (!startBlock) return [];

    const endBlock = findNearestBlock(endEl);

    if (!endBlock || startBlock === endBlock) {
      return [startBlock];
    }

    const ancestor = range.commonAncestorContainer;
    const ancestorEl = ancestor.nodeType === 1 ? ancestor : ancestor.parentElement;
    const allBlocks = ancestorEl.querySelectorAll(BLOCK_SELECTORS);

    const blocks = [];
    let inRange = false;
    for (const block of allBlocks) {
      if (block === startBlock) inRange = true;
      if (inRange) blocks.push(block);
      if (block === endBlock) break;
    }

    return blocks.length > 0 ? blocks : [startBlock];
  }

  // ============================================
  // SIDE CHAT SELECTION BUTTON
  // ============================================
  // A small standalone button that appears next to any non-empty text
  // selection. It never touches the platform's own selection toolbar
  // (Claude's Reply button / ChatGPT's Ask ChatGPT button).
  let sideChatButton = null;
  let selectionDebounce = null;

  function getSideChatButton() {
    if (sideChatButton && sideChatButton.isConnected) return sideChatButton;

    const btn = document.createElement('button');
    btn.id = 'tangent-side-chat-button';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="7" cy="4" r="2.5" fill="currentColor" stroke="none"/>
        <line x1="7" y1="6.5" x2="7" y2="17.5"/>
        <circle cx="7" cy="20" r="2.5" fill="currentColor" stroke="none"/>
        <path d="M7,12 C7,12 7,15 11,15 L17,15 L17,17.5"/>
        <circle cx="17" cy="20" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
      Side Chat
    `;

    // Prevent the mousedown from collapsing the selection before click fires
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSideChatFromSelection();
    });

    document.body.appendChild(btn);
    sideChatButton = btn;
    return btn;
  }

  function hideSideChatButton() {
    if (sideChatButton) sideChatButton.classList.remove('visible');
  }

  function isInsideTangentUI(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!el?.closest('.claude-thread-panel, #tangent-side-chat-button, #tangent-edge-handle');
  }

  function openSideChatFromSelection() {
    const selection = window.getSelection();
    const text = selection.toString().trim();
    hideSideChatButton();
    if (!text) return;

    selectedText = text;
    const scrollContainer = getScrollContainer();
    selectionScrollTop = scrollContainer ? scrollContainer.scrollTop : window.scrollY;
    selectionOriginElements = getBlockElementsFromSelection(selection);

    openSidePanel(text);
  }

  function updateSideChatButton() {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    if (!text || text.length < CONFIG.minSelectionLength ||
        !selection.rangeCount || isInsideTangentUI(selection.anchorNode)) {
      hideSideChatButton();
      return;
    }

    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideSideChatButton();
      return;
    }

    const btn = getSideChatButton();
    btn.classList.add('visible');

    // Place below the end of the selection; flip above if it would overflow.
    // The vertical offset also keeps it clear of the platform's own selection
    // toolbar, which appears directly above/at the selection.
    const btnWidth = btn.offsetWidth || 110;
    const btnHeight = btn.offsetHeight || 32;
    let left = Math.min(rect.right + 6, window.innerWidth - btnWidth - 8);
    let top = rect.bottom + 10;
    if (top + btnHeight > window.innerHeight - 8) {
      top = rect.top - btnHeight - 10;
    }
    btn.style.left = `${Math.max(8, left)}px`;
    btn.style.top = `${Math.max(8, top)}px`;
  }

  // ============================================
  // PERSISTENT EDGE HANDLE
  // ============================================
  // Always-available launcher on the right edge. Dim = no side chat for this
  // conversation (click opens a blank one). Lit with a dot = a side chat is
  // minimized or restorable (click brings it back).
  let edgeHandle = null;

  function createEdgeHandle() {
    const handle = document.createElement('button');
    handle.id = 'tangent-edge-handle';
    handle.title = 'Open Side Chat';
    handle.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="7" cy="4" r="2.5" fill="currentColor" stroke="none"/>
        <line x1="7" y1="6.5" x2="7" y2="17.5"/>
        <circle cx="7" cy="20" r="2.5" fill="currentColor" stroke="none"/>
        <path d="M7,12 C7,12 7,15 11,15 L17,15 L17,17.5"/>
        <circle cx="17" cy="20" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
    `;
    handle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSidePanel('');
    });
    document.body.appendChild(handle);
    edgeHandle = handle;
  }

  function updateEdgeHandle() {
    if (!edgeHandle) return;
    const hasThread = sessionPanels.has(currentConvKey) || !!bindings[currentConvKey];
    edgeHandle.classList.toggle('has-thread', hasThread);
    edgeHandle.title = hasThread ? 'Reopen Side Chat' : 'Open Side Chat';
  }

  // ============================================
  // DOCKED SIDE PANEL
  // ============================================
  // The panel docks to the right edge of the viewport. While it is expanded,
  // <html> gets the `tangent-side-open` class and an inline margin that
  // shrinks the main chat instead of covering it.
  // The close button is honest about consequences: a temporary side chat is
  // destroyed (trash), a bound saved conversation is merely unbound and stays
  // in the platform's history (broken link).
  const TRASH_ICON_SVG = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
  `;
  const UNLINK_ICON_SVG = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
      <path d="M5.17 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      <line x1="4" y1="4" x2="20" y2="20"></line>
    </svg>
  `;

  function updateDiscardButton(panelElement, convKey) {
    const btn = panelElement.querySelector('.thread-panel-close');
    if (!btn) return;
    const bound = !!bindings[convKey];
    btn.title = bound ? 'Unbind side chat (conversation stays in your history)' : 'Discard thread';
    btn.innerHTML = bound ? UNLINK_ICON_SVG : TRASH_ICON_SVG;
  }

  function updateDockState() {
    const data = sessionPanels.get(currentConvKey);
    const hasExpanded = !!data && !data.minimized;
    const html = document.documentElement;
    html.style.setProperty('--tangent-panel-width', `${dockWidth}px`);
    html.classList.toggle('tangent-side-open', hasExpanded);
    // Shrink the main chat via inline style: both platforms pin html/body
    // margins with layered !important rules that beat extension stylesheets,
    // but inline importants still win the cascade.
    if (hasExpanded) {
      html.style.setProperty('margin-right', `${dockWidth}px`, 'important');
    } else {
      html.style.removeProperty('margin-right');
    }
  }

  function createPanelData(convKey, iframeSrc) {
    const panel = document.createElement('div');
    panel.className = 'claude-thread-panel';
    panel.dataset.convKey = convKey;

    panel.innerHTML = `
      <div class="thread-panel-header">
        <div class="thread-panel-title">
          <div class="thread-orbit-active">
            <div class="orbit-dot orbit-dot-1"></div>
            <div class="orbit-dot orbit-dot-2"></div>
          </div>
          <span>Side Chat</span>
        </div>
        <div class="thread-panel-actions">
          <button class="thread-panel-btn thread-panel-minimize" title="Minimize thread">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button class="thread-panel-btn thread-panel-close" title="Discard thread"></button>
        </div>
      </div>
      <div class="thread-panel-body">
        <iframe class="thread-iframe" src="about:blank"></iframe>
        <div class="thread-panel-loading">
          <div class="loading-spinner"></div>
          <span>Loading thread...</span>
        </div>
        <div class="thread-panel-error" style="display: none;">
          <p>Unable to load the side chat in an iframe.</p>
          <p>This may be due to security restrictions.</p>
          <button class="thread-open-tab">Open in new tab instead</button>
        </div>
      </div>
      <div class="thread-panel-resize-handle"></div>
    `;

    panel.querySelector('.thread-panel-close').addEventListener('click', () => discardPanel(convKey));
    updateDiscardButton(panel, convKey);
    panel.querySelector('.thread-panel-minimize').addEventListener('click', () => minimizePanel(convKey));
    panel.querySelector('.thread-open-tab').addEventListener('click', () => {
      const fallbackUrl = PLATFORM === 'claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/';
      window.open(fallbackUrl, '_blank');
      discardPanel(convKey);
    });

    makeResizable(panel, panel.querySelector('.thread-panel-resize-handle'));
    document.body.appendChild(panel);

    const iframe = panel.querySelector('.thread-iframe');
    const loading = panel.querySelector('.thread-panel-loading');
    const error = panel.querySelector('.thread-panel-error');

    loading.style.display = 'flex';
    error.style.display = 'none';
    iframe.style.display = 'none';

    iframe.onload = () => {
      loading.style.display = 'none';
      iframe.style.display = 'block';
    };
    iframe.onerror = () => {
      loading.style.display = 'none';
      error.style.display = 'flex';
    };
    iframe.src = iframeSrc;

    // Fallback: if iframe doesn't load in 5 seconds, show error
    setTimeout(() => {
      if (loading.style.display !== 'none') {
        try {
          if (!iframe.contentDocument && loading.style.display !== 'none') {
            loading.style.display = 'none';
            error.style.display = 'flex';
          }
        } catch (e) {
          loading.style.display = 'none';
          iframe.style.display = 'block';
        }
      }
    }, 5000);

    ensureIframeRendered(iframe, iframeSrc);

    const data = {
      element: panel,
      minimized: false,
      originScrollTop: selectionScrollTop,
      originSelectedText: selectedText,
      originElements: [...selectionOriginElements]
    };
    sessionPanels.set(convKey, data);
    return data;
  }

  // chatgpt.com sometimes fails to hydrate inside an iframe and redirects to
  // a ?mweb_fallback=1 page that renders a completely blank shell. A plain
  // reload of the original URL recovers it, so watch for a loaded-but-blank
  // document and retry a few times.
  function ensureIframeRendered(iframe, src) {
    let retries = 0;
    const started = Date.now();

    const check = setInterval(() => {
      if (!iframe.isConnected || Date.now() - started > 35000) {
        clearInterval(check);
        return;
      }

      let blank = false;
      try {
        const idoc = iframe.contentDocument;
        if (!idoc || idoc.readyState !== 'complete' || !idoc.body) return;
        blank = idoc.body.children.length <= 1 && idoc.body.textContent.trim().length === 0;
        if (!blank) {
          clearInterval(check);
          return;
        }
      } catch (e) {
        clearInterval(check); // can't inspect — leave the iframe alone
        return;
      }

      retries++;
      if (retries > 3) {
        clearInterval(check);
        return;
      }
      console.log('SideChat: side chat rendered blank, retrying load (attempt', retries + ')');
      iframe.src = src;
    }, 5000);
  }

  // Open (or reveal) the side chat for the current conversation.
  // contextText '' means blank — no context injection.
  function openSidePanel(contextText) {
    const convKey = currentConvKey;
    let data = sessionPanels.get(convKey);

    if (data) {
      // Reuse the live panel; append the new context into its input
      if (contextText) {
        data.originSelectedText = contextText;
        data.originScrollTop = selectionScrollTop;
        data.originElements = [...selectionOriginElements];
        injectContext(data.element, contextText);
        copyContextToClipboard(contextText);
      }
      expandPanel(convKey);
      window.getSelection().removeAllRanges();
      return;
    }

    const storedUrl = bindings[convKey];
    if (storedUrl) {
      // Restore the bound (saved) side conversation
      data = createPanelData(convKey, storedUrl);
      if (contextText) {
        injectContext(data.element, contextText);
        copyContextToClipboard(contextText);
      }
      expandPanel(convKey);
      window.getSelection().removeAllRanges();
      return;
    }

    // Fresh temporary side chat. Context travels via sessionStorage + URL
    // hash so the iframe-side script can paste it once the input exists.
    if (contextText) {
      sessionStorage.setItem(CONTEXT_STORAGE_KEY, contextText);
      copyContextToClipboard(contextText);
    }
    const src = PLATFORM === 'claude'
      ? `https://claude.ai/new?incognito=true${contextText ? CONTEXT_HASH : ''}`
      : `https://chatgpt.com/?temporary-chat=true${contextText ? CONTEXT_HASH : ''}`;
    createPanelData(convKey, src);
    expandPanel(convKey);
    window.getSelection().removeAllRanges();
  }

  function expandPanel(convKey) {
    const data = sessionPanels.get(convKey);
    if (!data) return;

    const wasMinimized = data.minimized;
    data.minimized = false;
    data.element.classList.add('visible');

    updateDockState();
    updateEdgeHandle();

    // Restoring a minimized side chat scrolls back to where it branched off
    if (wasMinimized) scrollToOriginAndHighlight(data);
  }

  function minimizePanel(convKey) {
    const data = sessionPanels.get(convKey);
    if (!data) return;

    data.minimized = true;
    data.element.classList.remove('visible');

    updateDockState();
    updateEdgeHandle();
  }

  function discardPanel(convKey) {
    const data = sessionPanels.get(convKey);
    if (data) {
      data.element.querySelector('.thread-iframe').src = 'about:blank';
      data.element.remove();
      sessionPanels.delete(convKey);
    }
    removeBinding(convKey);
    sessionStorage.removeItem(CONTEXT_STORAGE_KEY);

    updateDockState();
    updateEdgeHandle();
  }

  // ============================================
  // CONTEXT INJECTION (parent side, into live iframe)
  // ============================================
  function injectContext(panelElement, text) {
    const iframe = panelElement.querySelector('.thread-iframe');
    const formatted = `---\nContext from my main thread:\n"${text}"\n---\n\n`;
    const deadline = Date.now() + 10000;

    const timer = setInterval(() => {
      let doc = null;
      try { doc = iframe.contentDocument; } catch (e) { /* not ready */ }

      if (doc) {
        const input = doc.querySelector('[data-testid="chat-input"]')
          || doc.querySelector('.ProseMirror[contenteditable="true"]')
          || doc.querySelector('#prompt-textarea');
        if (input) {
          try {
            const target = input.querySelector('p') || input;
            target.appendChild(doc.createTextNode(formatted));
            target.classList.remove('is-empty', 'is-editor-empty');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
          } catch (e) {
            console.error('SideChat: context injection failed', e);
          }
          clearInterval(timer);
          return;
        }
      }

      if (Date.now() > deadline) clearInterval(timer);
    }, 400);
  }

  // ============================================
  // CONVERSATION SWITCHING (SPA navigation)
  // ============================================
  function onConvChanged(newKey) {
    const oldKey = currentConvKey;
    const oldData = sessionPanels.get(oldKey);

    // A fresh chat gains its real id after the first message; carry the
    // side chat over instead of treating it as a different conversation.
    if (oldKey === 'new' && newKey !== 'new' &&
        oldData && !sessionPanels.has(newKey)) {
      sessionPanels.delete('new');
      sessionPanels.set(newKey, oldData);
      oldData.element.dataset.convKey = newKey;
      currentConvKey = newKey;
      updateDockState();
      updateEdgeHandle();
      return;
    }

    if (oldData) oldData.element.classList.remove('visible');

    currentConvKey = newKey;

    const newData = sessionPanels.get(newKey);
    if (newData && !newData.minimized) newData.element.classList.add('visible');

    updateDockState();
    updateEdgeHandle();
  }

  function watchConversation() {
    setInterval(() => {
      const key = getConvKey();
      if (key !== currentConvKey) onConvChanged(key);
    }, 800);
  }

  // ============================================
  // SIDE CONVERSATION URL TRACKING (persistence)
  // ============================================
  // When the user turns off temporary mode inside the side chat, the iframe
  // navigates to a real conversation URL. Remember it so the side chat can
  // be restored for this main conversation after a reload.
  function watchSideConversationUrl() {
    setInterval(() => {
      for (const [convKey, data] of sessionPanels) {
        if (convKey === 'new') continue;
        let href = null;
        try { href = data.element.querySelector('.thread-iframe').contentWindow.location.href; } catch (e) { continue; }
        if (!href) continue;

        let url;
        try { url = new URL(href); } catch (e) { continue; }

        const isConversation = PLATFORM === 'claude'
          ? /\/chat\/[\w-]+/.test(url.pathname)
          : /\/c\/[\w-]+/.test(url.pathname);
        const isTemporary = PLATFORM === 'claude'
          ? url.searchParams.get('incognito') === 'true'
          : url.searchParams.get('temporary-chat') === 'true';

        if (isConversation && !isTemporary) {
          const cleanUrl = url.origin + url.pathname;
          if (bindings[convKey] !== cleanUrl) {
            saveBinding(convKey, cleanUrl);
            updateEdgeHandle();
            updateDiscardButton(data.element, convKey);
          }
        }
      }
    }, 2000);
  }

  // ============================================
  // SCROLL-BACK HIGHLIGHT
  // ============================================
  function scrollToOriginAndHighlight(data) {
    const elements = data.originElements;

    if (elements.length > 0 && elements[0].isConnected) {
      flashHighlight(elements);
      return;
    }

    const fallbackElements = findElementsByText(data.originSelectedText);
    if (fallbackElements.length > 0) {
      flashHighlight(fallbackElements);
      return;
    }

    const scrollContainer = getScrollContainer();
    if (scrollContainer) {
      const offset = scrollContainer.clientHeight / 3;
      const targetScroll = Math.max(0, data.originScrollTop - offset);
      scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
    }
  }

  function flashHighlight(elements) {
    elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

    elements.forEach(el => el.classList.add('thread-highlight-flash'));

    setTimeout(() => {
      elements.forEach(el => el.classList.add('fade-out'));
    }, 800);

    setTimeout(() => {
      elements.forEach(el => {
        el.classList.remove('thread-highlight-flash', 'fade-out');
      });
    }, 2000);
  }

  function findElementsByText(text) {
    if (!text) return [];

    const highlights = [];
    const lines = text.split(/\n+/).filter(line => line.trim().length > 5);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    for (const line of lines) {
      const searchStr = line.trim().substring(0, 50);

      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('.claude-thread-panel')) {
          continue;
        }
        if (node.textContent.indexOf(searchStr) !== -1) {
          const block = findNearestBlock(node.parentElement);
          if (block && !block.classList.contains('thread-highlight-flash')) {
            highlights.push(block);
          }
          break;
        }
      }
    }

    return highlights;
  }

  // ============================================
  // CLIPBOARD
  // ============================================
  function copyContextToClipboard(text) {
    const template = `---
Context from my main thread:
"${text}"
---

`;

    navigator.clipboard.writeText(template).catch(() => {
      // Silently ignore — clipboard API fails when document lacks focus
    });
  }

  // ============================================
  // RESIZE (docked panel width via left-edge handle)
  // ============================================
  function makeResizable(element, handle) {
    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = element.offsetWidth;

      element.classList.add('resizing');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const maxWidth = Math.max(CONFIG.panelMinWidth, window.innerWidth - 360);
      dockWidth = Math.min(maxWidth, Math.max(CONFIG.panelMinWidth, startWidth + (startX - e.clientX)));
      updateDockState();
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        element.classList.remove('resizing');
      }
    });
  }

  // ============================================
  // SCROLL CONTAINER
  // ============================================
  function getScrollContainer() {
    const scrollEl = document.querySelector('[class*="scroll"]');
    if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight) {
      return scrollEl;
    }
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      let node = selection.getRangeAt(0).commonAncestorContainer;
      while (node && node !== document.body) {
        if (node.nodeType === 1) {
          const style = window.getComputedStyle(node);
          const overflowY = style.overflowY;
          if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
            return node;
          }
        }
        node = node.parentNode;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  // ============================================
  // KEYBOARD SHORTCUT
  // ============================================
  function handleKeydown(e) {
    // Cmd/Ctrl + Shift + T to open side chat from selection
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length >= CONFIG.minSelectionLength) {
        e.preventDefault();
        selectedText = text;
        selectionOriginElements = getBlockElementsFromSelection(selection);
        const scrollContainer = getScrollContainer();
        selectionScrollTop = scrollContainer ? scrollContainer.scrollTop : window.scrollY;
        openSidePanel(text);
      }
    }

    // Cmd+\ to open a blank side chat
    if (e.key === '\\' && e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      openSidePanel('');
    }

    // Escape to minimize the expanded panel
    if (e.key === 'Escape') {
      const data = sessionPanels.get(currentConvKey);
      if (data && !data.minimized) {
        minimizePanel(currentConvKey);
      }
    }
  }

  // ============================================
  // AUTO-PASTE CONTEXT (runs inside the side chat iframe)
  // ============================================
  function autoPasteContext() {
    if (window.location.hash !== CONTEXT_HASH) {
      return;
    }

    const contextText = sessionStorage.getItem(CONTEXT_STORAGE_KEY);
    if (!contextText) {
      console.log('SideChat: no context found in sessionStorage');
      return;
    }

    // Clear the stored context to prevent reuse
    sessionStorage.removeItem(CONTEXT_STORAGE_KEY);

    const formattedContext = `---\nContext from my main thread:\n"${contextText}"\n---\n\n`;

    let hasInserted = false;
    let observer = null;
    const timeoutMs = 10000;

    function findAndFillInput() {
      if (hasInserted) return true;

      let inputElement = document.querySelector('[data-testid="chat-input"]');

      if (!inputElement) {
        inputElement = document.querySelector('.tiptap.ProseMirror[contenteditable="true"]');
      }
      if (!inputElement) {
        inputElement = document.querySelector('.ProseMirror[contenteditable="true"]');
      }
      if (!inputElement) {
        inputElement = document.querySelector('[contenteditable="true"][aria-label*="prompt"]');
      }
      if (!inputElement) {
        inputElement = document.querySelector('#prompt-textarea');
      }

      if (inputElement) {
        try {
          inputElement.focus();

          // Clear existing content - for TipTap/ProseMirror, clear the inner paragraph
          const existingParagraph = inputElement.querySelector('p');
          if (existingParagraph) {
            existingParagraph.innerHTML = '';
          } else {
            inputElement.innerHTML = '<p></p>';
          }

          const targetP = inputElement.querySelector('p') || inputElement;
          targetP.appendChild(document.createTextNode(formattedContext));
          targetP.classList.remove('is-empty', 'is-editor-empty');

          inputElement.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: formattedContext
          }));
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));

          // Move cursor to end
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(targetP);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);

          hasInserted = true;
          if (observer) {
            observer.disconnect();
            observer = null;
          }

          console.log('SideChat: auto-pasted context');
          return true;

        } catch (err) {
          console.error('SideChat: error inserting text', err);
        }
      }

      return false;
    }

    if (findAndFillInput()) {
      return;
    }

    observer = new MutationObserver(() => {
      findAndFillInput();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      if (!hasInserted && observer) {
        observer.disconnect();
        observer = null;
      }
    }, timeoutMs);
  }

  // ============================================
  // ENTER TO SEND FIX (runs inside the side chat iframe)
  // ============================================
  function fixEnterToSend() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;

      const active = document.activeElement;
      if (!active || !active.closest('[contenteditable="true"], textarea')) return;

      const sendBtn =
        document.querySelector('button[aria-label="Send Message"]') ||      // Claude
        document.querySelector('button[aria-label*="Send"]') ||             // Claude fallback
        document.querySelector('button[data-testid="send-button"]') ||      // Claude/ChatGPT
        document.querySelector('button[aria-label="Send prompt"]') ||       // ChatGPT
        document.querySelector('fieldset button[type="button"]:last-of-type');

      if (sendBtn && !sendBtn.disabled) {
        e.preventDefault();
        e.stopPropagation();
        sendBtn.click();
      }
    }, { capture: true });
  }

  // ============================================
  // SELECTION BUTTON WIRING
  // ============================================
  function setupSelectionButton() {
    document.addEventListener('selectionchange', () => {
      clearTimeout(selectionDebounce);
      selectionDebounce = setTimeout(updateSideChatButton, 150);
    });

    // Keep the button anchored to the selection while the page scrolls
    document.addEventListener('scroll', () => {
      if (sideChatButton && sideChatButton.classList.contains('visible')) {
        updateSideChatButton();
      }
    }, { capture: true, passive: true });
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  function init() {
    // If we're inside an iframe (the side chat), handle iframe-specific features
    if (window.self !== window.top) {
      console.log('SideChat: running inside iframe');
      autoPasteContext();
      fixEnterToSend();
      return;
    }

    currentConvKey = getConvKey();
    loadBindings();

    setupSelectionButton();
    createEdgeHandle();
    updateEdgeHandle();
    watchConversation();
    watchSideConversationUrl();

    document.addEventListener('keydown', handleKeydown);

    console.log('SideChat initialized on', PLATFORM);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
