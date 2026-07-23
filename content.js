/**
 * SideChat – Side Conversations for ChatGPT & Claude
 * One docked side conversation per main conversation.
 * (Internal DOM ids / storage keys keep the legacy "tangent" prefix so
 *  existing bindings survive the rename.)
 */

(function() {
  'use strict';

  // Guard against running twice in the same frame: the background worker may
  // re-inject content.js into a tab that already ran it declaratively (e.g. on
  // startup, where restored tabs otherwise miss the declarative injection).
  if (window.__sideChatContentLoaded) return;
  window.__sideChatContentLoaded = true;

  // ============================================
  // CONFIGURATION
  // ============================================
  const CONFIG = {
    minSelectionLength: 1,   // any non-empty (trimmed) selection shows the Side Chat button
    panelWidth: 480,         // initial docked panel width in pixels
    panelMinWidth: 320
  };

  const PLATFORM = window.location.hostname.includes('claude.ai') ? 'claude' : 'chatgpt';

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

  // Default mode for a freshly-opened side chat: 'temporary' (incognito/
  // temporary chat, nothing saved) or 'normal' (a real saved conversation).
  // Toggled by the switch in the panel header, remembered in localStorage.
  const MODE_KEY = 'tangent-side-chat-default-mode';
  let defaultMode = 'temporary';

  function loadDefaultMode() {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === 'temporary' || m === 'normal') defaultMode = m;
    } catch (e) { /* ignore */ }
  }

  function setDefaultMode(mode) {
    defaultMode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* ignore */ }
    for (const [, data] of sessionPanels) syncModeToggle(data.element);
  }

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

  // If the main conversation lives inside a project, return the URL where a
  // new chat in that project starts (so a saved side chat lands in the same
  // project instead of the global history). Null when not in a project.
  function getProjectNewChatUrl() {
    if (PLATFORM === 'chatgpt') {
      // Projects are in the URL: /g/g-p-<hexid>[-slug]/... ; the hex id stops
      // at the slug's dash. /g/g-p-<hexid>/project is the new-chat page.
      const m = location.pathname.match(/\/g\/(g-p-[0-9a-f]+)/);
      return m ? `https://chatgpt.com/g/${m[1]}/project` : null;
    }
    // Claude: the conversation URL is a bare /chat/<id>; project membership
    // only surfaces as a project link (breadcrumb) in the page DOM.
    const a = document.querySelector('a[href*="/project/"]');
    const m = a && a.getAttribute('href').match(/\/project\/([0-9a-f-]{36})/);
    return m ? `https://claude.ai/project/${m[1]}` : null;
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
    // Docked-layout glyph: two white panes (dim main + bright side) filling
    // the box so it reads clearly on the violet button. No background — the
    // button itself is the violet. Matches the extension icon.
    btn.innerHTML = `
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <rect x="1.5" y="2.5" width="11" height="19" rx="2.5" fill="currentColor" opacity="0.55"/>
        <rect x="14.5" y="2.5" width="8" height="19" rx="2.5" fill="currentColor"/>
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

  // Vertical position of the edge handle, stored as a 0..1 ratio of the
  // viewport height so it survives window resizes. Default 0.5 (centred).
  // Draggable so users can move it clear of ChatGPT's centred message-
  // navigation rail, which otherwise sits over the handle.
  const HANDLE_POS_KEY = 'tangent-edge-handle-pos';

  function loadHandlePosRatio() {
    try {
      const v = parseFloat(localStorage.getItem(HANDLE_POS_KEY));
      if (v >= 0 && v <= 1) return v;
    } catch (e) { /* ignore */ }
    return 0.5;
  }

  // Place the handle so its centre sits at `ratio` of the viewport height,
  // clamped to stay fully on-screen. Overrides the CSS top:50%/translateY.
  function applyHandlePos(ratio) {
    if (!edgeHandle) return;
    const h = edgeHandle.offsetHeight || 56;
    const top = Math.max(0, Math.min(window.innerHeight - h, ratio * window.innerHeight - h / 2));
    edgeHandle.style.top = `${top}px`;
    edgeHandle.style.transform = 'none';
  }

  function createEdgeHandle() {
    const handle = document.createElement('button');
    handle.id = 'tangent-edge-handle';
    handle.title = 'Open Side Chat  ·  drag to move';
    // Door-handle arc hugging the edge (user-sketched motif)
    handle.innerHTML = `
      <svg width="16" height="34" viewBox="0 0 24 48" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round">
        <path d="M17,6 C5,15 5,33 17,42"/>
      </svg>
    `;

    // Drag to reposition vertically; a plain click still opens the side chat.
    // We only treat it as a drag once the pointer moves past a small
    // threshold, so ordinary clicks are never swallowed.
    let drag = null;
    let suppressClick = false;
    const DRAG_THRESHOLD = 4;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      drag = { startY: e.clientY, startTop: handle.getBoundingClientRect().top, moved: false };
    });

    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      handle.classList.add('dragging');
      const h = handle.offsetHeight || 56;
      const top = Math.max(0, Math.min(window.innerHeight - h, drag.startTop + dy));
      handle.style.top = `${top}px`;
      handle.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      if (!drag) return;
      if (drag.moved) {
        handle.classList.remove('dragging');
        suppressClick = true; // the trailing click event is from the drag
        const h = handle.offsetHeight || 56;
        const ratio = (parseFloat(handle.style.top) + h / 2) / window.innerHeight;
        try { localStorage.setItem(HANDLE_POS_KEY, String(ratio)); } catch (e) { /* ignore */ }
      }
      drag = null;
    });

    handle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (suppressClick) { suppressClick = false; return; }
      openSidePanel('');
    });

    document.body.appendChild(handle);
    edgeHandle = handle;
    applyHandlePos(loadHandlePosRatio());

    // Keep the same relative position when the window is resized.
    window.addEventListener('resize', () => applyHandlePos(loadHandlePosRatio()));
  }

  function updateEdgeHandle() {
    if (!edgeHandle) return;
    const data = sessionPanels.get(currentConvKey);
    const hasThread = !!data || !!bindings[currentConvKey];
    edgeHandle.classList.toggle('has-thread', hasThread);
    edgeHandle.classList.toggle('has-unread', !!(data && data.unread));
    edgeHandle.title = hasThread ? 'Reopen Side Chat' : 'Open Side Chat';
  }

  // ============================================
  // UNREAD DETECTION (red dot on the edge handle)
  // ============================================
  // While a side chat is minimized the user can't post in it, so any new
  // message turn that appears is an incoming reply — mark it unread. Viewing
  // the panel (expand) clears it. Works for both temporary and saved chats.
  // Snapshot of the side chat's content: turn count + total message text
  // length. A reply that was already streaming when the user minimized adds
  // no new turn — only its text grows — so both must be tracked.
  function panelChatSignature(data) {
    const iframe = data.element.querySelector('.thread-iframe');
    let doc;
    try { doc = iframe.contentDocument; } catch (e) { return null; } // cross-origin mid-load
    if (!doc) return null;
    // ChatGPT tags each message with an author role; Claude tags each
    // rendered turn with data-test-render-count.
    let nodes = doc.querySelectorAll('[data-message-author-role]');
    if (!nodes.length) nodes = doc.querySelectorAll('[data-test-render-count]');
    if (!nodes.length) return null; // not loaded / selectors gone
    let textLen = 0;
    for (const n of nodes) textLen += n.textContent.length;
    return { count: nodes.length, textLen };
  }

  function pollUnread() {
    let changed = false;
    for (const [, data] of sessionPanels) {
      if (!data.minimized || data.unread) continue;
      const sig = panelChatSignature(data);
      if (!sig) continue;
      if (!data.seenSig) { data.seenSig = sig; continue; } // baseline
      // Small text threshold so cosmetic re-renders can't false-flag.
      if (sig.count > data.seenSig.count || sig.textLen > data.seenSig.textLen + 5) {
        data.unread = true;
        changed = true;
      }
    }
    if (changed) updateEdgeHandle();
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

  // Reflect the saved default mode on a panel's header toggle. The toggle
  // sets the default for the NEXT new side chat; it does not convert the
  // current conversation (use the platform's own toggle inside the iframe
  // for that).
  function syncModeToggle(panelElement) {
    const toggle = panelElement.querySelector('.thread-mode-toggle');
    if (!toggle) return;
    const normal = defaultMode === 'normal';
    toggle.classList.toggle('mode-normal', normal);
    toggle.setAttribute('aria-checked', normal ? 'true' : 'false');
    toggle.title = normal
      ? 'New side chats open as saved conversations — click for temporary'
      : 'New side chats open as temporary — click for saved conversations';
  }

  // Icon follows the chat's mode, not just its binding: a normal-mode side
  // chat shows the unlink icon (closing it detaches; anything you send is
  // kept in your history) even before its first message. Only a temporary
  // (incognito) chat shows trash — that one really is destroyed on close.
  function updateDiscardButton(panelElement, convKey) {
    const btn = panelElement.querySelector('.thread-panel-close');
    if (!btn) return;
    const kept = !!bindings[convKey] || panelElement.dataset.temporary === 'false';
    btn.title = kept
      ? 'Detach side chat (kept as a normal conversation)'
      : 'Discard thread (temporary — not saved)';
    btn.innerHTML = kept ? UNLINK_ICON_SVG : TRASH_ICON_SVG;
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
    // Records whether this side chat opened in temporary (incognito) mode,
    // so the close button can show trash vs unlink from the start.
    panel.dataset.temporary = String(/incognito=true|temporary-chat=true/.test(iframeSrc));

    panel.innerHTML = `
      <div class="thread-panel-header">
        <div class="thread-panel-title">
          <svg class="sidechat-logo" width="18" height="18" viewBox="0 0 512 512">
            <rect x="0" y="0" width="512" height="512" rx="102" fill="#7c3aed"/>
            <rect x="84" y="110" width="196" height="292" rx="34" fill="#ffffff" opacity="0.55"/>
            <rect x="304" y="110" width="124" height="292" rx="34" fill="#ffffff"/>
          </svg>
          <span>Side Chat</span>
        </div>
        <div class="thread-panel-actions">
          <button class="thread-mode-toggle" title="Default mode for new side chats" role="switch">
            <span class="mode-label mode-label-temp">Temp</span>
            <span class="mode-track"><span class="mode-knob"></span></span>
            <span class="mode-label mode-label-norm">Saved</span>
          </button>
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

    panel.querySelector('.thread-mode-toggle').addEventListener('click', () => {
      setDefaultMode(defaultMode === 'temporary' ? 'normal' : 'temporary');
    });
    syncModeToggle(panel);
    panel.querySelector('.thread-panel-minimize').addEventListener('click', () => minimizePanel(convKey));
    panel.querySelector('.thread-open-tab').addEventListener('click', () => {
      const fallbackUrl = PLATFORM === 'claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/';
      window.open(fallbackUrl, '_blank');
      discardPanel(convKey);
    });

    makeResizable(panel, panel.querySelector('.thread-panel-resize-handle'));
    document.body.appendChild(panel);
    maybeInjectWhatsNew(panel);

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
      unread: false,
      seenSig: null,
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

    // Fresh side chat. The mode (temporary vs normal) follows the user's
    // saved default. Context is injected from here (parent-driven) once the
    // iframe input appears — execCommand needs the calling document focused,
    // which the top page is but a freshly-loaded iframe is not.
    let src;
    if (defaultMode === 'normal') {
      // Saved chats follow the project the main conversation lives in.
      src = getProjectNewChatUrl()
        || (PLATFORM === 'claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/');
    } else {
      src = PLATFORM === 'claude'
        ? 'https://claude.ai/new?incognito=true'
        : 'https://chatgpt.com/?temporary-chat=true';
    }
    data = createPanelData(convKey, src);
    if (contextText) {
      injectContext(data.element, contextText);
      copyContextToClipboard(contextText);
    }
    expandPanel(convKey);
    window.getSelection().removeAllRanges();
  }

  function expandPanel(convKey) {
    const data = sessionPanels.get(convKey);
    if (!data) return;

    const wasMinimized = data.minimized;
    data.minimized = false;
    data.unread = false; // viewing the panel marks it read
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
    // Baseline the content now; anything that grows after this marks unread.
    data.seenSig = panelChatSignature(data);
    data.unread = false;
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

    updateDockState();
    updateEdgeHandle();
  }

  // ============================================
  // CONTEXT INJECTION (parent side, into live iframe)
  // ============================================
  // Shared editor insertion. execCommand('insertText') is honored by both
  // TipTap (Claude) and ProseMirror (ChatGPT): newlines become paragraphs,
  // so the trailing "\n\n" leaves a blank line with the caret waiting below.
  function insertIntoEditor(doc, win, input, text) {
    input.focus();
    const sel = win.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(input);
    range.collapse(false); // caret to end — append after any existing text
    sel.removeAllRanges();
    sel.addRange(range);
    doc.execCommand('insertText', false, text);
  }

  function buildContextText(text) {
    // One-line context, then a single line break so the caret sits on the
    // next line ready for the question (no extra blank line).
    return `--- Context from my main chat: "${text}" ---\n`;
  }

  function injectContext(panelElement, text) {
    const iframe = panelElement.querySelector('.thread-iframe');
    const formatted = buildContextText(text);
    const marker = text.slice(0, 12);
    const deadline = Date.now() + 12000;

    const timer = setInterval(() => {
      let doc = null, win = null;
      try { doc = iframe.contentDocument; win = iframe.contentWindow; } catch (e) { return; }
      if (!doc) return;

      const input = doc.querySelector('[data-testid="chat-input"]')
        || doc.querySelector('.ProseMirror[contenteditable="true"]')
        || doc.querySelector('#prompt-textarea');

      if (input) {
        // Already contains our context (or the user has typed) — done.
        if (input.textContent.includes(marker)) {
          clearInterval(timer);
          return;
        }
        try {
          insertIntoEditor(doc, win, input, formatted);
        } catch (e) {
          console.error('SideChat: context injection failed', e);
        }
        // Verify it landed; execCommand can silently no-op if the iframe
        // isn't focused yet. If it didn't take, the next tick retries.
        if (input.textContent.includes(marker)) {
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
    navigator.clipboard.writeText(buildContextText(text)).catch(() => {
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
  // WHAT'S NEW (post-update banner in the panel)
  // ============================================
  // After an update, show a small one-time banner inside the side panel with
  // a short note and a feedback link. Localised by the browser's UI language.
  //
  const FEEDBACK_FORM_URL = 'https://forms.gle/gjivseJR8cakK9Fx5';

  // The "NEW" tag at the start of the banner. Shown as-is in every language.
  const NEW_BADGE = 'NEW';

  // Per-version release notes (just the description — the NEW pill is added
  // automatically). Add an entry each release; omit a version to skip its
  // banner. Always provide 'en' as the fallback. Keys are matched against the
  // browser UI language (exact, then base language, then 'en').
  const WHATS_NEW = {
    '2.8.0': {
      'en': 'Saved side chats now stay inside the ChatGPT / Claude project you are working in.',
      'zh-TW': '儲存的側聊現在會存進你所在的 ChatGPT / Claude 專案裡,不再散落在一般紀錄。',
      'zh': '保存的侧聊现在会存进你所在的 ChatGPT / Claude 项目里,不再散落在一般记录。'
    },
    '2.7.0': {
      'en': 'The side handle now shows a red dot when your side chat has a new reply.',
      'zh-TW': '側邊把手現在會在側聊有新回覆時亮紅點。',
      'zh': '侧边把手现在会在侧聊有新回复时亮红点。'
    },
    '2.6.0': {
      'en': 'Drag the launcher handle up or down to move it wherever suits you.',
      'zh-TW': '啟動把手可以上下拖曳,移到你順手的位置。',
      'zh': '启动把手可以上下拖动,移到你顺手的位置。'
    }
  };

  const FEEDBACK_LABEL = {
    'en': 'Got feedback? Tell me',
    'zh-TW': '有任何建議?告訴我',
    'zh': '有任何建议?告诉我'
  };

  const WHATS_NEW_SEEN_KEY = 'tangent-whatsnew-seen';
  let whatsNewPending = false;

  function currentVersion() {
    try { return chrome.runtime.getManifest().version; } catch (e) { return ''; }
  }

  // Pick the entry matching the browser UI language: exact (zh-TW), then base
  // language (zh), then English, then whatever exists.
  function pickLocale(map) {
    let lang = 'en';
    try { lang = chrome.i18n.getUILanguage() || navigator.language || 'en'; }
    catch (e) { lang = navigator.language || 'en'; }
    if (map[lang]) return map[lang];
    const base = lang.split('-')[0];
    const hit = Object.keys(map).find(k => k.split('-')[0] === base);
    return map[hit] || map['en'] || Object.values(map)[0];
  }

  // Decide at startup whether an update banner is due. A brand-new install
  // (no stored version) is seeded silently so first-time users see nothing.
  function initWhatsNew() {
    const current = currentVersion();
    let seen = null;
    try { seen = localStorage.getItem(WHATS_NEW_SEEN_KEY); } catch (e) { /* ignore */ }

    if (seen === null) {
      try { localStorage.setItem(WHATS_NEW_SEEN_KEY, current); } catch (e) { /* ignore */ }
      return;
    }
    if (seen === current) return;

    if (WHATS_NEW[current]) {
      whatsNewPending = true; // shown when the panel next opens
    } else {
      // Updated, but nothing to announce for this version — catch up silently.
      try { localStorage.setItem(WHATS_NEW_SEEN_KEY, current); } catch (e) { /* ignore */ }
    }
  }

  function markWhatsNewSeen() {
    whatsNewPending = false;
    try { localStorage.setItem(WHATS_NEW_SEEN_KEY, currentVersion()); } catch (e) { /* ignore */ }
  }

  function maybeInjectWhatsNew(panel) {
    if (!whatsNewPending) return;
    const notes = WHATS_NEW[currentVersion()];
    if (!notes) return;

    const bar = document.createElement('div');
    bar.className = 'thread-whatsnew';
    bar.innerHTML = `
      <button class="thread-whatsnew-close" title="Dismiss">✕</button>
      <span class="thread-whatsnew-badge"></span>
      <div class="thread-whatsnew-body">
        <span class="thread-whatsnew-text"></span><a class="thread-whatsnew-link" target="_blank" rel="noopener noreferrer"></a>
      </div>
    `;
    // textContent (not innerHTML) so note text can never inject markup.
    bar.querySelector('.thread-whatsnew-badge').textContent = NEW_BADGE;
    bar.querySelector('.thread-whatsnew-text').textContent = pickLocale(notes);
    const link = bar.querySelector('.thread-whatsnew-link');
    link.textContent = pickLocale(FEEDBACK_LABEL);
    link.href = FEEDBACK_FORM_URL;

    bar.querySelector('.thread-whatsnew-close').addEventListener('click', () => {
      markWhatsNewSeen();
      bar.remove();
    });
    link.addEventListener('click', markWhatsNewSeen);

    panel.querySelector('.thread-panel-header').insertAdjacentElement('afterend', bar);
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  // On extension reload/update the background worker re-injects this script
  // into open tabs. The previous generation's isolated world is destroyed
  // (its listeners and timers die with it) but the DOM it created survives —
  // remove that dead UI before building fresh, or handles accumulate.
  function removeStaleUI() {
    document.querySelectorAll(
      '#tangent-edge-handle, #tangent-side-chat-button, .claude-thread-panel'
    ).forEach(el => el.remove());
    document.documentElement.classList.remove('tangent-side-open');
    document.documentElement.style.removeProperty('margin-right');
  }

  function init() {
    // If we're inside an iframe (the side chat), handle iframe-specific features
    if (window.self !== window.top) {
      console.log('SideChat: running inside iframe');
      fixEnterToSend();
      return;
    }

    removeStaleUI();
    currentConvKey = getConvKey();
    loadBindings();
    loadDefaultMode();
    initWhatsNew();

    setupSelectionButton();
    createEdgeHandle();
    updateEdgeHandle();
    watchConversation();
    watchSideConversationUrl();
    setInterval(pollUnread, 1500);

    document.addEventListener('keydown', handleKeydown);

    console.log('SideChat initialized on', PLATFORM);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
