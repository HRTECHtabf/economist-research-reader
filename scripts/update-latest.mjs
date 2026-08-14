import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const envPath = resolve(projectRoot, ".env.local");
const siteDataPath = resolve(projectRoot, "docs/data/articles.json");
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
const latestFolder = listing
  .filter((entry) => entry.type === "dir" && /^te_\d{4}\.\d{2}\.\d{2}$/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .at(-1);

if (!latestFolder) throw new Error("來源庫中找不到期數資料夾");

const currentData = existsSync(siteDataPath)
  ? JSON.parse(readFileSync(siteDataPath, "utf8"))
  : null;

if (!force && currentData?.issueFolder === latestFolder) {
  console.log(`目前已是最新一期：${latestFolder}`);
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

console.log(`偵測到新一期 ${latestFolder}，開始下載與處理。`);
const epubResponse = await fetch(rawUrl);
if (!epubResponse.ok) throw new Error(`EPUB 尚未可用（HTTP ${epubResponse.status}）`);
writeFileSync(temporaryEpub, Buffer.from(await epubResponse.arrayBuffer()));

execFileSync(process.execPath, [
  resolve(projectRoot, "scripts/parse-economist-epub.mjs"),
  temporaryEpub,
], { cwd: projectRoot, stdio: "inherit" });

execFileSync(process.execPath, [
  resolve(projectRoot, "scripts/generate-site-data.mjs"),
], { cwd: projectRoot, stdio: "inherit", env });

const updatedData = JSON.parse(readFileSync(siteDataPath, "utf8"));
if (
  updatedData.issueFolder !== latestFolder ||
  updatedData.summaryCount !== updatedData.articleCount
) {
  throw new Error("新一期資料未完整產生，保留既有發布版本");
}

console.log(`網站資料已更新至 ${latestFolder}。`);
