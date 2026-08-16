import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const envPath = resolve(projectRoot, ".env.local");
const siteDataPath = resolve(projectRoot, "docs/data/articles.json");
const issueCacheRoot = resolve(projectRoot, ".cache/issues");
const requestedCount = Number(
  process.argv.find((argument) => argument.startsWith("--issues="))?.split("=")[1] || 3,
);
const requestedStart = process.argv
  .find((argument) => argument.startsWith("--start="))
  ?.split("=")[1];

if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 52) {
  throw new Error("--issues 必須是 1–52 的整數");
}

function readEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const sourceLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt < 1) continue;
    let value = line.slice(equalsAt + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    values[line.slice(0, equalsAt).trim()] = value;
  }
  return values;
}

const env = {
  EBOOKS_REPO_OWNER: "hehonghui",
  EBOOKS_REPO_NAME: "awesome-english-ebooks",
  EBOOKS_REPO_BRANCH: "master",
  ECONOMIST_REPO_PATH: "01_economist",
  ...readEnv(envPath),
  ...process.env,
};

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "economist-research-reader",
};
if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

const apiUrl = new URL(
  `https://api.github.com/repos/${env.EBOOKS_REPO_OWNER}/${env.EBOOKS_REPO_NAME}/contents/${env.ECONOMIST_REPO_PATH}`,
);
apiUrl.searchParams.set("ref", env.EBOOKS_REPO_BRANCH);
const listingResponse = await fetch(apiUrl, { headers });
if (!listingResponse.ok) throw new Error(`無法取得來源目錄（HTTP ${listingResponse.status}）`);

const availableIssues = (await listingResponse.json())
  .filter((entry) => entry.type === "dir" && /^te_\d{4}\.\d{2}\.\d{2}$/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name));
const startIndex = requestedStart
  ? availableIssues.findIndex((entry) => entry.name === `te_${requestedStart}`)
  : Math.max(0, availableIssues.length - requestedCount);
if (startIndex < 0) throw new Error(`來源庫找不到起始期數 ${requestedStart}`);
const selectedIssues = availableIssues.slice(startIndex, startIndex + requestedCount);
if (selectedIssues.length !== requestedCount) {
  throw new Error(`來源庫只有 ${selectedIssues.length} 個可用期數，少於要求的 ${requestedCount} 期`);
}
const latestIssue = availableIssues.at(-1);

mkdirSync(issueCacheRoot, { recursive: true });
const existingData = existsSync(siteDataPath)
  ? JSON.parse(readFileSync(siteDataPath, "utf8"))
  : { articles: [] };
const completeIssueKeys = new Set();
const issueStats = new Map();
for (const article of existingData.articles || []) {
  const issueKey = article.issueKey || existingData.issueKey;
  const stats = issueStats.get(issueKey) || { total: 0, withSummary: 0, withEnglish: 0 };
  stats.total += 1;
  if (article.summaryZh) stats.withSummary += 1;
  if (typeof article.textEn === "string" && article.textEn.length > 200) stats.withEnglish += 1;
  issueStats.set(issueKey, stats);
}
for (const [issueKey, stats] of issueStats) {
  if (stats.total > 0 && stats.withSummary === stats.total && stats.withEnglish === stats.total) {
    completeIssueKeys.add(issueKey);
  }
}

async function prepareRawIssue(entry) {
  const issueKey = entry.name.replace(/^te_/, "");
  const epubName = `TheEconomist.${issueKey}.epub`;
  const epubPath = resolve(issueCacheRoot, epubName);
  const rawPath = resolve(issueCacheRoot, `${entry.name}.raw.json`);
  if (!existsSync(rawPath)) {
    if (!existsSync(epubPath)) {
      const rawUrl = [
        "https://raw.githubusercontent.com",
        env.EBOOKS_REPO_OWNER,
        env.EBOOKS_REPO_NAME,
        env.EBOOKS_REPO_BRANCH,
        env.ECONOMIST_REPO_PATH,
        entry.name,
        epubName,
      ].join("/");
      console.log(`[下載] ${entry.name}`);
      const response = await fetch(rawUrl);
      if (!response.ok) throw new Error(`${entry.name} EPUB 下載失敗（HTTP ${response.status}）`);
      writeFileSync(epubPath, Buffer.from(await response.arrayBuffer()));
    }
    execFileSync(process.execPath, [
      resolve(projectRoot, "scripts/parse-economist-epub.mjs"),
      epubPath,
      rawPath,
    ], { cwd: projectRoot, stdio: "inherit" });
  }
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));
  raw.sourceFolderSha = entry.sha;
  writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return rawPath;
}

async function processIssue(entry, { force = false } = {}) {
  const issueKey = entry.name.replace(/^te_/, "");
  if (!force && completeIssueKeys.has(issueKey)) {
    console.log(`[略過] ${entry.name} 已有完整中英文內容`);
    return;
  }
  const rawPath = await prepareRawIssue(entry);
  console.log(`[摘要] ${entry.name}`);
  execFileSync(process.execPath, [
    resolve(projectRoot, "scripts/generate-site-data.mjs"),
    rawPath,
    siteDataPath,
  ], { cwd: projectRoot, stdio: "inherit", env });
}

console.log(`準備回補 ${selectedIssues[0].name} 至 ${selectedIssues.at(-1).name}，共 ${selectedIssues.length} 期。`);
for (const entry of selectedIssues) await processIssue(entry);

// 最後再處理來源庫最新一期，確保網站頂層期數與更新檢查點都停在最新資料。
await processIssue(latestIssue, { force: true });

const finalData = JSON.parse(readFileSync(siteDataPath, "utf8"));
const selectedKeys = new Set(selectedIssues.map((entry) => entry.name.replace(/^te_/, "")));
const finalArticles = (finalData.articles || []).filter((article) => selectedKeys.has(article.issueKey));
const finalIssueCount = new Set(finalArticles.map((article) => article.issueKey)).size;
const missingEnglish = finalArticles.filter(
  (article) => typeof article.textEn !== "string" || article.textEn.length <= 200,
);
const missingSummaries = finalArticles.filter((article) => !article.summaryZh);
if (
  finalIssueCount !== requestedCount ||
  missingEnglish.length ||
  missingSummaries.length ||
  finalData.issueKey !== latestIssue.name.replace(/^te_/, "")
) {
  throw new Error(
    `回補驗證失敗：期數 ${finalIssueCount}/${requestedCount}、缺英文 ${missingEnglish.length}、缺摘要 ${missingSummaries.length}`,
  );
}
console.log(`回補完成：${finalIssueCount} 期、${finalArticles.length} 篇中英文內容。`);
