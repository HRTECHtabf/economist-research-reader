const DIAGNOSIS_RULES = [
  {
    pattern: /(?:HTTP 401|HTTP 403|尚未填寫 AZURE|invalid api key|authentication)/iu,
    kind: "azure_configuration",
    cause: "Azure OpenAI 認證或部署設定錯誤",
    action: "停止無效重試並檢查 GitHub Secrets、Endpoint 與部署名稱。",
  },
  {
    pattern: /(?:HTTP 429|rate.?limit|too many requests|quota)/iu,
    kind: "azure_capacity",
    cause: "Azure OpenAI 限流或額度壓力",
    action: "保留斷點，讓指數退避與下一個週六自癒窗口接續未完成文章。",
  },
  {
    pattern: /(?:HTTP 5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN)/iu,
    kind: "transient_service",
    cause: "外部服務或網路暫時性錯誤",
    action: "保留斷點並自動補跑；不發布半成品。",
  },
  {
    pattern: /(?:EPUB 尚未可用|無法取得來源目錄|找不到期數資料夾)/u,
    kind: "source_unavailable",
    cause: "來源期數尚未完整上架或來源庫暫時無法讀取",
    action: "等待下一個偵測窗口重新下載，不呼叫 Azure OpenAI。",
  },
  {
    pattern: /(?:初稿有\s*\d+\s*篇失敗|自然化有\s*\d+\s*篇失敗|摘要長度|研究角度長度|重點\s*\d+)/u,
    kind: "summary_validation",
    cause: "少數摘要未通過內容或格式驗證",
    action: "只補跑失敗文章，沿用上一版與精確驗證回饋，不放寬品質門檻。",
  },
  {
    pattern: /(?:翻譯失敗|缺少中文全文|段落數|譯文異常)/u,
    kind: "fulltext_validation",
    cause: "繁中全文翻譯或段落稽核未通過",
    action: "只補跑失敗文章或段落，全部通過前不更新 manifest。",
  },
];

export function diagnoseUpdateFailure(text) {
  return DIAGNOSIS_RULES.find(({ pattern }) => pattern.test(text)) || {
    kind: "unknown",
    cause: "未分類錯誤",
    action: "保留完整錯誤尾端與斷點，由下一次自癒執行重試並供人工追查。",
  };
}
