export const CONTENT_FILTER_REASON = "azure_content_filter";
export const ALLOWED_UNAVAILABLE_REASONS = new Set([
  CONTENT_FILTER_REASON,
  "retry_exhausted_after_3_attempts",
]);

const FILTER_CATEGORY_LABELS = {
  hate: "仇恨",
  sexual: "性內容",
  violence: "暴力",
  self_harm: "自我傷害",
  jailbreak: "越獄提示",
  protected_material_text: "受保護文字",
  protected_material_code: "受保護程式碼",
  indirect_attack: "間接提示攻擊",
  custom_blocklists: "自訂封鎖清單",
};

export function describeAzureContentFilter(payload) {
  const inner = payload?.error?.innererror || payload?.error?.inner_error || {};
  const result = inner.content_filter_result || inner.content_filter_results || {};
  const blocked = Object.entries(result).flatMap(([category, value]) => {
    if (!value || typeof value !== "object") return [];
    if (value.filtered !== true && value.detected !== true) return [];
    const label = FILTER_CATEGORY_LABELS[category] || category;
    return [`${label}${value.severity ? `（${value.severity}）` : ""}`];
  });
  if (!blocked.length) return null;
  return `Azure 內容安全篩選拒絕；偵測分類：${blocked.join("、")}。`;
}

export function isContentFilterError(error) {
  const message = String(error?.message || error || "");
  return /content (?:management|filter)|content_filter|responsibleai|safety system|內容安全篩選/iu.test(message);
}

export function translationCoverage(manifest = {}) {
  return (Number(manifest.articleCount) || 0) + (Number(manifest.unavailableCount) || 0);
}
