const els = {
  articleCount: document.querySelector("#article-count"),
  translationCount: document.querySelector("#translation-count"),
  translationDetail: document.querySelector("#translation-detail"),
  latestIssue: document.querySelector("#latest-issue"),
  latestIssueCount: document.querySelector("#latest-issue-count"),
  generatedAt: document.querySelector("#generated-at"),
  sourceSyncCard: document.querySelector("#source-sync-card"),
  sourceSync: document.querySelector("#source-sync"),
  sourceSyncDetail: document.querySelector("#source-sync-detail"),
  siteSyncCard: document.querySelector("#site-sync-card"),
  siteSync: document.querySelector("#site-sync"),
  siteSyncDetail: document.querySelector("#site-sync-detail"),
  workflowOverall: document.querySelector("#workflow-overall"),
  runList: document.querySelector("#run-list"),
  maintenanceOverall: document.querySelector("#maintenance-overall"),
  maintenanceSummary: document.querySelector("#maintenance-summary"),
  maintenanceAction: document.querySelector("#maintenance-action"),
  incidentList: document.querySelector("#incident-list"),
};

const repository = "HRTECHtabf/economist-research-reader";
const workflows = [
  { file: "weekly-update.yml", label: "每週更新" },
  { file: "update-watchdog.yml", label: "每日防呆" },
];

function formatDate(value, includeTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

async function loadContentStatus() {
  const [articlesResponse, manifestResponse] = await Promise.all([
    fetch("../data/articles.json", { cache: "no-store" }),
    fetch("../data/fulltext/manifest.json", { cache: "no-store" }),
  ]);
  if (!articlesResponse.ok) throw new Error("文章資料無法載入");
  const data = await articlesResponse.json();
  const manifest = manifestResponse.ok ? await manifestResponse.json() : null;
  const latestIssue = data.issueKey || [...new Set(data.articles.map((article) => article.issueKey))].sort().at(-1);
  const latestCount = data.articles.filter((article) => article.issueKey === latestIssue).length;
  els.articleCount.textContent = data.articles.length.toLocaleString("zh-TW");
  const unavailableCount = manifest?.unavailableCount || 0;
  const coveredCount = manifest ? manifest.articleCount + unavailableCount : 0;
  els.translationCount.textContent = manifest ? `${coveredCount}/${data.articles.length}` : "產製中";
  els.translationDetail.textContent = manifest
    ? `${manifest.articleCount} 篇繁中全文；${unavailableCount} 篇隔離`
    : "尚未完成全庫稽核";
  els.latestIssue.textContent = latestIssue || "—";
  els.latestIssueCount.textContent = `${latestCount} 篇文章；${data.summaryCount ?? latestCount} 篇摘要；${data.summaryUnavailableCount || 0} 篇隔離`;
  els.generatedAt.textContent = manifest ? formatDate(manifest.generatedAt) : "—";
  await loadSyncStatus(data, manifest);
}

function updateSyncCard(card, valueElement, detailElement, { status, value, detail }) {
  card.classList.remove("ok", "warning");
  if (status) card.classList.add(status);
  valueElement.textContent = value;
  detailElement.textContent = detail;
}

async function loadSyncStatus(publishedData, publishedManifest) {
  try {
    const cacheKey = Date.now();
    const [repositoryResponse, repositoryManifestResponse, sourceResponse] = await Promise.all([
      fetch(`https://raw.githubusercontent.com/${repository}/main/docs/data/articles.json?health=${cacheKey}`, { cache: "no-store" }),
      fetch(`https://raw.githubusercontent.com/${repository}/main/docs/data/fulltext/manifest.json?health=${cacheKey}`, { cache: "no-store" }),
      fetch("https://api.github.com/repos/hehonghui/awesome-english-ebooks/contents/01_economist?ref=master", {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
      }),
    ]);
    if (!repositoryResponse.ok || !repositoryManifestResponse.ok || !sourceResponse.ok) throw new Error("公開狀態來源暫時無法讀取");
    const repositoryData = await repositoryResponse.json();
    const repositoryManifest = await repositoryManifestResponse.json();
    const sourceEntries = await sourceResponse.json();
    const latestSource = sourceEntries
      .filter((entry) => entry.type === "dir" && /^te_\d{4}\.\d{2}\.\d{2}$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .at(-1);
    if (!latestSource) throw new Error("上游找不到有效期數");

    const sourceCurrent =
      repositoryData.issueFolder === latestSource.name &&
      repositoryData.sourceFolderSha === latestSource.sha &&
      repositoryManifest.articleCount + (repositoryManifest.unavailableCount || 0) === repositoryData.totalArticleCount;
    updateSyncCard(els.sourceSyncCard, els.sourceSync, els.sourceSyncDetail, sourceCurrent
      ? { status: "ok", value: "正常", detail: `${latestSource.name.replace(/^te_/, "")}；${repositoryManifest.articleCount} 篇全文、${repositoryManifest.unavailableCount || 0} 篇隔離` }
      : { status: "warning", value: "待補抓", detail: `上游 ${latestSource.name.replace(/^te_/, "")}；GitHub ${repositoryData.issueKey || "未知"}；覆蓋 ${repositoryManifest.articleCount + (repositoryManifest.unavailableCount || 0)}/${repositoryData.totalArticleCount || 0}` });

    const siteCurrent =
      publishedData.issueFolder === repositoryData.issueFolder &&
      publishedData.sourceFolderSha === repositoryData.sourceFolderSha &&
      publishedData.generatedAt === repositoryData.generatedAt &&
      publishedManifest?.generatedAt === repositoryManifest.generatedAt;
    updateSyncCard(els.siteSyncCard, els.siteSync, els.siteSyncDetail, siteCurrent
      ? { status: "ok", value: "已同步", detail: `${publishedData.issueKey} 公開版本與 GitHub 一致` }
      : { status: "warning", value: "待發布", detail: `GitHub ${repositoryData.issueKey || "未知"}；網站 ${publishedData.issueKey || "未知"}` });
  } catch (error) {
    updateSyncCard(els.sourceSyncCard, els.sourceSync, els.sourceSyncDetail, {
      status: "",
      value: "無法確認",
      detail: error.message,
    });
    updateSyncCard(els.siteSyncCard, els.siteSync, els.siteSyncDetail, {
      status: "",
      value: "無法確認",
      detail: error.message,
    });
  }
}

async function loadMaintenanceStatus() {
  const response = await fetch("../data/maintenance-status.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`維運狀態 HTTP ${response.status}`);
  const status = await response.json();
  const labels = {
    success: "本次正常",
    warning: "有文章隔離",
    failure: "系統性故障",
  };
  els.maintenanceOverall.textContent = labels[status.outcome] || "狀態未知";
  els.maintenanceOverall.className = `status-pill ${status.outcome === "failure" ? "failed" : status.outcome}`;
  els.maintenanceSummary.textContent = status.diagnosis?.cause
    || `單篇最多 ${status.policy?.maxAttemptsPerArticle || 3} 次；本次沒有待處理異常。`;
  els.maintenanceAction.textContent = status.diagnosis
    ? `系統處理：${status.diagnosis.automaticAction} 你可檢查：${status.diagnosis.userAction}`
    : `超過 ${status.policy?.maxSkippedArticles || 10} 篇才會停止發布並進入系統性排查。`;
  els.incidentList.replaceChildren();
  for (const incident of status.incidents || []) {
    const row = document.createElement("article");
    row.className = `incident-row ${incident.status}`;
    const heading = document.createElement("strong");
    heading.textContent = `${incident.title}｜${incident.stage}`;
    const meta = document.createElement("span");
    const attemptLabel = incident.category === "content_filter"
      ? "安全攔截後直接隔離"
      : `嘗試 ${incident.attempts} 次`;
    meta.textContent = `${incident.status === "skipped" ? "已隔離" : "系統性故障"}・${attemptLabel}・${incident.cause}`;
    const reason = document.createElement("p");
    reason.textContent = incident.message;
    row.append(heading, meta, reason);
    els.incidentList.append(row);
  }
  if (!(status.incidents || []).length) els.incidentList.textContent = "本次沒有失敗或隔離文章。";
}

async function loadWorkflowRuns() {
  const results = await Promise.all(workflows.map(async (workflow) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow.file}/runs?per_page=8`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const data = await response.json();
    return { ...workflow, runs: data.workflow_runs || [] };
  }));
  const runs = results
    .flatMap((workflow) => workflow.runs.map((run) => ({ ...run, workflowLabel: workflow.label })))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 12);
  els.runList.replaceChildren();
  const latestStatuses = results
    .map((workflow) => workflow.runs[0])
    .filter(Boolean)
    .map((run) => run.status === "completed" ? run.conclusion : run.status);
  const overallStatus = latestStatuses.includes("failure")
    ? "failure"
    : latestStatuses.some((status) => status !== "success")
      ? "in_progress"
      : "success";
  els.workflowOverall.textContent = overallStatus === "success" ? "運作正常" : overallStatus === "failure" ? "最近有失敗" : "執行中／未知";
  els.workflowOverall.className = `status-pill ${overallStatus === "failure" ? "failed" : overallStatus}`;
  for (const run of runs) {
    const row = document.createElement("div");
    row.className = "run-row";
    const dot = document.createElement("span");
    dot.className = `run-dot ${run.conclusion || run.status}`;
    const link = document.createElement("a");
    link.href = run.html_url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${run.workflowLabel}｜${run.display_title || run.name}`;
    const time = document.createElement("time");
    time.dateTime = run.created_at;
    time.textContent = formatDate(run.created_at, true);
    row.append(dot, link, time);
    els.runList.append(row);
  }
  if (!runs.length) els.runList.textContent = "尚無執行紀錄。";
}

loadContentStatus().catch((error) => {
  els.translationCount.textContent = "無法載入";
  els.translationDetail.textContent = error.message;
});
loadWorkflowRuns().catch((error) => {
  els.workflowOverall.textContent = "無法連線";
  els.workflowOverall.className = "status-pill failed";
  els.runList.textContent = `GitHub 執行紀錄暫時無法取得：${error.message}`;
});
loadMaintenanceStatus().catch((error) => {
  els.maintenanceOverall.textContent = "無法載入";
  els.maintenanceOverall.className = "status-pill failed";
  els.maintenanceSummary.textContent = error.message;
  els.maintenanceAction.textContent = "請查看最近一次 GitHub Actions 執行紀錄。";
});
