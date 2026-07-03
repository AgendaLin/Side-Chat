# SideChat – Docked Side Conversations for Claude & ChatGPT

**Select any text and open a side chat next to your main conversation.**

Fork of [cursed-github/tangent](https://github.com/cursed-github/tangent) (MIT), redesigned around a
non-intrusive side-chat entry: the platform's native selection toolbar is left untouched, and the
thread panel docks to the right edge instead of floating over the page.

## How It Works

Each main conversation has **one** side chat.

1. **Select any text** in a Claude or ChatGPT conversation — even a single character
2. **Click the "Side Chat" button** that appears next to your selection (or click the amber
   handle on the right edge for a blank side chat)
3. **A docked panel opens on the right** with a fresh temporary/incognito chat; the main chat
   shrinks to make room instead of being covered
4. **Your selected context is auto-pasted** into the side chat input as its own lines, with a
   blank line and the caret waiting below so you can type your question straight away; selecting
   more text later appends the new context into the *same* side conversation
5. **Minimize** (－/Escape) keeps the side chat alive for the page session — the edge handle
   lights up with a dot; click it to bring the conversation back, scrolled to where you
   branched off. The close button destroys a temporary side chat (trash icon) or merely
   unbinds a saved one (broken-link icon — the conversation stays in your history).

### Keeping a side chat across reloads

Side chats are temporary by default and vanish on reload. To keep one: turn off
temporary/incognito mode *inside* the side chat using the platform's own toggle. Once it becomes
a real saved conversation, SideChat remembers the main-conversation → side-conversation binding
(in the site's localStorage) and the edge handle restores it next time you open that main
conversation — across reloads and browser restarts.

- **ChatGPT**: toggle temporary chat off any time; the drafted input survives the switch.
- **Claude**: "Exit incognito" *discards* the incognito conversation (platform behavior), so
  exit incognito **before** you start chatting if you want the side chat to persist.

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
  behavior; SideChat adds its own button instead. (The upstream hijack also silently broke on
  non-English ChatGPT UIs, since it matched the literal button text `Ask ChatGPT`.)
- **Any non-empty selection triggers** the button (upstream required 10+ characters)
- **Docked, not floating** — the panel is a full-height dock on the right; the main chat shrinks
  and both areas scroll independently
- Drag-to-move is gone (the dock is fixed); drag the panel's left edge to resize

## Features

- Works on **claude.ai** and **chatgpt.com**
- **One side chat per conversation** — every selection feeds the same side conversation instead
  of spawning new threads; switching main conversations switches the side chat with it
- **Temporary by default, switchable** — side chats open in incognito / temporary-chat mode
  (no sidebar clutter). A **Temp ↔ Saved** slide switch in the panel header sets the default mode
  for new side chats and is remembered; "Saved" opens them as normal conversations that persist
- **Session persistence** — minimized side chats keep their iframe alive; saved side chats are
  restorable across reloads via the edge handle
- **Visual scroll-back** — restoring a minimized side chat highlights the text you branched from
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
