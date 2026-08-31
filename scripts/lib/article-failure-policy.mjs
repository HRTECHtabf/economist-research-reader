export const MAX_ARTICLE_ATTEMPTS = 3;
export const MAX_SKIPPED_ARTICLES = 10;
export const RETRY_EXHAUSTED_REASON = "retry_exhausted_after_3_attempts";

export function isSystemicFailureCount(count) {
  return Number(count) > MAX_SKIPPED_ARTICLES;
}

export function sanitizePublicFailureMessage(value, maximumLength = 500) {
  return String(value || "未提供錯誤內容")
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/giu, "$1=[已隱藏]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[可能的敏感值已隱藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}
