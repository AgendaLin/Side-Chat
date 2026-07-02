/**
 * Tangent – Threaded Chat for ChatGPT & Claude
 * Branch off into side threads without leaving your main conversation
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

  // ============================================
  // STATE
  // ============================================
  let selectedText = '';

  // Scroll origin state (captured at selection time)
  let selectionScrollTop = 0;
  let selectionOriginElements = []; // DOM references to block elements in selection

  // Multi-panel state
  let panelCounter = 0;
  const panels = new Map(); // panelId -> { element, minimized, contextSnippet }
  let minimizedTabBar = null;
  let dockWidth = CONFIG.panelWidth; // current docked panel width, shared by all panels

  // ============================================
  // SELECTION ORIGIN CAPTURE
  // ============================================
  const BLOCK_SELECTORS = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6';

  function findNearestBlock(el) {
    if (!el) return null;
    // Try standard block selectors first
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

    // Single block selection
    if (!endBlock || startBlock === endBlock) {
      return [startBlock];
    }

    // Multi-block: collect all blocks between start and end
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
    return !!el?.closest('.claude-thread-panel, .thread-tabbar, #tangent-side-chat-button');
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

    showFloatingPanel(text);
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
  // Always-available launcher on the right edge: opens a blank side chat.
  // Hidden via CSS while a panel is expanded (html.tangent-side-open).
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
      showFloatingPanel('');
    });
    document.body.appendChild(handle);
  }

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
  // MINIMIZED TAB BAR
  // ============================================
  function createMinimizedTabBar() {
    const tabBar = document.createElement('div');
    tabBar.id = 'claude-thread-tabbar';
    tabBar.className = 'thread-tabbar';
    document.body.appendChild(tabBar);
    return tabBar;
  }

  function getOrCreateTabBar() {
    if (!minimizedTabBar) {
      minimizedTabBar = createMinimizedTabBar();
    }
    return minimizedTabBar;
  }

  function createMinimizedTab(panelId, contextSnippet) {
    const tab = document.createElement('div');
    tab.className = 'thread-tab';
    tab.dataset.panelId = panelId;

    // Truncate context for display
    const displayText = contextSnippet.length > 30
      ? contextSnippet.substring(0, 30) + '...'
      : contextSnippet;

    tab.innerHTML = `
      <div class="thread-tab-content">
        <svg class="thread-branch-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="7" cy="4" r="2.5" fill="#d97706" stroke="none"/>
          <line x1="7" y1="6.5" x2="7" y2="17.5"/>
          <circle cx="7" cy="20" r="2.5" fill="#d97706" stroke="none"/>
          <path d="M7,12 C7,12 7,15 11,15 L17,15 L17,17.5"/>
          <circle cx="17" cy="20" r="2.5" fill="#d97706" stroke="none"/>
        </svg>
        <span class="thread-tab-text" title="${contextSnippet}">${displayText}</span>
      </div>
      <button class="thread-tab-close" title="Discard thread">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    `;

    // Click tab to expand
    tab.querySelector('.thread-tab-content').addEventListener('click', () => {
      expandPanel(panelId);
    });

    // Close button
    tab.querySelector('.thread-tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closePanel(panelId);
    });

    return tab;
  }

  function updateTabBar() {
    const tabBar = getOrCreateTabBar();
    tabBar.innerHTML = '';

    for (const [panelId, panelData] of panels) {
      if (panelData.minimized) {
        const tab = createMinimizedTab(panelId, panelData.contextSnippet);
        tabBar.appendChild(tab);
      }
    }

    // Show/hide tabbar based on whether there are minimized tabs
    const hasMinimizedTabs = Array.from(panels.values()).some(p => p.minimized);
    tabBar.classList.toggle('visible', hasMinimizedTabs);
  }

  // ============================================
  // DOCKED SIDE PANEL WITH IFRAME
  // ============================================
  // The panel docks to the right edge of the viewport. While a panel is
  // expanded, <html> gets the `tangent-side-open` class which shrinks the
  // main chat (body margin-right) instead of covering it.
  function updateDockState() {
    const hasExpanded = Array.from(panels.values()).some(p => !p.minimized);
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

  function createFloatingPanel(panelId, contextSnippet, fullContextText) {
    const panel = document.createElement('div');
    panel.className = 'claude-thread-panel';
    panel.dataset.panelId = panelId;

    panel.innerHTML = `
      <div class="thread-panel-header">
        <div class="thread-panel-title">
          <div class="thread-orbit-active">
            <div class="orbit-dot orbit-dot-1"></div>
            <div class="orbit-dot orbit-dot-2"></div>
          </div>
          <span>Thread ${panelId}</span>
        </div>
        <div class="thread-panel-actions">
          <button class="thread-panel-btn thread-copy-hint" title="Context copied to clipboard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
            <span class="copy-hint-text">Paste context</span>
          </button>
          <button class="thread-panel-btn thread-panel-minimize" title="Minimize thread">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button class="thread-panel-btn thread-panel-close" title="Discard thread">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="thread-panel-body">
        <iframe class="thread-iframe" src="about:blank"></iframe>
        <div class="thread-panel-loading">
          <div class="loading-spinner"></div>
          <span>Loading thread...</span>
        </div>
        <div class="thread-panel-error" style="display: none;">
          <p>Unable to load Claude in iframe.</p>
          <p>This may be due to security restrictions.</p>
          <button class="thread-open-tab">Open in new tab instead</button>
        </div>
      </div>
      <div class="thread-panel-resize-handle"></div>
    `;

    // Event listeners
    panel.querySelector('.thread-panel-close').addEventListener('click', () => closePanel(panelId));
    panel.querySelector('.thread-panel-minimize').addEventListener('click', () => minimizePanel(panelId));
    panel.querySelector('.thread-open-tab').addEventListener('click', () => {
      const fallbackUrl = PLATFORM === 'claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/';
      window.open(fallbackUrl, '_blank');
      closePanel(panelId);
    });

    // Copy button - re-copy context to clipboard
    panel.querySelector('.thread-copy-hint').addEventListener('click', () => {
      copyContextToClipboard(fullContextText, panel);
    });

    // Make panel width resizable by dragging its left edge
    makeResizable(panel, panel.querySelector('.thread-panel-resize-handle'));

    document.body.appendChild(panel);
    return panel;
  }

  function showFloatingPanel(contextText) {
    // Only one panel is expanded in the dock at a time; minimize the rest
    for (const [panelId, panelData] of panels) {
      if (!panelData.minimized) minimizePanel(panelId);
    }

    // Create new panel
    panelCounter++;
    const panelId = panelCounter;
    const isBlank = !contextText;
    const contextSnippet = isBlank ? 'Blank thread' : contextText.substring(0, 100);

    const panel = createFloatingPanel(panelId, contextSnippet, contextText);

    // Store panel data (including scroll origin for sticky threads)
    panels.set(panelId, {
      element: panel,
      minimized: false,
      contextSnippet: contextSnippet,
      fullContext: contextText,
      originScrollTop: isBlank ? 0 : selectionScrollTop,
      originSelectedText: contextText,
      originElements: isBlank ? [] : [...selectionOriginElements]
    });

    const iframe = panel.querySelector('.thread-iframe');
    const loading = panel.querySelector('.thread-panel-loading');
    const error = panel.querySelector('.thread-panel-error');

    // Reset state
    loading.style.display = 'flex';
    error.style.display = 'none';
    iframe.style.display = 'none';

    // Dock the panel on the right and shrink the main chat
    panel.classList.add('visible');
    updateDockState();

    // Clear selection (also dismisses Claude's tooltip)
    window.getSelection().removeAllRanges();

    // Copy context to clipboard (skip for blank threads)
    if (!isBlank) {
      copyContextToClipboard(contextText, panel);
    }

    // Load Claude in iframe
    iframe.onload = () => {
      loading.style.display = 'none';
      iframe.style.display = 'block';
    };

    iframe.onerror = () => {
      loading.style.display = 'none';
      error.style.display = 'flex';
    };

    // Store context in sessionStorage for the iframe to read (skip for blank threads)
    if (!isBlank) {
      const contextKey = `claude-thread-opener-context-${panelId}`;
      sessionStorage.setItem(contextKey, contextText);
    }

    // Set iframe src with incognito/temp-chat param and panel ID in hash
    const iframeSrc = PLATFORM === 'claude'
      ? `https://claude.ai/new?incognito=true#thread-opener-${panelId}`
      : `https://chatgpt.com/?temporary-chat=true#thread-opener-${panelId}`;
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

    return panelId;
  }

  function minimizePanel(panelId) {
    const panelData = panels.get(panelId);
    if (!panelData) return;

    panelData.minimized = true;
    panelData.element.classList.remove('visible');

    updateTabBar();
    updateDockState();
  }

  function expandPanel(panelId) {
    const panelData = panels.get(panelId);
    if (!panelData) return;

    // Only one expanded panel in the dock at a time
    for (const [otherId, otherData] of panels) {
      if (otherId !== panelId && !otherData.minimized) minimizePanel(otherId);
    }

    panelData.minimized = false;
    panelData.element.classList.add('visible');

    updateTabBar();
    updateDockState();

    // Scroll to origin and highlight the selected text
    scrollToOriginAndHighlight(panelData);
  }

  function scrollToOriginAndHighlight(panelData) {
    const elements = panelData.originElements;

    // Primary path: use stored DOM references
    if (elements.length > 0 && elements[0].isConnected) {
      flashHighlight(elements);
      return;
    }

    // Fallback: text-based search (DOM references stale or missing)
    const fallbackElements = findElementsByText(panelData.originSelectedText);
    if (fallbackElements.length > 0) {
      flashHighlight(fallbackElements);
      return;
    }

    // Last resort: scroll to saved position
    const scrollContainer = getScrollContainer();
    if (scrollContainer) {
      const offset = scrollContainer.clientHeight / 3;
      const targetScroll = Math.max(0, panelData.originScrollTop - offset);
      scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
    }
  }

  function flashHighlight(elements) {
    // Scroll first element into view
    elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Apply highlight
    elements.forEach(el => el.classList.add('thread-highlight-flash'));

    // Fade out and clean up
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
        if (node.parentElement?.closest('.claude-thread-panel, .thread-tabbar')) {
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

  function closePanel(panelId) {
    const panelData = panels.get(panelId);
    if (!panelData) return;

    // Clean up iframe
    const iframe = panelData.element.querySelector('.thread-iframe');
    iframe.src = 'about:blank';

    // Clean up sessionStorage (in case context wasn't consumed)
    const contextKey = `claude-thread-opener-context-${panelId}`;
    sessionStorage.removeItem(contextKey);

    // Remove from DOM
    panelData.element.remove();

    // Remove from state
    panels.delete(panelId);

    updateTabBar();
    updateDockState();
  }

  function closeAllPanels() {
    for (const [panelId] of panels) {
      closePanel(panelId);
    }
  }

  // ============================================
  // CLIPBOARD
  // ============================================
  function copyContextToClipboard(text, panel) {
    const template = `---
Context from my main thread:
"${text}"
---

`;

    navigator.clipboard.writeText(template).then(() => {
      // Flash the copy hint
      const hint = panel.querySelector('.thread-copy-hint');
      if (hint) {
        hint.classList.add('flash');
        setTimeout(() => hint.classList.remove('flash'), 1500);
      }
    }).catch(() => {
      // Silently ignore — clipboard API fails when document lacks focus (e.g. extension reload)
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
    // Try Claude's main scrollable element
    const scrollEl = document.querySelector('[class*="scroll"]');
    if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight) {
      return scrollEl;
    }
    // Walk up from the current selection to find nearest scrollable ancestor
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
    // Cmd/Ctrl + Shift + T to open thread
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length >= CONFIG.minSelectionLength) {
        e.preventDefault();
        selectedText = text;
        selectionOriginElements = getBlockElementsFromSelection(selection);
        const scrollContainer = getScrollContainer();
        selectionScrollTop = scrollContainer ? scrollContainer.scrollTop : window.scrollY;
        showFloatingPanel(selectedText);
      }
    }

    // Cmd+\ to open a blank thread
    if (e.key === '\\' && e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      showFloatingPanel('');
    }

    // Escape to minimize the most recently opened visible panel
    if (e.key === 'Escape') {
      // Find visible (non-minimized) panels and minimize the last one
      let lastVisiblePanelId = null;
      for (const [panelId, panelData] of panels) {
        if (!panelData.minimized) {
          lastVisiblePanelId = panelId;
        }
      }
      if (lastVisiblePanelId !== null) {
        minimizePanel(lastVisiblePanelId);
      }
    }
  }

  // ============================================
  // AUTO-PASTE CONTEXT (for iframe)
  // ============================================
  function autoPasteContext() {
    // Check if we're in a thread-opener iframe by looking at the URL hash
    const hash = window.location.hash;
    const match = hash.match(/^#thread-opener-(\d+)$/);

    if (!match) {
      console.log('Tangent: No context hash found, skipping auto-paste');
      return;
    }

    const panelId = match[1];
    const contextKey = `claude-thread-opener-context-${panelId}`;
    const contextText = sessionStorage.getItem(contextKey);

    if (!contextText) {
      console.log('Tangent: No context found in sessionStorage');
      return;
    }

    // Clear the stored context to prevent reuse
    sessionStorage.removeItem(contextKey);

    console.log('Tangent: Found context, will auto-paste');

    // Format the context
    const formattedContext = `---\nContext from my main thread:\n"${contextText}"\n---\n\n`;

    let hasInserted = false;
    let observer = null;
    const timeoutMs = 10000;

    function findAndFillInput() {
      if (hasInserted) return true;

      // Strategy 1: Find by data-testid (most reliable for Claude)
      let inputElement = document.querySelector('[data-testid="chat-input"]');

      // Strategy 2: Find TipTap/ProseMirror editor
      if (!inputElement) {
        inputElement = document.querySelector('.tiptap.ProseMirror[contenteditable="true"]');
      }

      // Strategy 3: Find any ProseMirror editor
      if (!inputElement) {
        inputElement = document.querySelector('.ProseMirror[contenteditable="true"]');
      }

      // Strategy 4: Find contenteditable with aria-label
      if (!inputElement) {
        inputElement = document.querySelector('[contenteditable="true"][aria-label*="prompt"]');
      }

      // Strategy 5: ChatGPT's prompt textarea
      if (!inputElement) {
        inputElement = document.querySelector('#prompt-textarea');
      }

      if (inputElement) {
        console.log('Tangent: Found input element', inputElement.className);

        try {
          // Focus the editor first
          inputElement.focus();

          // Clear existing content - for TipTap/ProseMirror, we need to clear the inner paragraph
          const existingParagraph = inputElement.querySelector('p');
          if (existingParagraph) {
            existingParagraph.innerHTML = '';
          } else {
            inputElement.innerHTML = '<p></p>';
          }

          // Get the paragraph to insert into
          const targetP = inputElement.querySelector('p') || inputElement;

          // Create a text node with our content
          const textNode = document.createTextNode(formattedContext);
          targetP.appendChild(textNode);

          // Remove empty classes if present
          targetP.classList.remove('is-empty', 'is-editor-empty');

          // Dispatch input event to notify TipTap/React of the change
          inputElement.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: formattedContext
          }));

          // Also try a generic input event
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));

          // Move cursor to end
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(targetP);
          range.collapse(false); // collapse to end
          selection.removeAllRanges();
          selection.addRange(range);

          hasInserted = true;
          if (observer) {
            observer.disconnect();
            observer = null;
          }

          console.log('Tangent: Auto-pasted context successfully');
          return true;

        } catch (err) {
          console.error('Tangent: Error inserting text', err);
        }
      }

      return false;
    }

    // Try immediately
    if (findAndFillInput()) {
      return;
    }

    // Use MutationObserver to wait for input to appear
    observer = new MutationObserver(() => {
      findAndFillInput();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Safety timeout
    setTimeout(() => {
      if (!hasInserted) {
        console.log('Tangent: Timeout waiting for input element');
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      }
    }, timeoutMs);

    console.log('Tangent: Watching for input element...');
  }

  // ============================================
  // TEMPORARY CHAT AUTO-ENABLE (for iframe)
  // ============================================
  function enableTemporaryChat() {
    console.log('Tangent: Setting up temporary chat auto-enable');

    let hasEnabled = false;
    let observer = null;
    const timeoutMs = 10000; // 10 second max wait

    function findAndClickIncognitoButton() {
      if (hasEnabled) return true;

      // Strategy 1: Find the fixed top-right container with the incognito button
      let toggleContainer = null;
      let toggleButton = null;

      const fixedContainers = document.querySelectorAll('div.fixed.right-3');
      for (const container of fixedContainers) {
        const stateWrapper = container.querySelector('[data-state]');
        if (stateWrapper) {
          toggleContainer = stateWrapper;
          toggleButton = stateWrapper.querySelector('button');
          break;
        }
      }

      // Strategy 2: Find any div with data-state containing a button with ghost icon
      if (!toggleButton) {
        const stateWrappers = document.querySelectorAll('[data-state]');
        for (const wrapper of stateWrappers) {
          const btn = wrapper.querySelector('button');
          if (btn) {
            const svg = btn.querySelector('svg');
            if (svg && svg.innerHTML.includes('look-around')) {
              toggleContainer = wrapper;
              toggleButton = btn;
              break;
            }
          }
        }
      }

      if (toggleButton && toggleContainer) {
        const currentState = toggleContainer.getAttribute('data-state');

        if (currentState === 'closed') {
          toggleButton.click();
          console.log('Tangent: Enabled temporary chat');
        } else {
          console.log('Tangent: Temporary chat already enabled (state:', currentState, ')');
        }

        hasEnabled = true;
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        return true;
      }

      return false;
    }

    // Try immediately in case DOM is already ready
    if (findAndClickIncognitoButton()) {
      return;
    }

    // Use MutationObserver to watch for the button to appear
    observer = new MutationObserver(() => {
      findAndClickIncognitoButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Safety timeout - stop observing after max wait time
    setTimeout(() => {
      if (!hasEnabled) {
        console.log('Tangent: Timeout waiting for incognito button');
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      }
    }, timeoutMs);

    console.log('Tangent: Watching for incognito button...');
  }

  // ============================================
  // ENTER TO SEND FIX (for iframe)
  // ============================================
  function fixEnterToSend() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;

      // Only act when focus is inside the chat input
      const active = document.activeElement;
      if (!active || !active.closest('[contenteditable="true"], textarea')) return;

      // Find the send button
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

    console.log('Tangent: Enter-to-send fix installed');
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  function init() {
    // If we're inside an iframe (the thread panel), handle iframe-specific features
    if (window.self !== window.top) {
      console.log('Tangent: Running inside iframe');

      // Incognito toggle: relying on ?incognito=true URL param instead
      // enableTemporaryChat();

      // Auto-paste the context from the parent page
      autoPasteContext();

      // Fix Enter key to send message (iframe may not bind Enter→submit properly)
      fixEnterToSend();

      return;
    }

    // Show our own Side Chat button on any non-empty selection.
    // The platform's native selection toolbar is left untouched.
    setupSelectionButton();

    // Always-available launcher for a blank side chat
    createEdgeHandle();

    document.addEventListener('keydown', handleKeydown);

    console.log('Tangent initialized on', PLATFORM);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
