const els = {
  articleCount: document.querySelector("#article-count"),
  translationCount: document.querySelector("#translation-count"),
  translationDetail: document.querySelector("#translation-detail"),
  latestIssue: document.querySelector("#latest-issue"),
  latestIssueCount: document.querySelector("#latest-issue-count"),
  generatedAt: document.querySelector("#generated-at"),
  workflowOverall: document.querySelector("#workflow-overall"),
  runList: document.querySelector("#run-list"),
};

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
  els.translationCount.textContent = manifest ? `${manifest.articleCount}/${data.articles.length}` : "產製中";
  els.translationDetail.textContent = manifest ? `${manifest.paragraphCount.toLocaleString("zh-TW")} 個段落` : "尚未完成全庫稽核";
  els.latestIssue.textContent = latestIssue || "—";
  els.latestIssueCount.textContent = `${latestCount} 篇文章`;
  els.generatedAt.textContent = manifest ? formatDate(manifest.generatedAt) : "—";
}

async function loadWorkflowRuns() {
  const response = await fetch("https://api.github.com/repos/HRTECHtabf/economist-research-reader/actions/workflows/weekly-update.yml/runs?per_page=8", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const data = await response.json();
  const runs = data.workflow_runs || [];
  els.runList.replaceChildren();
  const latest = runs[0];
  const latestStatus = latest?.status === "completed" ? latest.conclusion : latest?.status;
  els.workflowOverall.textContent = latestStatus === "success" ? "最近成功" : latestStatus === "failure" ? "最近失敗" : "執行中／未知";
  els.workflowOverall.className = `status-pill ${latestStatus || ""}`;
  for (const run of runs) {
    const row = document.createElement("div");
    row.className = "run-row";
    const dot = document.createElement("span");
    dot.className = `run-dot ${run.conclusion || run.status}`;
    const link = document.createElement("a");
    link.href = run.html_url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = run.display_title || run.name;
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
