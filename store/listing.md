# Chrome Web Store — Listing copy for SideChat

Paste these into the Developer Dashboard when submitting.

---

## Item name (max 75 chars)

SideChat – Side Conversations for ChatGPT & Claude

## Summary / short description (max 132 chars)

Select any text in ChatGPT or Claude and open a docked side chat — ask
follow-ups without cluttering your main conversation.

## Category

Productivity

## Detailed description

SideChat adds a side conversation to Claude and ChatGPT.

Reading a long answer and want to ask a quick follow-up — but don't want to
derail your main thread? Select any text and click **Side Chat**. A panel
docks to the right with a fresh, temporary chat, and your selected text is
dropped in ready for your question. Your main conversation stays exactly where
it was — it just shrinks to make room, so nothing gets covered.

FEATURES
• Select any text (even one word) → open a docked side chat next to it
• The main chat shrinks instead of being hidden — both scroll independently
• One side chat per conversation; select more text to add it to the same side chat
• Temporary by default (nothing saved) — flip the Temp/Saved switch to keep one
• Kept side chats survive page reloads
• A right-edge handle reopens the side chat any time
• Works on claude.ai and chatgpt.com, using your existing login — no API key

PRIVATE BY DESIGN
Runs entirely in your browser. No accounts, no analytics, no tracking, no data
collection, no external servers. See the privacy policy for details.

SideChat is open source and MIT-licensed. It is an independent project and is
not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.

## Privacy policy URL

https://github.com/AgendaLin/Side-Chat/blob/main/PRIVACY.md

## Homepage / support URL

https://github.com/AgendaLin/Side-Chat

---

## Permission justifications (for the review form)

- **host permission — claude.ai / chatgpt.com**: The extension's entire
  functionality is on these two sites. It injects the Side Chat button and
  docked panel, and reads the user's text selection to seed the side chat.

- **clipboardWrite**: Copies the user's selected context to the clipboard as a
  paste fallback, in case automatic insertion into the side chat input misses.

- **declarativeNetRequest**: A single static rule removes `X-Frame-Options`
  and `Content-Security-Policy` **only from chatgpt.com sub_frame responses**,
  so ChatGPT can be embedded in the side panel iframe. It targets nothing else
  — no other sites, request types, or headers.

## Notes for the reviewer (put in the review/justification box)

SideChat shows a side conversation by loading claude.ai / chatgpt.com in an
iframe inside a docked panel, using the user's own logged-in session.

ChatGPT sends anti-framing headers (X-Frame-Options / CSP frame-ancestors)
that would block this embed, so the extension uses one declarativeNetRequest
rule to strip those two headers **only on chatgpt.com sub_frame requests**
(see rules.json). This is solely to embed the same site the user is already
on, for their convenience — it is not used to frame third-party sites and does
not weaken security elsewhere. Claude loads in the iframe without any header
modification.

No data is collected or sent anywhere by the extension. Source:
https://github.com/AgendaLin/Side-Chat

---

## Screenshots to upload (1280×800)

Generated into `store/screenshots/` (gitignored). Upload at least one; two is
better:
1. `01-docked.png` — a docked side chat next to the main conversation
2. `02-select.png` — the Side Chat button appearing on a text selection
