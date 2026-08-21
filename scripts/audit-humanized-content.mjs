import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GENERAL_KEYWORD_TAXONOMY } from "./general-keyword-taxonomy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const dataPath = resolve(projectRoot, process.argv[2] || "docs/data/articles.json");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const supportedHumanizerVersions = new Set([
  "economist-humanizer-v3",
  "economist-humanizer-v4",
]);
const expectedKeywordPolicyVersion = "general-keywords-v1";
const allowedKeywords = new Set(GENERAL_KEYWORD_TAXONOMY);

const aiStylePattern = /綜上所述|總體而言|一言以蔽之|未來可期|值得深入閱讀|可供參考|值得注意的是|由此可見|賦能|助力|底層邏輯|深遠影響|重要里程碑|不只是.{0,35}而是|不僅.{0,35}更/u;
const contextlessPointOpening = /^(?:文章|本文|文中)(?:同時|另|也|還|進一步)|^(?:原因與風險|其他變化|也有|另一個|此外|另一方面|至於|這些|此舉|上述)/u;
const mainlandTerms = /特朗普|英偉達|日元|信息|軟件|在線/u;
const translatedNumberPattern = /\d+(?:\.\d+)?(?:百萬|十億)(?!分之)/u;
const completeSentence = (value) => typeof value === "string" && /[。！？…》〉」』”’]$/u.test(value.trim());
const issues = [];
const pointLengths = [];
const summaryLengths = [];
const lensLengths = [];
const pointCounts = {};
const lensOpenings = new Map();

for (const article of data.articles || []) {
  const label = `${article.issueKey}｜${article.titleEn}`;
  if (!supportedHumanizerVersions.has(article.humanizerVersion)) issues.push(`${label}｜自然化版本不符`);
  if (article.keywordPolicyVersion !== expectedKeywordPolicyVersion) {
    issues.push(`${label}｜標籤政策版本不符`);
  }
  if (
    !Array.isArray(article.keywordsZh) ||
    article.keywordsZh.length < 3 ||
    article.keywordsZh.length > 5 ||
    new Set(article.keywordsZh).size !== article.keywordsZh.length ||
    article.keywordsZh.some((keyword) => !allowedKeywords.has(keyword))
  ) {
    issues.push(`${label}｜標籤不符合固定廣義詞彙表或數量規則`);
  }
  if (!completeSentence(article.summaryZh) || article.summaryZh.length < 130 || article.summaryZh.length > 250) {
    issues.push(`${label}｜摘要長度或句尾不符`);
  }
  if (/^(?:本文指出|文章聚焦|作者認為)/u.test(article.summaryZh) || aiStylePattern.test(article.summaryZh)) {
    issues.push(`${label}｜摘要含公式化句型`);
  }
  summaryLengths.push(article.summaryZh.length);

  if (!Array.isArray(article.keyPointsZh) || article.keyPointsZh.length < 3 || article.keyPointsZh.length > 5) {
    issues.push(`${label}｜重點數量不符`);
  } else {
    pointCounts[article.keyPointsZh.length] = (pointCounts[article.keyPointsZh.length] || 0) + 1;
    article.keyPointsZh.forEach((point, index) => {
      pointLengths.push(point.length);
      if (!completeSentence(point) || point.length < 25 || point.length > 86) issues.push(`${label}｜重點 ${index + 1} 長度或句尾不符`);
      if (contextlessPointOpening.test(point) || /^[^，。！？；]{2,18}：/u.test(point) || (point.match(/；/g) || []).length > 1 || aiStylePattern.test(point)) {
        issues.push(`${label}｜重點 ${index + 1} 不夠獨立或含公式化句型`);
      }
    });
  }

  if (!completeSentence(article.researchLensZh) || article.researchLensZh.length < 50 || article.researchLensZh.length > 135 || aiStylePattern.test(article.researchLensZh)) {
    issues.push(`${label}｜研究角度不符`);
  }
  lensLengths.push(article.researchLensZh.length);
  const opening = [...article.researchLensZh].slice(0, 8).join("");
  lensOpenings.set(opening, (lensOpenings.get(opening) || 0) + 1);

  const allText = [article.summaryZh, ...article.keyPointsZh, article.researchLensZh, ...article.keywordsZh].join("\n");
  if (mainlandTerms.test(allText)) issues.push(`${label}｜含非台灣慣用詞`);
  if (translatedNumberPattern.test(allText)) issues.push(`${label}｜含翻譯腔數字寫法`);
  if ((article.highlightTermsZh || []).some((term) => !article.summaryZh.includes(term))) issues.push(`${label}｜摘要標示短語不存在`);
}

const average = (values) => Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
const repeatedLensOpenings = [...lensOpenings.entries()].filter(([, count]) => count >= 8).sort((a, b) => b[1] - a[1]);
const report = {
  articles: data.articles.length,
  issues: new Set(data.articles.map((article) => article.issueKey)).size,
  humanizerVersions: data.articles.reduce((counts, article) => {
    counts[article.humanizerVersion || "missing"] = (counts[article.humanizerVersion || "missing"] || 0) + 1;
    return counts;
  }, {}),
  keywordPolicyVersion: expectedKeywordPolicyVersion,
  keywordTaxonomySize: GENERAL_KEYWORD_TAXONOMY.length,
  pointCounts,
  pointLength: { min: Math.min(...pointLengths), max: Math.max(...pointLengths), average: average(pointLengths) },
  summaryLength: { min: Math.min(...summaryLengths), max: Math.max(...summaryLengths), average: average(summaryLengths) },
  researchLensLength: { min: Math.min(...lensLengths), max: Math.max(...lensLengths), average: average(lensLengths) },
  repeatedLensOpenings,
  issueCount: issues.length,
};

console.log(JSON.stringify(report, null, 2));
if (issues.length) {
  console.error(issues.slice(0, 80).join("\n"));
  if (issues.length > 80) console.error(`另有 ${issues.length - 80} 項未列出`);
  process.exit(1);
}
