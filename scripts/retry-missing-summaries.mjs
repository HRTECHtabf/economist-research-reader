import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 重新補做中文摘要被隔離的文章：逐期下載並解析電子書，再交給 generate-site-data。
// generate-site-data 會沿用已發布、原文未變的導讀，所以只有缺摘要的文章會呼叫 Azure。
// 最後一定再處理一次網站目前的最新一期，讓網站頂層期數與更新檢查點維持原狀。
const projectRoot = resolve(import.meta.dirname, "..");
const siteDataPath = resolve(projectRoot, "docs/data/articles.json");
const issueCacheRoot = resolve(projectRoot, ".cache/issues");
const includeFiltered = process.argv.includes("--include-filtered");
const dryRun = process.argv.includes("--dry-run");

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

const env = {
  EBOOKS_REPO_OWNER: "hehonghui",
  EBOOKS_REPO_NAME: "awesome-english-ebooks",
  EBOOKS_REPO_BRANCH: "master",
  ECONOMIST_REPO_PATH: "01_economist",
  ...readEnv(resolve(projectRoot, ".env.local")),
  ...process.env,
};

function missingSummaries(data) {
  return (data.articles || []).filter((article) => {
    if (article.summaryZh) return false;
    // 被內容安全篩選擋下的摘要重送通常仍會被擋；明確要求時才重試。
    return includeFiltered || article.summaryUnavailable?.reason !== "azure_content_filter";
  });
}

const data = JSON.parse(readFileSync(siteDataPath, "utf8"));
const before = missingSummaries(data);
const missingByIssue = new Map();
for (const article of before) {
  missingByIssue.set(article.issueKey, (missingByIssue.get(article.issueKey) || 0) + 1);
}
if (!missingByIssue.size) {
  console.log("沒有需要重試的中文摘要。");
  process.exit(0);
}
const latestFolder = data.issueFolder;
console.log(`待補摘要 ${before.length} 篇：${[...missingByIssue].map(([issue, count]) => `${issue}（${count}）`).join("、")}`);

const headers = { Accept: "application/vnd.github+json", "User-Agent": "economist-research-reader" };
if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
const apiUrl = new URL(`https://api.github.com/repos/${env.EBOOKS_REPO_OWNER}/${env.EBOOKS_REPO_NAME}/contents/${env.ECONOMIST_REPO_PATH}`);
apiUrl.searchParams.set("ref", env.EBOOKS_REPO_BRANCH);
const listingResponse = await fetch(apiUrl, { headers });
if (!listingResponse.ok) throw new Error(`無法取得來源目錄（HTTP ${listingResponse.status}）`);
const entries = new Map((await listingResponse.json())
  .filter((entry) => entry.type === "dir" && /^te_\d{4}\.\d{2}\.\d{2}$/.test(entry.name))
  .map((entry) => [entry.name, entry]));

const folders = [...missingByIssue.keys()].map((issueKey) => `te_${issueKey}`).filter((folder) => folder !== latestFolder).sort();
folders.push(latestFolder);
for (const folder of folders) {
  if (!entries.has(folder)) throw new Error(`來源庫找不到 ${folder}，無法重試這期的摘要`);
}
// 網路請求之後不呼叫 process.exit：Windows 上的 Node 會在關閉連線時觸發 libuv 斷言。
if (dryRun) console.log(`[試跑] 依序處理：${folders.join(" → ")}`);
else await retryIssues();

async function retryIssues() {
mkdirSync(issueCacheRoot, { recursive: true });
async function prepareRawIssue(entry) {
  const issueKey = entry.name.replace(/^te_/, "");
  const epubName = `TheEconomist.${issueKey}.epub`;
  const epubPath = resolve(issueCacheRoot, epubName);
  const rawPath = resolve(issueCacheRoot, `${entry.name}.raw.json`);
  if (!existsSync(epubPath)) {
    const rawUrl = ["https://raw.githubusercontent.com", env.EBOOKS_REPO_OWNER, env.EBOOKS_REPO_NAME, env.EBOOKS_REPO_BRANCH, env.ECONOMIST_REPO_PATH, entry.name, epubName].join("/");
    const response = await fetch(rawUrl);
    if (!response.ok) throw new Error(`${entry.name} EPUB 下載失敗（HTTP ${response.status}）`);
    writeFileSync(epubPath, Buffer.from(await response.arrayBuffer()));
  }
  execFileSync(process.execPath, [resolve(projectRoot, "scripts/parse-economist-epub.mjs"), epubPath, rawPath], { cwd: projectRoot, stdio: "inherit" });
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));
  raw.sourceFolderSha = entry.sha;
  writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return rawPath;
}

for (const folder of folders) {
  console.log(`[重試摘要] ${folder}${folder === latestFolder ? "（最新一期，最後處理以維持網站頂層狀態）" : ""}`);
  const rawPath = await prepareRawIssue(entries.get(folder));
  execFileSync(process.execPath, [resolve(projectRoot, "scripts/generate-site-data.mjs"), rawPath, siteDataPath], { cwd: projectRoot, stdio: "inherit", env });
}

const after = JSON.parse(readFileSync(siteDataPath, "utf8"));
if (after.issueFolder !== latestFolder) throw new Error(`網站頂層期數變成 ${after.issueFolder}，應維持 ${latestFolder}`);
const remaining = missingSummaries(after);
console.log(`中文摘要重試完成：補上 ${before.length - remaining.length} 篇，仍缺 ${remaining.length} 篇。`);
}
