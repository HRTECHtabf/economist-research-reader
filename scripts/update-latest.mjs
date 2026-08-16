import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const envPath = resolve(projectRoot, ".env.local");
const siteDataPath = resolve(projectRoot, "docs/data/articles.json");
const rawArticlesPath = resolve(projectRoot, ".cache/articles.raw.json");
const force = process.argv.includes("--force");

function readEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const sourceLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt < 1) continue;
    values[line.slice(0, equalsAt).trim()] = line.slice(equalsAt + 1).trim();
  }
  return values;
}

function validateSiteData(data, expectedFolder, expectedSourceSha) {
  const failures = [];
  const keys = new Set();
  const currentIssueArticles = (data.articles || []).filter(
    (article) => article.issueKey === data.issueKey,
  );

  if (data.issueFolder !== expectedFolder) failures.push("期數資料不符");
  if (data.sourceFolderSha !== expectedSourceSha) failures.push("來源版本不符");
  if (currentIssueArticles.length !== data.articleCount) failures.push("本期文章數不符");
  if (currentIssueArticles.filter((article) => article.summaryZh).length !== data.summaryCount) {
    failures.push("本期摘要數不符");
  }

  for (const article of data.articles || []) {
    const key = `${article.issueKey}:${article.id}`;
    if (keys.has(key)) failures.push(`${article.titleEn}：文章鍵重複`);
    keys.add(key);
    if (!/^[a-f0-9]{64}$/.test(article.sourceHash || "")) {
      failures.push(`${article.titleEn}：缺少原文內容指紋`);
    }
    if (typeof article.textEn !== "string" || article.textEn.length <= 200) {
      failures.push(`${article.titleEn}：缺少英文全文`);
    }
    const terms = article.highlightTermsZh;
    if (!Array.isArray(terms) || terms.length > 3) {
      failures.push(`${article.titleEn}：摘要標示數量不正確`);
    } else if (terms.some((term) => !article.summaryZh?.includes(term))) {
      failures.push(`${article.titleEn}：摘要標示不在摘要內`);
    }
  }

  if (failures.length) {
    throw new Error(`網站資料驗證失敗：\n${failures.join("\n")}`);
  }
}

const env = {
  EBOOKS_REPO_OWNER: "hehonghui",
  EBOOKS_REPO_NAME: "awesome-english-ebooks",
  EBOOKS_REPO_BRANCH: "master",
  ECONOMIST_REPO_PATH: "01_economist",
  ...readEnv(envPath),
  ...process.env,
};

const apiUrl = new URL(
  `https://api.github.com/repos/${env.EBOOKS_REPO_OWNER}/${env.EBOOKS_REPO_NAME}/contents/${env.ECONOMIST_REPO_PATH}`,
);
apiUrl.searchParams.set("ref", env.EBOOKS_REPO_BRANCH);

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "economist-research-reader",
};
if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

const listingResponse = await fetch(apiUrl, { headers });
if (!listingResponse.ok) throw new Error(`無法取得來源目錄（HTTP ${listingResponse.status}）`);

const listing = await listingResponse.json();
const latestEntry = listing
  .filter((entry) => entry.type === "dir" && /^te_\d{4}\.\d{2}\.\d{2}$/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name))
  .at(-1);

if (!latestEntry) throw new Error("來源庫中找不到期數資料夾");
const latestFolder = latestEntry.name;

const currentData = existsSync(siteDataPath)
  ? JSON.parse(readFileSync(siteDataPath, "utf8"))
  : null;

if (
  !force &&
  currentData?.issueFolder === latestFolder &&
  currentData?.sourceFolderSha === latestEntry.sha
) {
  console.log(`目前已是最新一期：${latestFolder}`);
  process.exit(0);
}

if (!force && currentData?.issueFolder === latestFolder && !currentData?.sourceFolderSha) {
  currentData.sourceFolderSha = latestEntry.sha;
  writeFileSync(siteDataPath, `${JSON.stringify(currentData, null, 2)}\n`, "utf8");
  console.log(`已記錄目前期數的來源版本：${latestFolder}`);
  process.exit(0);
}

const issueKey = latestFolder.replace(/^te_/, "");
const epubName = `TheEconomist.${issueKey}.epub`;
const rawUrl = [
  "https://raw.githubusercontent.com",
  env.EBOOKS_REPO_OWNER,
  env.EBOOKS_REPO_NAME,
  env.EBOOKS_REPO_BRANCH,
  env.ECONOMIST_REPO_PATH,
  latestFolder,
  epubName,
].join("/");
const temporaryEpub = resolve(tmpdir(), `${Date.now()}-${basename(epubName)}`);

const changeLabel = currentData?.issueFolder === latestFolder ? "同一期有新增或異動" : "偵測到新一期";
console.log(`${changeLabel} ${latestFolder}，開始下載與處理。`);
const epubResponse = await fetch(rawUrl);
if (!epubResponse.ok) throw new Error(`EPUB 尚未可用（HTTP ${epubResponse.status}）`);
writeFileSync(temporaryEpub, Buffer.from(await epubResponse.arrayBuffer()));

execFileSync(process.execPath, [
  resolve(projectRoot, "scripts/parse-economist-epub.mjs"),
  temporaryEpub,
], { cwd: projectRoot, stdio: "inherit" });

const rawArticles = JSON.parse(readFileSync(rawArticlesPath, "utf8"));
rawArticles.sourceFolderSha = latestEntry.sha;
writeFileSync(rawArticlesPath, `${JSON.stringify(rawArticles, null, 2)}\n`, "utf8");

execFileSync(process.execPath, [
  resolve(projectRoot, "scripts/generate-site-data.mjs"),
], { cwd: projectRoot, stdio: "inherit", env });

const updatedData = JSON.parse(readFileSync(siteDataPath, "utf8"));
validateSiteData(updatedData, latestFolder, latestEntry.sha);

console.log(`網站資料已更新至 ${latestFolder}。`);
