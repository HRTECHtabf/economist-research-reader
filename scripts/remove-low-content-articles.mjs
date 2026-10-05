import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOW_CONTENT_POLICY_VERSION, lowContentReason, wordCount } from "./lib/low-content-policy.mjs";

// 依 low-content-policy 移除既有資料庫中的圖片型低內容頁面。預設只列出清單，加 --apply 才會寫入。
const projectRoot = resolve(import.meta.dirname, "..");
const dataPath = resolve(projectRoot, "docs/data/articles.json");
const apply = process.argv.includes("--apply");

const data = JSON.parse(readFileSync(dataPath, "utf8"));
if (!Array.isArray(data.articles) || !data.articles.length) throw new Error("文章資料庫是空的");

const removed = data.articles.filter((article) => lowContentReason(article));
if (!removed.length) {
  console.log("沒有符合條件的圖片型低內容頁面。");
  process.exit(0);
}

console.log(`規則 ${LOW_CONTENT_POLICY_VERSION} 找到 ${removed.length} 篇：`);
for (const article of removed) {
  console.log(`- ${article.issueKey}:${article.id}｜${lowContentReason(article)}｜${wordCount(article.textEn)} 字｜${article.titleEn}`);
}
if (!apply) {
  console.log("僅列出清單；確認後加 --apply 寫入。");
  process.exit(0);
}

const removedKeys = new Set(removed.map((article) => `${article.issueKey}:${article.id}`));
const articles = data.articles.filter((article) => !removedKeys.has(`${article.issueKey}:${article.id}`));
const currentIssueArticles = articles.filter((article) => article.issueKey === data.issueKey);
const output = {
  ...data,
  generatedAt: new Date().toISOString(),
  articleCount: currentIssueArticles.length,
  summaryCount: currentIssueArticles.filter((article) => article.summaryZh).length,
  featuredCount: currentIssueArticles.filter((article) => article.summaryZh).length,
  ...("summaryUnavailableCount" in data
    ? { summaryUnavailableCount: currentIssueArticles.filter((article) => article.summaryStatus === "unavailable").length }
    : {}),
  ...("summaryDraftFallbackCount" in data
    ? { summaryDraftFallbackCount: currentIssueArticles.filter((article) => article.summaryStatus === "draft_fallback").length }
    : {}),
  totalArticleCount: articles.length,
  issueCount: new Set(articles.map((article) => article.issueKey)).size,
  articles,
};

const temporaryPath = `${dataPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
renameSync(temporaryPath, dataPath);
for (const article of removed) {
  const fulltextPath = resolve(projectRoot, "docs/data/fulltext", article.issueKey, `${article.id}.json`);
  if (existsSync(fulltextPath)) rmSync(fulltextPath);
}
console.log(`已移除 ${removed.length} 篇；文章庫剩 ${articles.length} 篇。重建公開資料與全文清單…`);

for (const script of ["scripts/build-public-data.mjs", "scripts/audit-fulltext-zh.mjs"]) {
  execFileSync(process.execPath, [resolve(projectRoot, script)], { cwd: projectRoot, stdio: "inherit" });
}
