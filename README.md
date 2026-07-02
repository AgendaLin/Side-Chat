# Tangent Side Chat – Docked Side Conversations for Claude & ChatGPT

**Select any text and open a side chat next to your main conversation.**

Fork of [cursed-github/tangent](https://github.com/cursed-github/tangent) (MIT), redesigned around a
non-intrusive side-chat entry: the platform's native selection toolbar is left untouched, and the
thread panel docks to the right edge instead of floating over the page.

## How It Works

1. **Select any text** in a Claude or ChatGPT conversation — even a single character
2. **Click the "Side Chat" button** that appears next to your selection
3. **A docked panel opens on the right** with a fresh temporary/incognito chat; the main chat
   shrinks to make room instead of being covered
4. **Your selected context is auto-pasted** into the side chat input (and copied to the clipboard
   as a fallback)
5. **Minimize threads to tabs**, restore them later — the side conversation stays alive for the
   whole page session, and restoring scrolls you back to where you branched off

```
關閉側欄時:
+--------------------------------------------------+
|                   main chat                      |
|   選取文字後:  [原生工具列]  [Side Chat]           |
+--------------------------------------------------+

開啟側欄時:
+--------------------------------+-----------------+
|          main chat             |    Side Chat    |
|   縮寬、可獨立滾動、不被遮住      |  針對選取內容追問 |
+--------------------------------+-----------------+
```

## Differences from upstream Tangent

- **No hijacking** — Claude's "Reply" button and ChatGPT's "Ask ChatGPT" button keep their native
  behavior; Tangent adds its own button instead. (The upstream hijack also silently broke on
  non-English ChatGPT UIs, since it matched the literal button text `Ask ChatGPT`.)
- **Any non-empty selection triggers** the button (upstream required 10+ characters)
- **Docked, not floating** — the panel is a full-height dock on the right; the main chat shrinks
  and both areas scroll independently
- Drag-to-move is gone (the dock is fixed); drag the panel's left edge to resize

## Features

- Works on **claude.ai** and **chatgpt.com**
- **Multiple threads** — the dock shows one expanded thread; others wait in the minimized tab bar
- **Temporary by default** — side chats run in incognito / temporary-chat mode, no sidebar clutter
- **Session persistence** — minimized threads keep their iframe alive; conversations survive
  minimize/restore for the lifetime of the page
- **Visual scroll-back** — restoring a thread highlights the text you branched from
- Runs entirely locally, no backend, no API key, no data collection; uses your existing login

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+\` | Open a blank thread (macOS) |
| `Cmd/Ctrl+Shift+T` | Open a thread from the current selection (on Windows, Chrome usually reserves `Ctrl+Shift+T` for reopening tabs — use the Side Chat button instead) |
| `Escape` | Minimize the active thread |

## Installation (from source)

1. Clone this repository
2. Open `chrome://extensions/`, enable **Developer mode**
3. **Load unpacked** → select the repository folder
4. Open [claude.ai](https://claude.ai) or [chatgpt.com](https://chatgpt.com) and select some text

## Configuration

Key settings at the top of `content.js`:

```javascript
const CONFIG = {
  minSelectionLength: 1,   // any non-empty (trimmed) selection shows the Side Chat button
  panelWidth: 480,         // initial docked panel width in pixels
  panelMinWidth: 320
};
```

## Known Limitations

- **Iframe dependency** — the panel loads Claude/ChatGPT in an iframe (`rules.json` strips the
  blocking headers for ChatGPT). Platform security-header changes may break this; an
  "open in new tab" fallback is provided.
- **Incognito main chat on claude.ai** — Claude's incognito state is per-tab, so if your *main*
  chat is already an incognito chat, the side chat shares the same temporary conversation.
  Normal (saved) main chats are unaffected.
- **Auto-paste** may occasionally lose the race against a slow page load; the context is also on
  the clipboard, so `Cmd/Ctrl+V` always works.
- **Page-session lifetime** — side chats survive minimize/restore, but a full page reload or
  navigation closes them (temporary chats are not persisted by the platforms either).

## License

MIT License. See [LICENSE](LICENSE) for details. Original work © cursed-github/tangent.
