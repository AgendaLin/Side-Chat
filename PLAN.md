# 專案狀態與交接筆記

更新：2026-07-02

## 目標

Fork 自 cursed-github/tangent（MIT）。把原本「劫持平台原生選取按鈕」的設計，改成
Codex 風格的獨立側邊聊天：自有 Side Chat 按鈕 + 右側停靠 panel + 主聊天縮寬。

## 目前狀態：V2.0.0 完成

branch `feature/side-chat`，所有目標行為已在 claude.ai 與 chatgpt.com 實測通過：

- 原生選取工具列（Claude Reply／ChatGPT 詢問 ChatGPT）不再被改寫，與 Side Chat 按鈕共存
- 任意非空選取（含 1 個字）觸發自有按鈕；點擊開啟右側停靠 panel
- 主聊天以 html margin-right 縮寬，不被遮住，兩邊獨立滾動
- context 自動貼入側欄輸入框；側欄用使用者既有登入回覆
- minimize/restore 保留 iframe（對話同頁存活）；Escape 最小化；左緣拖曳調寬
- 側欄走 incognito/temporary chat，不污染主聊天與側邊欄紀錄

## 關鍵技術決策（含被否決方案）

1. **主聊天縮寬 = inline style 的 `margin-right !important` 設在 `<html>`，由 JS 切換**
   - 否決「CSS 規則設 body margin」：claude.ai 用 cascade layer 的 `!important`
     釘死 body margin-right，extension 的 unlayered stylesheet 在 important 比較中必輸，
     連 inline important 都壓不過 body 那條；但 `<html>` 的 inline important 可以贏。
   - 否決「html 上掛 CSS transition 做動畫」：claude.ai 上該 transition 會卡死在
     currentTime 0（CSSTransition state running 但永不前進），transition 在 cascade
     優先權最高 → margin 被永久凍結成 0。所以 margin 直接切換、不做動畫。
2. **觸發改用 `selectionchange`（debounce 150ms）+ 自有按鈕**，不再 MutationObserver
   盯平台 tooltip。原版靠 `button.btn-secondary` + 文字 `Ask ChatGPT` 比對，
   在非英文介面永遠不會命中（這就是原版「GPT 用不了」的根因）。
3. **單一展開 panel**：開新 thread 或 restore 時自動 minimize 目前展開的，
   多 thread 靠既有 minimized tab bar。
4. 保留原版的 sessionStorage + URL hash 傳 context、iframe auto-paste、
   rules.json（ChatGPT iframe header 剝除）、Enter-to-send fix。

## 已知邊界情況

- claude.ai 的 incognito 對話是 per-tab：若主聊天本身就是 incognito，側欄會與它
  共用同一個暫存對話。一般情境（主聊天為正常對話）不受影響。
- Windows 上 `Ctrl+Shift+T` 被 Chrome 保留（重開分頁），快捷鍵入口實際只在 macOS 可用。
- 選取 Claude 的 thinking 摘要區塊（user-select:none）不會觸發按鈕（正確行為）。

## 開發環境

- 正本：`C:\Users\crayo\personal-system\projects\chatbot-side-conversation`
- Chrome Load unpacked 指向此資料夾；改 code 後開 `http://reload.extensions`
  （Extensions Reloader）再重新整理頁面即可生效。
- `_metadata/` 是 Chrome 生成物，已 gitignore。

## 之後可能的方向（未做）

- 推上使用者自己的 GitHub repo（本機 gh 未登入，需 `gh auth login`）
- 產品改名／icon 更換（需使用者決定）
- Gemini 支援、跨 reload 的 thread 持久化（上游 TODO 遺留）
