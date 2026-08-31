const DIAGNOSIS_RULES = [
  {
    pattern: /(?:HTTP 401|HTTP 403|尚未填寫 AZURE|invalid api key|authentication)/iu,
    kind: "azure_configuration",
    cause: "Azure OpenAI 認證或部署設定錯誤",
    action: "停止無效重試並檢查 GitHub Secrets、Endpoint 與部署名稱。",
    automaticAction: "停止發布並保留既有網站與斷點。",
    userAction: "檢查 AZURE_OPENAI_API_KEY、AZURE_OPENAI_ENDPOINT、AZURE_OPENAI_DEPLOYMENT 三項 GitHub Secrets。",
  },
  {
    pattern: /(?:HTTP 429|rate.?limit|too many requests|quota)/iu,
    kind: "azure_capacity",
    cause: "Azure OpenAI 限流或額度壓力",
    action: "保留斷點，讓指數退避與下一個週六自癒窗口接續未完成文章。",
    automaticAction: "隔離 10 篇以內的單篇失敗；第 11 篇起停止發布，等待下一個看門狗窗口。",
    userAction: "檢查 Azure 配額、用量與部署的速率限制，必要時提高額度。",
  },
  {
    pattern: /(?:HTTP 5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN)/iu,
    kind: "transient_service",
    cause: "外部服務或網路暫時性錯誤",
    action: "保留斷點並自動補跑；不發布半成品。",
    automaticAction: "單篇最多嘗試 3 次；大量失敗時停止發布並由看門狗稍後補跑。",
    userAction: "通常不需處理；若連續多次發生，檢查 GitHub Actions 與 Azure 區域服務狀態。",
  },
  {
    pattern: /(?:EPUB 尚未可用|無法取得來源目錄|找不到期數資料夾)/u,
    kind: "source_unavailable",
    cause: "來源期數尚未完整上架或來源庫暫時無法讀取",
    action: "等待下一個偵測窗口重新下載，不呼叫 Azure OpenAI。",
    automaticAction: "保留舊站，下一個排程重新檢查來源。",
    userAction: "通常不需處理；若來源長時間未更新，再檢查上游儲存庫。",
  },
  {
    pattern: /(?:content management policy|content_filter|內容安全篩選)/iu,
    kind: "content_filter",
    cause: "文章觸發 Azure 內容安全篩選",
    action: "不規避安全控制；保留摘要與英文原文，繁中產製標記為不可用。",
    automaticAction: "隔離單篇並繼續；若超過 10 篇則停止發布並排查是否為模型或設定異常。",
    userAction: "可檢查 Azure Content Safety 設定與篩選分類，但不應關閉必要的安全保護。",
  },
  {
    pattern: /(?:初稿有\s*\d+\s*篇失敗|自然化有\s*\d+\s*篇失敗|摘要長度|研究角度長度|重點\s*\d+)/u,
    kind: "summary_validation",
    cause: "少數摘要未通過內容或格式驗證",
    action: "只補跑失敗文章，沿用上一版與精確驗證回饋，不放寬品質門檻。",
    automaticAction: "每篇最多嘗試 3 次，10 篇以內隔離；第 11 篇起停止發布。",
    userAction: "若同類驗證錯誤反覆出現，可調整提示文字或個別文章例外規格。",
  },
  {
    pattern: /(?:翻譯失敗|缺少中文全文|段落數|譯文異常)/u,
    kind: "fulltext_validation",
    cause: "繁中全文翻譯或段落稽核未通過",
    action: "只補跑失敗文章或段落，全部通過前不更新 manifest。",
    automaticAction: "每篇最多嘗試 3 次，10 篇以內標記全文不可用；第 11 篇起停止發布。",
    userAction: "查看維運頁列出的文章與段落原因，必要時人工補譯或修正驗證規格。",
  },
];

export function diagnoseUpdateFailure(text) {
  return DIAGNOSIS_RULES.find(({ pattern }) => pattern.test(text)) || {
    kind: "unknown",
    cause: "未分類錯誤",
    action: "保留完整錯誤尾端與斷點，由下一次自癒執行重試並供人工追查。",
    automaticAction: "保留舊站與斷點；不把未知錯誤誤判為成功。",
    userAction: "查看維運頁與 GitHub Actions 註解中的原始錯誤摘要。",
  };
}
