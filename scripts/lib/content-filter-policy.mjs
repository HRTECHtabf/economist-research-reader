export const CONTENT_FILTER_REASON = "azure_content_filter";

export function isContentFilterError(error) {
  const message = String(error?.message || error || "");
  return /content (?:management|filter)|content_filter|responsibleai|safety system/iu.test(message);
}

export function translationCoverage(manifest = {}) {
  return (Number(manifest.articleCount) || 0) + (Number(manifest.unavailableCount) || 0);
}
