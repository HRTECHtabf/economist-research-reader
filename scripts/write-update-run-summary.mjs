import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnoseUpdateFailure } from "./lib/update-failure-diagnosis.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (!summaryPath) process.exit(0);

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
  console.error(
    `::error title=${workflowCommandEscape(title)}::${workflowCommandEscape(message)}`,
  );
};
const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const lines = ["## Economist 更新執行摘要", ""];
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
  const diagnosis = diagnoseUpdateFailure(failedLogTexts.join("\n"));
  lines.push(
    "",
    "### 自動診斷",
    "",
    `- 判定：${diagnosis.cause}`,
    `- 處理：${diagnosis.action}`,
  );
  emitErrorAnnotation(
    `Economist 更新失敗：${diagnosis.cause}`,
    diagnosis.action,
  );
}

const reportPath = resolve(projectRoot, ".cache/summary-generation.report.json");
if (existsSync(reportPath)) {
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const failures = Object.values(report.stages || {}).flatMap((stage) =>
      (stage.failures || []).map((failure) => ({ stage: stage.label, ...failure })),
    );
    if (failures.length) {
      lines.push("", "### 尚未通過的文章", "");
      for (const failure of failures) {
        lines.push(`- ${failure.stage}｜${failure.titleEn || failure.key}：${failure.message}`);
        emitErrorAnnotation(
          `${failure.stage}未通過：${failure.titleEn || failure.key}`,
          failure.message,
        );
      }
    }
  } catch (error) {
    lines.push("", `摘要錯誤報告無法讀取：${error.message}`);
  }
}

const fulltextReportPath = resolve(projectRoot, ".cache/fulltext-zh-v2.report.json");
if (existsSync(fulltextReportPath)) {
  try {
    const report = JSON.parse(readFileSync(fulltextReportPath, "utf8"));
    if (report.failed?.length) {
      const dataPath = resolve(projectRoot, "docs/data/articles.json");
      const articles = existsSync(dataPath)
        ? JSON.parse(readFileSync(dataPath, "utf8")).articles || []
        : [];
      const titleByKey = new Map(
        articles.map((article) => [`${article.issueKey}:${article.id}`, article.titleEn]),
      );
      lines.push("", "### 尚未通過的全文", "");
      for (const failure of report.failed) {
        const title = titleByKey.get(failure.key) || failure.key;
        lines.push(`- ${title}：${failure.message}`);
        emitErrorAnnotation(`全文未通過：${title}`, failure.message);
      }
    }
  } catch (error) {
    lines.push("", `全文翻譯錯誤報告無法讀取：${error.message}`);
  }
}

appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
