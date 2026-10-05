// 圖片為主、文字只有連結或圖說的頁面（每週漫畫、單張照片圖說）沒有可研究的內容，不收進文章庫。
// 一般短訊（例如百餘字的地震快報）仍保留；門檻依現有文章的字數分布訂定，正式文章至少兩百多字。
export const LOW_CONTENT_POLICY_VERSION = "visual-low-content-v1";
const CARTOON_MAX_WORDS = 150;
const CAPTION_MAX_WORDS = 80;

export function wordCount(text) {
  return String(text || "").split(/\s+/u).filter(Boolean).length;
}

export function lowContentReason(article) {
  const words = wordCount(article?.textEn);
  const title = String(article?.titleEn || "");
  const sourceUrl = String(article?.sourceUrl || "");
  const text = String(article?.textEn || "").trim();
  const looksLikeCartoon =
    /^cartoon\b/iu.test(title) ||
    /\bweekly cartoon\b/iu.test(title) ||
    /\/(?:cartoon-[^/]*|the-weekly-cartoon)\/?$/iu.test(sourceUrl) ||
    /^dig deeper\b/iu.test(text);
  if (looksLikeCartoon && words < CARTOON_MAX_WORDS) return "cartoon";
  if (words < CAPTION_MAX_WORDS) return "photo_caption";
  return null;
}

export function isLowContentArticle(article) {
  return lowContentReason(article) !== null;
}
