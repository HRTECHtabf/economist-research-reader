# 專案工作規則

## 中文研究摘要

- 產生、修改或審閱繁體中文研究摘要時，必須讀取並套用 `.agents/skills/humanizer-zh-tw/SKILL.md`。
- 文章摘要、核心重點與研究角度另讀取 `.agents/skills/humanizer-zh-tw/references/economist-research-summary.md`。
- 批次處理或修改提示文字時，另讀取 `.agents/skills/humanizer-zh-tw/references/pattern-library.md`。
- Azure OpenAI 金鑰只放在本機或 GitHub Secrets，不得寫入 `docs/` 或版本控制。

## 更新流程

- 來源庫通常每週更新一次；排程以 Asia/Taipei 的週五下午至深夜進行多次偵測。
- 只有偵測到新的 `te_YYYY.MM.DD` 期數才下載 EPUB、產生摘要並更新網站。
- 同一期已處理時必須安全結束，不重複呼叫 Azure OpenAI。
- 自動更新失敗時保留既有網站資料，不得發布半成品。
