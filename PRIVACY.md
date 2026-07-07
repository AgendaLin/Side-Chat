# Privacy Policy — SideChat

_Last updated: 2026-07-06_

**SideChat does not collect, transmit, sell, or share any of your data.**
Everything the extension does happens locally in your browser.

## What SideChat does with data

- **Selected text** you turn into a side chat is inserted into the side
  chat's input box locally, and copied to your clipboard as a fallback. It is
  **not sent anywhere by the extension** — only to Anthropic/OpenAI if and
  when *you* press send inside the side chat, exactly as it would in a normal
  message you type yourself.
- **The side chat itself** loads claude.ai or chatgpt.com inside a panel
  (an iframe) using **your existing login**. Your conversations go directly
  to Anthropic/OpenAI through their own site, as they normally would. SideChat
  is not a middleman and never sees, stores, or forwards your conversation
  content.

## What SideChat stores locally (and never transmits)

Stored only in your browser's `localStorage` on claude.ai / chatgpt.com:

1. A mapping from a main conversation to the side conversation you chose to
   keep (so it can be reopened after a reload).
2. Your **Temp / Saved** default-mode preference.

That's it. This data never leaves your device and can be cleared any time by
clearing the site's browsing data.

## What SideChat does NOT do

- No analytics, telemetry, tracking, or fingerprinting.
- No external/back-end servers of its own. No network requests beyond loading
  claude.ai / chatgpt.com in the panel.
- No accounts, no API keys, no ads, no data sale or transfer to third parties.

## Permissions

- **Host access to `claude.ai` and `chatgpt.com`** — the extension only runs
  on these two sites, to add the Side Chat UI and read the text you select.
- **`clipboardWrite`** — to copy the selected context to your clipboard as a
  paste fallback.
- **`declarativeNetRequest`** — to remove the anti-framing response headers
  (`X-Frame-Options`, `Content-Security-Policy`) **on chatgpt.com sub-frame
  requests only**, so ChatGPT can be displayed inside the side panel. No other
  requests, sites, or header types are touched.

## Contact

Questions: open an issue at https://github.com/AgendaLin/Side-Chat/issues
