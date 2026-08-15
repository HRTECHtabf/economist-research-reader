import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const siteDataPath = resolve(projectRoot, "docs/data/articles.json");
const rawArticlesPath = resolve(projectRoot, ".cache/articles.raw.json");
const reviewedTermsPath = resolve(projectRoot, "scripts/reviewed-highlight-terms.json");

function articleSourceHash(article) {
  return createHash("sha256")
    .update([
      article.section,
      article.titleEn,
      article.rubricEn,
      article.sourceUrl,
      article.textEn,
    ].join("\n"))
    .digest("hex");
}

const siteData = JSON.parse(readFileSync(siteDataPath, "utf8"));
const rawData = JSON.parse(readFileSync(rawArticlesPath, "utf8"));
const reviewedTerms = JSON.parse(readFileSync(reviewedTermsPath, "utf8"));
const rawById = new Map(rawData.articles.map((article) => [article.id, article]));
const siteIds = new Set(siteData.articles.map((article) => article.id));
const failures = [];

for (const id of Object.keys(reviewedTerms)) {
  if (!siteIds.has(id)) failures.push(`${id}：審核清單中有不存在的文章`);
}

for (const article of siteData.articles) {
  const terms = reviewedTerms[article.id];
  if (!Array.isArray(terms) || terms.length > 3) {
    failures.push(`${article.titleEn}：標示數量不是 0–3 個`);
    continue;
  }
  if (new Set(terms).size !== terms.length) {
    failures.push(`${article.titleEn}：標示有重複`);
  }
  for (const term of terms) {
    if (typeof term !== "string" || !article.summaryZh?.includes(term)) {
      failures.push(`${article.titleEn}：摘要中找不到「${term}」`);
    }
  }
  const raw = rawById.get(article.id);
  if (!raw) failures.push(`${article.titleEn}：找不到英文原文`);
}

if (failures.length) throw new Error(`標示清單有 ${failures.length} 個問題：\n${failures.join("\n")}`);

for (const article of siteData.articles) {
  article.highlightTermsZh = reviewedTerms[article.id];
  article.highlightTermsVersion = "important-content-v1-manual-review";
  article.sourceHash = articleSourceHash(rawById.get(article.id));
}
siteData.highlightPolicyVersion = "important-content-v1";
siteData.highlightReview = {
  method: "manual-review",
  articleCount: siteData.articles.length,
};
writeFileSync(siteDataPath, `${JSON.stringify(siteData, null, 2)}\n`, "utf8");
console.log(`已套用並驗證 ${siteData.articles.length} 篇文章的人工審核標示。`);
