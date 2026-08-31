import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizePublicFailureMessage } from "./lib/article-failure-policy.mjs";
import {
  mergeMaintenanceHistory,
  workflowRunIdentity,
} from "./lib/maintenance-history.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const statusPath = resolve(projectRoot, "docs/data/maintenance-status.json");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
const identity = workflowRunIdentity();
if (!identity) throw new Error("缺少 GITHUB_RUN_ID，無法保存防呆紀錄");

const healthOutcome = process.env.HEALTH_OUTCOME || "unknown";
const sourceCurrent = process.env.SOURCE_CURRENT === "true";
const siteCurrent = process.env.SITE_CURRENT === "true";
const outcome = healthOutcome === "success" ? "success" : "failure";
const cause = outcome === "success"
  ? "上游、GitHub 資料、全文覆蓋率與公開網站一致"
  : !sourceCurrent
    ? "上游已有更新，但 GitHub 資料或全文覆蓋率仍落後"
    : !siteCurrent
      ? "GitHub 資料已更新，但公開網站尚未同步"
      : "防呆核對失敗，原因尚未分類";
const detail = sanitizePublicFailureMessage(
  process.env.HEALTH_SUMMARY || "防呆工作沒有提供比對摘要",
);
const record = {
  ...identity,
  workflow: "watchdog",
  recordedAt: new Date().toISOString(),
  outcome,
  issueKey: status.issueKey || null,
  systemicFailure: false,
  stages: { 防呆核對: healthOutcome },
  skippedArticleCount: 0,
  failedArticleCount: outcome === "failure" ? 1 : 0,
  diagnosis: outcome === "failure"
    ? { category: "watchdog_sync", cause }
    : null,
  detail,
  incidents: [],
};

const next = {
  ...status,
  version: 2,
  history: mergeMaintenanceHistory([record], status.history || []),
};
const temporaryPath = `${statusPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
renameSync(temporaryPath, statusPath);
console.log(`${outcome === "failure" ? "已保存防呆失敗原因" : "已保存防呆成功紀錄"}：${cause}`);
