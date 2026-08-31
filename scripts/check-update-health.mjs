import {
  appendFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { translationCoverage } from "./lib/content-filter-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const dataPath = resolve(projectRoot, "docs/data/articles.json");
const manifestPath = resolve(projectRoot, "docs/data/fulltext/manifest.json");

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

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function githubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replaceAll("\n", " ")}\n`, "utf8");
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} 回傳 HTTP ${response.status}`);
  return response.json();
}

const env = {
  EBOOKS_REPO_OWNER: "hehonghui",
  EBOOKS_REPO_NAME: "awesome-english-ebooks",
  EBOOKS_REPO_BRANCH: "master",
  ECONOMIST_REPO_PATH: "01_economist",
  ...readEnv(resolve(projectRoot, ".env.local")),
  ...process.env,
};
const siteDataUrl = option("site-url", env.SITE_DATA_URL || "");
const localData = JSON.parse(readFileSync(dataPath, "utf8"));
const localManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const apiUrl = new URL(
  `https://api.github.com/repos/${env.EBOOKS_REPO_OWNER}/${env.EBOOKS_REPO_NAME}/contents/${env.ECONOMIST_REPO_PATH}`,
);
apiUrl.searchParams.set("ref", env.EBOOKS_REPO_BRANCH);
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "economist-research-reader-watchdog",
};
if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

const listing = await fetchJson(apiUrl, headers);
const latestEntry = listing
  .filter((entry) => entry.type === "dir" && /^te_\d{4}\.\d{2}\.\d{2}$/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name))
  .at(-1);
if (!latestEntry) throw new Error("來源庫中找不到任何 te_YYYY.MM.DD 期數");

const upstreamCurrent =
  localData.issueFolder === latestEntry.name &&
  localData.sourceFolderSha === latestEntry.sha;
const localArticleCount = localData.totalArticleCount ?? localData.articles?.length ?? 0;
const fullTextComplete =
  localManifest.translationVersion === "fulltext-zh-tw-v2" &&
  translationCoverage(localManifest) === localArticleCount;
const sourceCurrent = upstreamCurrent && fullTextComplete;

let siteData = null;
let siteManifest = null;
let siteCurrent = null;
let siteError = "";
if (siteDataUrl) {
  try {
    const url = new URL(siteDataUrl);
    url.searchParams.set("health", Date.now().toString());
    const manifestUrl = new URL("./fulltext/manifest.json", url);
    manifestUrl.searchParams.set("health", Date.now().toString());
    [siteData, siteManifest] = await Promise.all([
      fetchJson(url),
      fetchJson(manifestUrl),
    ]);
    siteCurrent =
      siteData.issueFolder === localData.issueFolder &&
      siteData.sourceFolderSha === localData.sourceFolderSha &&
      siteData.generatedAt === localData.generatedAt &&
      siteData.totalArticleCount === localData.totalArticleCount &&
      siteManifest.articleCount === localManifest.articleCount &&
      siteManifest.generatedAt === localManifest.generatedAt;
  } catch (error) {
    siteCurrent = false;
    siteError = error.message;
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  source: {
    current: sourceCurrent,
    upstreamCurrent,
    fullTextComplete,
    expectedIssueFolder: latestEntry.name,
    expectedSourceSha: latestEntry.sha,
    repositoryIssueFolder: localData.issueFolder || null,
    repositorySourceSha: localData.sourceFolderSha || null,
    repositoryArticleCount: localArticleCount,
    fullTextArticleCount: localManifest.articleCount ?? null,
    unavailableFullTextCount: localManifest.unavailableCount ?? 0,
  },
  site: siteDataUrl
    ? {
        current: siteCurrent,
        url: siteDataUrl,
        repositoryGeneratedAt: localData.generatedAt || null,
        publishedGeneratedAt: siteData?.generatedAt || null,
        repositoryArticleCount: localArticleCount,
        publishedArticleCount: siteData?.totalArticleCount ?? siteData?.articles?.length ?? null,
        repositoryFullTextCount: localManifest.articleCount ?? null,
        publishedFullTextCount: siteManifest?.articleCount ?? null,
        error: siteError || null,
      }
    : { checked: false },
};

githubOutput("source_current", sourceCurrent);
githubOutput("site_checked", Boolean(siteDataUrl));
githubOutput("site_current", siteCurrent === null ? "not_checked" : siteCurrent);
githubOutput("expected_issue", latestEntry.name.replace(/^te_/, ""));
githubOutput("repository_issue", String(localData.issueKey || "unknown"));
githubOutput("published_issue", String(siteData?.issueKey || "not_checked"));
githubOutput("health_summary", [
  `上游 ${latestEntry.name}`,
  `GitHub 資料 ${localData.issueFolder || "unknown"}`,
  `中文全文 ${localManifest.articleCount ?? 0} 篇、隔離 ${localManifest.unavailableCount ?? 0} 篇，共 ${translationCoverage(localManifest)}/${localArticleCount}`,
  siteDataUrl ? `公開網站 ${siteData?.issueFolder || "unavailable"}` : "公開網站未檢查",
].join("；"));

console.log(JSON.stringify(report, null, 2));
if (!sourceCurrent || siteCurrent === false) process.exitCode = 1;
