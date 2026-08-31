import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const dataRoot = resolve(projectRoot, "docs/data");
const sourcePath = resolve(dataRoot, "articles.json");
const catalogPath = resolve(dataRoot, "catalog.json");
const outputPath = resolve(dataRoot, "storage-status.json");
const MIB = 1024 * 1024;

function directoryBytes(path) {
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = resolve(path, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(child) : statSync(child).size);
  }, 0);
}

function githubOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
}

const sourceBytes = statSync(sourcePath).size;
const catalogBytes = statSync(catalogPath).size;
const publicDataBytes = directoryBytes(dataRoot);
const sourceMiB = sourceBytes / MIB;
const publicDataMiB = publicDataBytes / MIB;
const level = sourceMiB >= 90 || publicDataMiB >= 900
  ? "critical"
  : sourceMiB >= 40 || publicDataMiB >= 750
    ? "warning"
    : "ok";
const recommendations = [];
if (sourceMiB >= 25) recommendations.push("主資料已超過 25 MiB，應完成按期資料遷移並停止提交單一大檔。");
if (publicDataMiB >= 600) recommendations.push("公開資料已超過 600 MiB，應評估物件儲存或 CDN。");

const statusContent = {
  version: 1,
  level,
  limitsMiB: { sourceWarning: 40, sourceCritical: 90, publicWarning: 750, publicCritical: 900 },
  sizes: {
    sourceMiB: Number(sourceMiB.toFixed(2)),
    catalogMiB: Number((catalogBytes / MIB).toFixed(2)),
    publicDataMiB: Number(publicDataMiB.toFixed(2)),
  },
  recommendations,
};
const existing = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : null;
const existingContent = existing && { ...existing };
if (existingContent) delete existingContent.checkedAt;
const status = JSON.stringify(existingContent) === JSON.stringify(statusContent)
  ? existing
  : { ...statusContent, checkedAt: new Date().toISOString() };
if (status !== existing) writeFileSync(outputPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
githubOutput("storage_level", level);
githubOutput("source_mib", status.sizes.sourceMiB);
githubOutput("public_data_mib", status.sizes.publicDataMiB);
console.log(`儲存空間：主資料 ${status.sizes.sourceMiB} MiB；公開資料 ${status.sizes.publicDataMiB} MiB；狀態 ${level}。`);
if (level === "critical") process.exitCode = 1;
