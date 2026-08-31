import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { diagnoseUpdateFailure } from "./lib/update-failure-diagnosis.mjs";
import {
  MAX_ARTICLE_ATTEMPTS,
  MAX_SKIPPED_ARTICLES,
  sanitizePublicFailureMessage,
} from "./lib/article-failure-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const maintenanceStatusPath = resolve(projectRoot, "docs/data/maintenance-status.json");
const steps = [
  { label: "期數偵測與摘要", outcome: process.env.PROCESS_OUTCOME, log: ".cache/update-latest.log" },
  { label: "繁中全文翻譯", outcome: process.env.TRANSLATE_OUTCOME, log: ".cache/translate-fulltext.log" },
  { label: "全文稽核", outcome: process.env.AUDIT_OUTCOME, log: ".cache/audit-fulltext.log" },
];
const labels = {
  success: "成功",
  failure: "失敗",
  skipped: "略過",
  cancelled: "取消",
};
const workflowCommandEscape = (value) => String(value)
  .replaceAll("%", "%25")
  .replaceAll("\r", "%0D")
  .replaceAll("\n", "%0A");
const emitErrorAnnotation = (title, message) => {
  console.error(`::error title=${workflowCommandEscape(title)}::${workflowCommandEscape(message)}`);
};
const emitWarningAnnotation = (title, message) => {
  console.warn(`::warning title=${workflowCommandEscape(title)}::${workflowCommandEscape(message)}`);
};
const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const lines = ["## Economist 更新執行摘要", ""];
const incidents = [];
let runDiagnosis = null;
let issueKey = null;
let systemicFailure = false;

for (const step of steps) {
  const outcome = step.outcome || "unknown";
  lines.push(`- ${step.label}：${labels[outcome] || outcome}`);
}

const failedLogTexts = [];
for (const step of steps.filter(({ outcome }) => outcome === "failure")) {
  const path = resolve(projectRoot, step.log);
  if (!existsSync(path)) continue;
  const tail = readFileSync(path, "utf8").trim().split(/\r?\n/).slice(-80).join("\n");
  failedLogTexts.push(tail);
  lines.push(
    "",
    `<details><summary>${step.label}最後 80 行</summary>`,
    "<pre>",
    escapeHtml(tail),
    "</pre>",
    "</details>",
  );
}

if (failedLogTexts.length) {
  runDiagnosis = diagnoseUpdateFailure(failedLogTexts.join("\n"));
  lines.push(
    "",
    "### 自動診斷",
    "",
    `- 判定：${runDiagnosis.cause}`,
    `- 自動處理：${runDiagnosis.automaticAction || runDiagnosis.action}`,
    `- 需要人工檢查：${runDiagnosis.userAction || "查看 GitHub Actions 註解。"}`,
  );
  emitErrorAnnotation(`Economist 更新失敗：${runDiagnosis.cause}`, runDiagnosis.action);
}

const summaryReportPath = resolve(projectRoot, ".cache/summary-generation.report.json");
if (existsSync(summaryReportPath)) {
  try {
    const report = JSON.parse(readFileSync(summaryReportPath, "utf8"));
    issueKey = report.issueKey || issueKey;
    systemicFailure ||= Boolean(report.systemicFailure);
    const failures = Object.values(report.stages || {}).flatMap((stage) => [
      ...(stage.failures || []).map((failure) => ({ status: "systemic_failure", stage: stage.label, ...failure })),
      ...(stage.skipped || []).map((failure) => ({ status: "skipped", stage: stage.label, ...failure })),
    ]);
    if (failures.length) lines.push("", "### 摘要處理異常", "");
    for (const failure of failures) {
      const message = sanitizePublicFailureMessage(failure.message);
      const diagnosis = diagnoseUpdateFailure(message);
      const title = failure.titleEn || failure.key;
      incidents.push({
        scope: "summary",
        stage: failure.stage,
        status: failure.status,
        key: failure.key,
        title,
        attempts: failure.attempts || MAX_ARTICLE_ATTEMPTS,
        category: failure.reason === "azure_content_filter" ? "content_filter" : diagnosis.kind,
        cause: failure.reason === "azure_content_filter" ? "文章觸發 Azure 內容安全篩選" : diagnosis.cause,
        message,
      });
      lines.push(`- ${failure.status === "skipped" ? "已隔離" : "系統性故障"}｜${failure.stage}｜${title}：${message}`);
      if (failure.status === "skipped") emitWarningAnnotation(`${failure.stage}已隔離：${title}`, message);
      else emitErrorAnnotation(`${failure.stage}未通過：${title}`, message);
    }
  } catch (error) {
    lines.push("", `摘要錯誤報告無法讀取：${error.message}`);
  }
}

const fulltextReportPath = resolve(projectRoot, ".cache/fulltext-zh-v2.report.json");
if (existsSync(fulltextReportPath)) {
  try {
    const report = JSON.parse(readFileSync(fulltextReportPath, "utf8"));
    systemicFailure ||= Boolean(report.systemicFailure);
    const dataPath = resolve(projectRoot, "docs/data/articles.json");
    const articles = existsSync(dataPath)
      ? JSON.parse(readFileSync(dataPath, "utf8")).articles || []
      : [];
    const titleByKey = new Map(
      articles.map((article) => [`${article.issueKey}:${article.id}`, article.titleEn]),
    );
    if (report.failed?.length) lines.push("", "### 尚未通過的全文", "");
    for (const failure of report.failed || []) {
      const title = titleByKey.get(failure.key) || failure.key;
      const message = sanitizePublicFailureMessage(failure.message);
      const diagnosis = diagnoseUpdateFailure(message);
      incidents.push({
        scope: "fulltext",
        stage: "繁中全文",
        status: "systemic_failure",
        key: failure.key,
        title,
        attempts: failure.attempts || MAX_ARTICLE_ATTEMPTS,
        category: diagnosis.kind,
        cause: diagnosis.cause,
        message,
      });
      lines.push(`- ${title}：${message}`);
      emitErrorAnnotation(`全文未通過：${title}`, message);
    }
    if (report.quarantined?.length) lines.push("", "### 已隔離的全文", "");
    for (const item of report.quarantined || []) {
      const title = titleByKey.get(item.key) || item.key;
      const message = sanitizePublicFailureMessage(item.message);
      const diagnosis = diagnoseUpdateFailure(message);
      const filtered = item.reason === "azure_content_filter";
      incidents.push({
        scope: "fulltext",
        stage: "繁中全文",
        status: "skipped",
        key: item.key,
        title,
        attempts: item.attempts || MAX_ARTICLE_ATTEMPTS,
        category: filtered ? "content_filter" : diagnosis.kind,
        cause: filtered ? "文章觸發 Azure 內容安全篩選" : diagnosis.cause,
        message,
      });
      lines.push(`- ${title}：保留摘要與英文原文，繁中全文暫不可用。`);
      emitWarningAnnotation(`全文已隔離：${title}`, "文章與英文原文仍會發布，詳細原因已寫入維運頁。");
    }
  } catch (error) {
    lines.push("", `全文翻譯錯誤報告無法讀取：${error.message}`);
  }
}

const publishedDataPath = resolve(projectRoot, "docs/data/articles.json");
if (existsSync(publishedDataPath)) {
  const data = JSON.parse(readFileSync(publishedDataPath, "utf8"));
  issueKey ||= data.issueKey || null;
  const incidentKeys = new Set(incidents.map((item) => `${item.scope}:${item.key}`));
  for (const article of data.articles || []) {
    const key = `${article.issueKey}:${article.id}`;
    if (article.summaryUnavailable && !incidentKeys.has(`summary:${article.id}`)) {
      const message = sanitizePublicFailureMessage(article.summaryUnavailable.message);
      const diagnosis = diagnoseUpdateFailure(message);
      incidents.push({
        scope: "summary",
        stage: "初稿",
        status: "skipped",
        key: article.id,
        title: article.titleEn,
        attempts: article.summaryUnavailable.attempts || MAX_ARTICLE_ATTEMPTS,
        category: diagnosis.kind,
        cause: diagnosis.cause,
        message,
      });
    }
    if (incidentKeys.has(`fulltext:${key}`)) continue;
    const fulltextPath = resolve(projectRoot, "docs/data/fulltext", article.issueKey, `${article.id}.json`);
    if (!existsSync(fulltextPath)) continue;
    const fulltext = JSON.parse(readFileSync(fulltextPath, "utf8"));
    if (fulltext.unavailable !== true) continue;
    const filtered = fulltext.unavailableReason === "azure_content_filter";
    incidents.push({
      scope: "fulltext",
      stage: "繁中全文",
      status: "skipped",
      key,
      title: article.titleEn,
      attempts: filtered ? 1 : MAX_ARTICLE_ATTEMPTS,
      category: filtered ? "content_filter" : "fulltext_validation",
      cause: filtered ? "文章觸發 Azure 內容安全篩選" : "繁中全文連續 3 次仍未通過",
      message: fulltext.unavailableDetailZh
        || fulltext.unavailableMessageZh
        || "繁中全文暫不可用，請先閱讀英文原文。",
    });
  }
}

if (!runDiagnosis && incidents.length) {
  runDiagnosis = diagnoseUpdateFailure(incidents.map(({ message }) => message).join("\n"));
}
const failedStages = steps.filter(({ outcome }) => outcome === "failure");
const outcome = failedStages.length || systemicFailure
  ? "failure"
  : incidents.length
    ? "warning"
    : "success";
const maintenanceStatus = {
  version: 1,
  outcome,
  issueKey,
  systemicFailure,
  policy: {
    maxAttemptsPerArticle: MAX_ARTICLE_ATTEMPTS,
    maxSkippedArticles: MAX_SKIPPED_ARTICLES,
    systemicFailureStartsAt: MAX_SKIPPED_ARTICLES + 1,
  },
  stages: Object.fromEntries(steps.map((step) => [step.label, step.outcome || "unknown"])),
  skippedArticleCount: incidents.filter(({ status }) => status === "skipped").length,
  failedArticleCount: incidents.filter(({ status }) => status === "systemic_failure").length,
  diagnosis: runDiagnosis
    ? {
        category: runDiagnosis.kind,
        cause: runDiagnosis.cause,
        automaticAction: runDiagnosis.automaticAction || runDiagnosis.action,
        userAction: runDiagnosis.userAction || "查看 GitHub Actions 註解。",
      }
    : null,
  incidents,
};

const existingStatus = existsSync(maintenanceStatusPath)
  ? JSON.parse(readFileSync(maintenanceStatusPath, "utf8"))
  : null;
const existingComparable = existingStatus && { ...existingStatus, updatedAt: undefined };
const nextComparable = { ...maintenanceStatus, updatedAt: undefined };
if (JSON.stringify(existingComparable) !== JSON.stringify(nextComparable)) {
  mkdirSync(dirname(maintenanceStatusPath), { recursive: true });
  const temporaryPath = `${maintenanceStatusPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({
    ...maintenanceStatus,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, maintenanceStatusPath);
}

if (summaryPath) appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
