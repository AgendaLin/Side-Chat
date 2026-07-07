# Chrome Web Store 送審 — 各欄位複製貼上清單

每個標題 = 表單欄位（中文對照）。底下框內英文直接複製貼上。

---

## ▸ 商品名稱（Item name，上限 75 字）

SideChat – Side Conversations for ChatGPT & Claude

## ▸ 簡短說明 / Summary（上限 132 字）

Select any text in ChatGPT or Claude and open a docked side chat — ask follow-ups without cluttering your main conversation.

## ▸ 詳細說明 / Description（就是你問的 description，貼這整段）

SideChat adds a side conversation to Claude and ChatGPT.

Reading a long answer and want to ask a quick follow-up — but don't want to derail your main thread? Select any text and click "Side Chat". A panel docks to the right with a fresh, temporary chat, and your selected text is dropped in ready for your question. Your main conversation stays exactly where it was — it just shrinks to make room, so nothing gets covered.

FEATURES
• Select any text (even one word) → open a docked side chat next to it
• The main chat shrinks instead of being hidden — both scroll independently
• One side chat per conversation; select more text to add it to the same side chat
• Temporary by default (nothing saved) — flip the Temp/Saved switch to keep one
• Kept side chats survive page reloads
• A right-edge handle reopens the side chat any time
• Works on claude.ai and chatgpt.com, using your existing login — no API key

PRIVATE BY DESIGN
Runs entirely in your browser. No accounts, no analytics, no tracking, no data collection, no external servers. See the privacy policy for details.

SideChat is open source and MIT-licensed. It is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.

## ▸ 分類 / Category

Workflow & Planning
（舊的「Productivity」現在是群組標題，選底下的 "Workflow & Planning" 子分類；"Tools" 也可。）

## ▸ 單一用途說明 / Single purpose（就是你問的單一用途，貼這段）

SideChat has a single purpose: it opens a docked side conversation next to your main Claude or ChatGPT chat, so you can ask follow-up questions about selected text without cluttering your main thread.

---

# 權限理由（Permission justifications）

## ▸ 要求 clipboardWrite 的理由（你已填好，這是原文）

Copies the user's selected context to the clipboard as a paste fallback, in case automatic insertion into the side chat input misses.

## ▸ 要求 declarativeNetRequest 的理由（貼這段）

A single static rule removes the X-Frame-Options and Content-Security-Policy response headers only on chatgpt.com sub_frame (iframe) requests, so ChatGPT can load inside the extension's docked side panel. It targets nothing else — no other sites, request types, or headers — and no requests are blocked or redirected. This is solely to embed the same site the user is already on.

## ▸ 要求網站存取權限的理由（host permission，貼這段）

The extension runs only on claude.ai and chatgpt.com. It needs to add the Side Chat button and docked panel, read the user's text selection to seed the side chat, and load the side conversation using the user's existing login. It accesses no other sites.

---

# ▸ 資料使用聲明（Data usage）

全部勾「不收集 / does NOT collect」。SideChat 不收集、不傳送任何使用者資料。

# ▸ 隱私政策網址（Privacy policy URL）

https://github.com/AgendaLin/Side-Chat/blob/main/PRIVACY.md

# ▸ 首頁 / 支援網址（Homepage / Support URL）

https://github.com/AgendaLin/Side-Chat

---

# ▸ 給審查員的備註（審查備註欄，非常重要，別漏）

SideChat shows a side conversation by loading claude.ai / chatgpt.com in an iframe inside a docked panel, using the user's own logged-in session.

ChatGPT sends anti-framing headers (X-Frame-Options / CSP frame-ancestors) that would block this embed, so the extension uses one declarativeNetRequest rule to strip those two headers only on chatgpt.com sub_frame requests (see rules.json). This is solely to embed the same site the user is already on, for their convenience — it is not used to frame third-party sites and does not weaken security elsewhere. Claude loads in the iframe without any header modification.

No data is collected or sent anywhere by the extension. Source: https://github.com/AgendaLin/Side-Chat

---

# ▸ 截圖（Screenshots，1280×800，上傳 store/screenshots/ 裡的）

- 01-claude-select.png
- 02-claude-docked.png
- 03-chatgpt-select.png
- 04-chatgpt-docked.png
