import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, "docs/data/articles.json");
const catalogPath = resolve(projectRoot, "docs/data/catalog.json");
const manifestPath = resolve(projectRoot, "docs/data/public-manifest.json");
const englishRoot = resolve(projectRoot, "docs/data/fulltext-en");

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(source.articles) || !source.articles.length) {
  throw new Error("文章主資料為空，停止建立公開分片");
}

const issueArticles = new Map();
const catalogArticles = source.articles.map(({ textEn, ...article }) => {
  if (typeof textEn !== "string" || textEn.length <= 200) {
    throw new Error(`${article.issueKey}:${article.id} 缺少英文全文`);
  }
  const records = issueArticles.get(article.issueKey) || [];
  records.push({ id: article.id, sourceHash: article.sourceHash, textEn });
  issueArticles.set(article.issueKey, records);
  return article;
});

const issues = {};
for (const [issueKey, articles] of [...issueArticles].sort(([a], [b]) => b.localeCompare(a))) {
  const version = createHash("sha256")
    .update(articles.map((article) => `${article.id}:${article.sourceHash}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const relativePath = `fulltext-en/${issueKey}.json`;
  writeJsonAtomic(resolve(projectRoot, "docs/data", relativePath), {
    version: 1,
    issueKey,
    articleCount: articles.length,
    articles,
  });
  issues[issueKey] = { path: relativePath, version, articleCount: articles.length };
}

const catalog = {
  ...source,
  dataFormatVersion: 2,
  articles: catalogArticles,
};
writeJsonAtomic(catalogPath, catalog);
writeJsonAtomic(manifestPath, {
  version: 1,
  generatedAt: source.generatedAt,
  issueKey: source.issueKey,
  totalArticleCount: catalogArticles.length,
  catalog: { path: "catalog.json", version: source.generatedAt },
  englishIssues: issues,
});

console.log(`公開資料分片完成：${catalogArticles.length} 篇、${issueArticles.size} 期。`);
