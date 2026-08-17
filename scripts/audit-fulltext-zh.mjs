import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const dataPath = resolve(projectRoot, "docs/data/articles.json");
const outputRoot = resolve(projectRoot, "docs/data/fulltext");
const reportPath = resolve(projectRoot, ".cache/fulltext-zh-v2.audit.json");
const manifestPath = resolve(projectRoot, "docs/data/fulltext/manifest.json");
const EXPECTED_VERSION = "fulltext-zh-tw-v2";

function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function outputPath(article) {
  return resolve(outputRoot, article.issueKey, `${article.id}.json`);
}

function paragraphs(text) {
  return text.split(/\n+/).map((value) => value.trim()).filter(Boolean);
}

const data = readJson(dataPath);
if (!Array.isArray(data?.articles)) throw new Error("文章資料庫格式不正確");

const forbiddenPattern = /特朗普|英偉達|日元|信息|軟件|在線|視頻|渠道|遏制|青年運動（Houthi|塔塔之子|別弄錯了|翻譯如下|以下是(?:這段|本段|中文)|作為一個AI|綜上所述/u;
const redundantPattern = /推(?:高|升).{0,12}(?:飆升|飆漲)|迫使.{0,12}(?:必須|不得不)|進行.{0,12}的進行/u;
const failures = [];
const warnings = [];
const records = [];

for (const article of data.articles) {
  const path = outputPath(article);
  const value = readJson(path);
  const key = `${article.issueKey}:${article.id}`;
  if (!value) {
    failures.push({ key, issue: "缺少中文全文檔" });
    continue;
  }
  const sourceParagraphs = paragraphs(article.textEn || "");
  if (value.translationVersion !== EXPECTED_VERSION) failures.push({ key, issue: "翻譯版本不符" });
  if (value.sourceHash !== article.sourceHash) failures.push({ key, issue: "英文原文指紋不符" });
  if (!Array.isArray(value.paragraphsZh) || value.paragraphsZh.length !== sourceParagraphs.length) {
    failures.push({ key, issue: `段落數 ${value.paragraphsZh?.length ?? 0}/${sourceParagraphs.length}` });
    continue;
  }
  for (const [index, textZhValue] of value.paragraphsZh.entries()) {
    const textZh = String(textZhValue || "").trim();
    const textEn = sourceParagraphs[index];
    if (!textZh) failures.push({ key, paragraph: index + 1, issue: "空白譯文" });
    if (/\d/u.test(textEn) && !/\d/u.test(textZh)) failures.push({ key, paragraph: index + 1, issue: "原文有數字，譯文沒有阿拉伯數字" });
    if (forbiddenPattern.test(textZh)) failures.push({ key, paragraph: index + 1, issue: "含禁用詞或翻譯說明" });
    if (redundantPattern.test(textZh)) warnings.push({ key, paragraph: index + 1, issue: "可能有重複動詞或贅語", textZh });
    const chineseCount = (textZh.match(/[\p{Script=Han}]/gu) || []).length;
    if (textEn.length > 120 && chineseCount < 18) warnings.push({ key, paragraph: index + 1, issue: "中文比例偏低，可能是作者署名或專有名詞密集段落", textZh });
    if (textZh.length < Math.min(40, Math.max(2, Math.round(textEn.length * 0.18)))) {
      failures.push({ key, paragraph: index + 1, issue: "譯文異常偏短" });
    }
  }
  records.push({
    key,
    titleEn: article.titleEn,
    sourceCharacters: article.textEn.length,
    paragraphCount: sourceParagraphs.length,
    path: path.slice(projectRoot.length + 1),
  });
}

const sample = [...records]
  .sort((a, b) => {
    const aHash = createHash("sha256").update(a.key).digest().readUInt32BE(0);
    const bHash = createHash("sha256").update(b.key).digest().readUInt32BE(0);
    return aHash - bHash;
  })
  .slice(0, 18);

const report = {
  version: EXPECTED_VERSION,
  auditedAt: new Date().toISOString(),
  databaseArticles: data.articles.length,
  validArticleFiles: records.length,
  failures,
  warnings,
  manualReviewSample: sample,
};
writeJsonAtomic(reportPath, report);
if (!failures.length) {
  writeJsonAtomic(manifestPath, {
    translationVersion: EXPECTED_VERSION,
    generatedAt: report.auditedAt,
    articleCount: records.length,
    paragraphCount: records.reduce((sum, record) => sum + record.paragraphCount, 0),
    issueCounts: Object.fromEntries(Object.entries(records.reduce((counts, record) => {
      const issueKey = record.key.split(":", 1)[0];
      counts[issueKey] = (counts[issueKey] || 0) + 1;
      return counts;
    }, {})).sort(([a], [b]) => b.localeCompare(a))),
  });
}

console.log(`中文全文稽核：${records.length}/${data.articles.length} 篇有檔案；${failures.length} 項失敗；${warnings.length} 項提醒。`);
console.log(`人工抽查樣本：${sample.length} 篇，清單已寫入 ${reportPath.slice(projectRoot.length + 1)}。`);
if (failures.length) process.exitCode = 1;
