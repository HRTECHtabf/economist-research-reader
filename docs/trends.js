const params = new URLSearchParams(location.search);
const SVG_NS = "http://www.w3.org/2000/svg";
const PLAYBACK_DELAY = 2000;
const PINCH_ZOOM_SENSITIVITY = 1.8;
const GRAPH_WIDTH = 1000;
// 畫布寬固定 1000 單位，高度依外框比例調整，讓關聯圖填滿外框而不是兩側留空。
let GRAPH_HEIGHT = 560;
const RELATED_ARTICLES_PREVIEW_LIMIT = 8;
// 節點大小依文章篇數，但最大與最小只差約 1.25 倍；確切篇數看球上的數字。
const NODE_MIN_RADIUS = 30;
const NODE_MAX_RADIUS = 37;
const NODE_COMPOUND_RADIUS = 33;
// 預設視角把整張圖放進這個區域（上方留給說明與縮放鈕，下方留給圖例）。
function networkFitArea() {
  return { left: 40, right: GRAPH_WIDTH - 40, top: 62, bottom: GRAPH_HEIGHT - 90 };
}

function measureGraphHeight() {
  const { clientWidth, clientHeight } = els.relationshipNetwork;
  if (!clientWidth || !clientHeight) return GRAPH_HEIGHT;
  return Math.round(Math.max(480, Math.min(1100, (GRAPH_WIDTH * clientHeight) / clientWidth)));
}
const NETWORK_LABEL_SPACE = 26;
const NETWORK_MAX_SPREAD = 2.4;
// 預設視角最多放大 1.15 倍，各種檢視下球的大小才會一致。
const NETWORK_MAX_FIT_ZOOM = 1.15;
const COMMUNITY_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const TOUR_STEPS = [
  {
    selector: '[data-tour="all-tags"]',
    title: "先從全部 tag 找主題",
    description: "可切換每期、每月或全部資料後搜尋 tag。這裡的範圍改變時，下方關聯圖與共同文章也會一起更新。",
  },
  {
    selector: '[data-tour="relationship-range"]',
    title: "決定關聯分析的時間範圍",
    description: "關聯圖可分別查看全部資料、單一月份或單一期數。切換範圍後，節點、連線與右側排名都會重新計算。",
  },
  {
    selector: '[data-tour="relationship-network"]',
    title: "旋轉並辨認關聯網絡",
    description: "按住空白處拖曳可旋轉視角；電腦可用滾輪，手機可用雙指縮放，也可使用右上角按鈕。滑到圓球上會顯示 tag 名稱、文章篇數與所屬社群；點一下圓球就會列出對應的文章。圓球顏色是依當下連線密度自動分群，不是固定的主題分類。",
  },
  {
    selector: '[data-tour="relationship-ranking"]',
    title: "用分數比較共同出現強度",
    description: "右側分數衡量兩個 tag 是否比隨機預期更常出現在同一篇文章，並對少量樣本保守降權。分數不是因果關係，也不等於文章重要性。",
  },
  {
    selector: '[data-tour="related-articles"]',
    title: "直接查看共同文章",
    description: "選滿兩個 tag 後，這裡會列出同時包含兩者的文章、摘要與期數。文章較多時可直接在原頁展開全部結果。",
  },
  {
    selector: '[data-tour="cloud"]',
    title: "從熱門 tag 雲看主題分布",
    description: "越常出現的 tag 字體越大、越靠近中心；顏色比較前一期或前一月的文章占比。這裡也能獨立選擇全部、每月或每期。",
  },
  {
    selector: '[data-tour="top-tags"]',
    title: "逐期或逐月比較熱門 tag",
    description: "排行可切換每期或每月，並依序播放各個時間範圍。也可用前後按鈕或選單自行查看；手動選擇後會暫停，方便比較名次升降。",
  },
];
const requestedIssue = params.get("issue") || "";
const requestedTopPeriod = params.get("top") || requestedIssue;
const requestedTopScope = params.get("topView") || "issue";
const requestedRelationshipIssue = params.get("network") || "";
const requestedRelationshipScope = params.get("networkView") || "issue";
const requestedOverviewIssue = params.get("overview") || "";
const requestedOverviewScope = params.get("overviewView") || "issue";
const requestedCloudIssue = params.get("cloud") || "";
const requestedCloudScope = params.get("cloudView") || "issue";

const state = {
  data: null,
  issue: requestedTopPeriod,
  topScope: ["month", "issue"].includes(requestedTopScope) ? requestedTopScope : "issue",
  autoPlay: !requestedTopPeriod,
  playbackTimer: null,
  networkFrame: null,
  relationshipIssue: requestedRelationshipIssue,
  relationshipScope: ["all", "month", "issue"].includes(requestedRelationshipScope) ? requestedRelationshipScope : "issue",
  relationshipRenderKey: "",
  overviewIssue: requestedOverviewIssue,
  overviewScope: ["all", "month", "issue"].includes(requestedOverviewScope) ? requestedOverviewScope : "issue",
  cloudIssue: requestedCloudIssue,
  cloudScope: ["all", "month", "issue"].includes(requestedCloudScope) ? requestedCloudScope : "issue",
  months: [],
  legacyFrom: params.get("from") || "",
  legacyTo: params.get("to") || "",
  selectedTags: [...new Set(params.getAll("tag").map((tag) => tag.trim()).filter(Boolean))].slice(0, 2),
  issues: [],
  allTags: [],
  overviewQuery: "",
  overviewSort: "count",
  cloudFrame: null,
};

const els = {
  issuePicker: document.querySelector("#issue-picker"),
  playbackToggle: document.querySelector("#playback-toggle"),
  topPrevious: document.querySelector("#top-previous"),
  topNext: document.querySelector("#top-next"),
  playbackStatus: document.querySelector("#playback-status"),
  playbackProgress: document.querySelector("#playback-progress"),
  currentPeriodTitle: document.querySelector("#current-period-title"),
  currentPeriodRange: document.querySelector("#current-period-range"),
  topScope: document.querySelector("#top-scope"),
  topPeriodLabel: document.querySelector("#top-period-label"),
  topPeriod: document.querySelector("#top-period"),
  selectedTagList: document.querySelector("#selected-tag-list"),
  clearFocus: document.querySelector("#clear-focus"),
  overviewSearch: document.querySelector("#tag-overview-search"),
  overviewSort: document.querySelector("#tag-overview-sort"),
  overviewCount: document.querySelector("#tag-overview-count"),
  overviewGrid: document.querySelector("#tag-overview-grid"),
  overviewScope: document.querySelector("#overview-scope"),
  overviewPeriodLabel: document.querySelector("#overview-period-label"),
  overviewIssue: document.querySelector("#overview-issue"),
  signalCards: document.querySelector("#signal-cards"),
  relationshipTitle: document.querySelector("#relationship-title"),
  relationshipDescription: document.querySelector("#relationship-description"),
  analysisMode: document.querySelector("#analysis-mode"),
  rankingTitle: document.querySelector("#ranking-title"),
  relationshipNetwork: document.querySelector("#relationship-network"),
  relationshipList: document.querySelector("#relationship-list"),
  relationshipHelp: document.querySelector("#relationship-help"),
  relationshipScope: document.querySelector("#relationship-scope"),
  relationshipPeriodLabel: document.querySelector("#relationship-period-label"),
  relationshipIssue: document.querySelector("#relationship-issue"),
  relatedArticlesTitle: document.querySelector("#related-articles-title"),
  relatedArticlesDescription: document.querySelector("#related-articles-description"),
  relatedArticlesList: document.querySelector("#related-articles-list"),
  relatedArticlesActions: document.querySelector("#related-articles-actions"),
  keywordCloud: document.querySelector("#keyword-cloud"),
  cloudHelp: document.querySelector("#cloud-help"),
  trendFlatLabel: document.querySelector("#trend-flat-label"),
  cloudComparisonStatus: document.querySelector("#cloud-comparison-status"),
  cloudScope: document.querySelector("#cloud-scope"),
  cloudPeriodLabel: document.querySelector("#cloud-period-label"),
  cloudIssue: document.querySelector("#cloud-issue"),
  topTagsHelp: document.querySelector("#top-tags-help"),
  topTagsIssue: document.querySelector("#top-tags-issue"),
  topTagsRanking: document.querySelector("#top-tags-ranking"),
  tooltip: document.querySelector("#tag-tooltip"),
  calculationTooltip: document.querySelector("#calculation-tooltip"),
  tourLaunch: document.querySelector("#tour-launch"),
  featureTour: document.querySelector("#feature-tour"),
  tourSpotlight: document.querySelector("#tour-spotlight"),
  tourPanel: document.querySelector("#tour-panel"),
  tourProgress: document.querySelector("#tour-progress"),
  tourTitle: document.querySelector("#tour-title"),
  tourDescription: document.querySelector("#tour-description"),
  tourPrevious: document.querySelector("#tour-previous"),
  tourNext: document.querySelector("#tour-next"),
  tourClose: document.querySelector("#tour-close"),
};

let tourStepIndex = -1;

function positionCalculationTooltip(button) {
  const margin = 12;
  const anchor = button.getBoundingClientRect();
  const tooltip = els.calculationTooltip;
  const rect = tooltip.getBoundingClientRect();
  const left = Math.max(margin, Math.min(innerWidth - rect.width - margin, anchor.left + anchor.width / 2 - rect.width / 2));
  const below = anchor.bottom + 9;
  const top = below + rect.height <= innerHeight - margin ? below : Math.max(margin, anchor.top - rect.height - 9);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showCalculationHelp(button) {
  els.calculationTooltip.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = button.dataset.helpTitle;
  const body = document.createElement("span");
  body.textContent = button.dataset.helpBody;
  els.calculationTooltip.append(title, body);
  els.calculationTooltip.hidden = false;
  requestAnimationFrame(() => positionCalculationTooltip(button));
}

function hideCalculationHelp() {
  els.calculationTooltip.hidden = true;
}

function createCalculationHelp(title, body) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "calculation-help";
  button.textContent = "?";
  button.dataset.helpTitle = title;
  button.dataset.helpBody = body;
  button.setAttribute("aria-label", `${title}：${body}`);
  button.setAttribute("aria-describedby", "calculation-tooltip");
  button.addEventListener("pointerenter", () => showCalculationHelp(button));
  button.addEventListener("pointerleave", () => { if (document.activeElement !== button) hideCalculationHelp(); });
  button.addEventListener("focus", () => showCalculationHelp(button));
  button.addEventListener("blur", hideCalculationHelp);
  button.addEventListener("click", (event) => { event.stopPropagation(); showCalculationHelp(button); });
  button.addEventListener("keydown", (event) => { if (event.key === "Escape") button.blur(); });
  return button;
}

function renderStaticCalculationHelp() {
  els.relationshipHelp.replaceChildren(createCalculationHelp(
    "關聯強度怎麼算？",
    "先用 NPMI 比較兩個 tag 實際共同出現的比例，是否高於各自出現頻率所推算的隨機預期；再依共同文章數折減小樣本，最後轉成 0–100。黑色節點代表同時含有兩個已選 tag 的共同文章。分數不是機率、重要性或因果關係。",
  ));
  els.cloudHelp.replaceChildren(createCalculationHelp(
    "關鍵字雲怎麼算？",
    "每篇文章的同一個 tag 只算一次。字體大小依涵蓋該 tag 的文章數做平方根縮放，出現愈多就愈靠近中心；顏色比較文章占比，不直接比較篇數，因此不同資料量的期數仍可公平比較。全部資料沒有單一前期，因此不計升降。",
  ));
  els.topTagsHelp.replaceChildren(createCalculationHelp(
    "熱門 tag 怎麼排？",
    "依目前選擇的期數或月份分開計算：先統計每個 tag 出現於多少篇文章，再依篇數列出前十五名；同一篇文章中的重複 tag 只算一次。百分比是含有該 tag 的文章占該期或該月全部文章的比例。",
  ));
}

function positionTourStep() {
  if (tourStepIndex < 0 || els.featureTour.hidden) return;
  const target = document.querySelector(TOUR_STEPS[tourStepIndex].selector);
  if (!target) return;
  const padding = 7;
  const rect = target.getBoundingClientRect();
  const left = Math.max(padding, rect.left - padding);
  const top = Math.max(padding, rect.top - padding);
  const right = Math.min(innerWidth - padding, rect.right + padding);
  const bottom = Math.min(innerHeight - padding, rect.bottom + padding);
  Object.assign(els.tourSpotlight.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.max(12, right - left)}px`,
    height: `${Math.max(12, bottom - top)}px`,
  });
  if (innerWidth <= 560) return;
  const panelWidth = els.tourPanel.offsetWidth;
  const panelHeight = els.tourPanel.offsetHeight;
  const gap = 18;
  let panelLeft = Math.max(12, Math.min(innerWidth - panelWidth - 12, left));
  let panelTop = bottom + gap;
  if (panelTop + panelHeight > innerHeight - 12) panelTop = top - panelHeight - gap;
  if (panelTop < 12) {
    panelTop = Math.max(12, Math.min(innerHeight - panelHeight - 12, top));
    panelLeft = right + gap;
    if (panelLeft + panelWidth > innerWidth - 12) panelLeft = left - panelWidth - gap;
    panelLeft = Math.max(12, Math.min(innerWidth - panelWidth - 12, panelLeft));
  }
  els.tourPanel.style.left = `${panelLeft}px`;
  els.tourPanel.style.top = `${panelTop}px`;
}

function showTourStep(index) {
  const boundedIndex = Math.max(0, Math.min(TOUR_STEPS.length - 1, index));
  const step = TOUR_STEPS[boundedIndex];
  const target = document.querySelector(step.selector);
  if (!target) return;
  tourStepIndex = boundedIndex;
  els.featureTour.hidden = false;
  document.body.classList.add("tour-open");
  els.tourProgress.textContent = `趨勢導覽 ${boundedIndex + 1} / ${TOUR_STEPS.length}`;
  els.tourTitle.textContent = step.title;
  els.tourDescription.textContent = step.description;
  els.tourPrevious.disabled = boundedIndex === 0;
  els.tourNext.textContent = boundedIndex === TOUR_STEPS.length - 1 ? "完成" : "下一步 →";
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  requestAnimationFrame(() => {
    positionTourStep();
    [120, 260, 480, 760].forEach((delay) => setTimeout(positionTourStep, delay));
    els.tourNext.focus({ preventScroll: true });
  });
}

function closeFeatureTour() {
  tourStepIndex = -1;
  els.featureTour.hidden = true;
  document.body.classList.remove("tour-open");
  els.tourLaunch.focus({ preventScroll: true });
}

function issueDate(article) {
  return article.issueKey || state.data?.issueKey || "";
}

function displayDate(value) {
  const match = value.match(/^(\d{4})[.-](\d{2})(?:[.-](\d{2}))?$/);
  if (!match) return value || "—";
  return match[3]
    ? `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`
    : `${Number(match[1])} 年 ${Number(match[2])} 月`;
}

function dateFromIssue(value) {
  return new Date(`${value.replaceAll(".", "-")}T00:00:00Z`);
}

function shortDate(date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function publishedDate(value) {
  const match = (value || "").match(/^([A-Z][a-z]{2})\s+(\d{1,2})(?:st|nd|rd|th)\s+(\d{4})$/);
  if (!match) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]);
  return month < 0 ? null : new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
}

function issueCoverage(value) {
  const dates = (state.data?.articles || [])
    .filter((article) => issueDate(article) === value)
    .map((article) => publishedDate(article.publishedEn))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (dates.length) return { start: dates[0], end: dates.at(-1) };
  const end = dateFromIssue(value);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start, end };
}

function issueRange(value, includeYear = false) {
  const { start, end } = issueCoverage(value);
  const range = `${shortDate(start)}–${shortDate(end)}`;
  return includeYear ? `${end.getUTCFullYear()} 年 ${range}` : range;
}

function issueTitle(value) {
  const date = dateFromIssue(value);
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日號`;
}

function articlesInWindow(issue = state.issue) {
  return issue ? state.data.articles.filter((article) => issueDate(article) === issue) : state.data.articles;
}

function periodKey(article) {
  return issueDate(article);
}

function periodsFor(articles) {
  return [...new Set(articles.map(periodKey).filter(Boolean))].sort();
}

function trendFor(values) {
  if (values.length < 2) return { delta: 0, percent: 0, recent: values[0] || 0, previous: 0 };
  const midpoint = Math.ceil(values.length / 2);
  const average = (items) => items.reduce((sum, value) => sum + value, 0) / Math.max(1, items.length);
  const previous = average(values.slice(0, midpoint));
  const recent = average(values.slice(midpoint));
  const delta = recent - previous;
  return { delta, percent: previous ? (delta / previous) * 100 : recent ? Infinity : 0, recent, previous };
}

function tagStatistics(articles, periods, includeAll = false, comparisonIssue = state.issue) {
  const stats = new Map();
  const totals = new Map(periods.map((period) => [period, 0]));
  for (const article of articles) totals.set(periodKey(article), (totals.get(periodKey(article)) || 0) + 1);
  if (includeAll) {
    for (const tag of state.allTags) stats.set(tag, { tag, count: 0, latest: "", values: new Map(periods.map((period) => [period, 0])) });
  }
  for (const article of articles) {
    const period = periodKey(article);
    for (const tag of new Set(article.keywordsZh || [])) {
      if (!stats.has(tag)) stats.set(tag, { tag, count: 0, latest: "", values: new Map(periods.map((key) => [key, 0])) });
      const item = stats.get(tag);
      item.count += 1;
      item.latest = item.latest > issueDate(article) ? item.latest : issueDate(article);
      item.values.set(period, (item.values.get(period) || 0) + 1);
    }
  }
  for (const item of stats.values()) {
    item.series = periods.map((period) => item.values.get(period) || 0);
    item.rateSeries = periods.map((period, index) => {
      const total = totals.get(period) || 0;
      return total ? (item.series[index] / total) * 100 : 0;
    });
    item.trend = trendFor(item.rateSeries.slice(-2));
    if (comparisonIssue) {
      const issueIndex = state.issues.indexOf(comparisonIssue);
      const previousIssue = issueIndex > 0 ? state.issues[issueIndex - 1] : "";
      const currentArticles = state.data.articles.filter((article) => issueDate(article) === comparisonIssue);
      const previousArticles = previousIssue ? state.data.articles.filter((article) => issueDate(article) === previousIssue) : [];
      const currentRate = currentArticles.length ? (countContaining(currentArticles, [item.tag]) / currentArticles.length) * 100 : 0;
      const previousRate = previousArticles.length ? (countContaining(previousArticles, [item.tag]) / previousArticles.length) * 100 : 0;
      item.trend = previousIssue ? trendFor([previousRate, currentRate]) : { delta: 0, percent: 0, recent: currentRate, previous: 0 };
      item.previousIssue = previousIssue;
    }
  }
  return [...stats.values()];
}

function directionFor(trend) {
  if (trend.delta > 0.24) return "up";
  if (trend.delta < -0.24) return "down";
  return "flat";
}

function trendLevel(trend) {
  if (trend.percent === Infinity || trend.percent >= 80) return 3;
  if (trend.percent >= 30) return 2;
  if (trend.percent >= 10) return 1;
  if (trend.percent <= -60) return -3;
  if (trend.percent <= -30) return -2;
  if (trend.percent <= -10) return -1;
  return 0;
}

function trendText(trend) {
  if (trend.percent === Infinity) return "近期新出現";
  if (Math.abs(trend.percent) < 1) return "持平";
  return `${trend.percent > 0 ? "+" : ""}${Math.round(trend.percent)}%`;
}

function trendTextForSelection(trend, issue = state.issue) {
  const keys = topKeys();
  return issue === keys[0] ? `無前${state.topScope === "month" ? "月" : "期"}資料` : trendText(trend);
}

function countContaining(articles, tags) {
  return articles.reduce((count, article) => count + (tags.every((tag) => (article.keywordsZh || []).includes(tag)) ? 1 : 0), 0);
}

function associationStrength(total, countA, countB, cooccurrence) {
  if (!total || !countA || !countB || !cooccurrence) return { score: 0, npmi: -1 };
  const pA = countA / total;
  const pB = countB / total;
  const pAB = cooccurrence / total;
  const denominator = -Math.log(pAB);
  const npmi = denominator ? Math.log(pAB / (pA * pB)) / denominator : 1;
  const shrinkage = cooccurrence / (cooccurrence + 3);
  const score = Math.round(100 * Math.sqrt(Math.max(0, npmi) * shrinkage));
  return { score: Math.min(100, score), npmi };
}

function globalRelationships(articles) {
  const total = articles.length;
  const counts = new Map(state.allTags.map((tag) => [tag, 0]));
  const pairCounts = new Map();
  for (const article of articles) {
    const tags = [...new Set(article.keywordsZh || [])].sort();
    for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    for (let first = 0; first < tags.length; first += 1) {
      for (let second = first + 1; second < tags.length; second += 1) {
        const key = `${tags[first]}\u0000${tags[second]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }
  return [...pairCounts.entries()].map(([key, support]) => {
    const tags = key.split("\u0000");
    const association = associationStrength(total, counts.get(tags[0]), counts.get(tags[1]), support);
    return { tags, target: tags[1], support, ...association, lowSample: support < 4 };
  }).filter((item) => item.support >= 3 && item.score > 0)
    .sort((a, b) => b.score - a.score || b.support - a.support || a.tags.join("").localeCompare(b.tags.join(""), "zh-Hant"));
}

function singleTagRelationships(articles, focusTag) {
  const total = articles.length;
  const focusCount = countContaining(articles, [focusTag]);
  return state.allTags.filter((tag) => tag !== focusTag).map((tag) => {
    const tagCount = countContaining(articles, [tag]);
    const support = countContaining(articles, [focusTag, tag]);
    const association = associationStrength(total, focusCount, tagCount, support);
    return { tags: [focusTag, tag], target: tag, support, ...association, lowSample: support < 4 };
  }).filter((item) => item.support >= 2 && item.score > 0)
    .sort((a, b) => b.score - a.score || b.support - a.support || a.target.localeCompare(b.target, "zh-Hant"));
}

function compoundRelationships(articles, selectedTags) {
  const total = articles.length;
  const pairCount = countContaining(articles, selectedTags);
  return state.allTags.filter((tag) => !selectedTags.includes(tag)).map((tag) => {
    const tagCount = countContaining(articles, [tag]);
    const support = countContaining(articles, [...selectedTags, tag]);
    const association = associationStrength(total, pairCount, tagCount, support);
    return { tags: [...selectedTags, tag], target: tag, support, pairCount, ...association, lowSample: support < 4 };
  }).filter((item) => item.support >= 1 && item.score > 0)
    .sort((a, b) => b.score - a.score || b.support - a.support || a.target.localeCompare(b.target, "zh-Hant"));
}

function relationshipsFor(articles) {
  if (!state.selectedTags.length) return globalRelationships(articles);
  if (state.selectedTags.length === 1) return singleTagRelationships(articles, state.selectedTags[0]);
  return compoundRelationships(articles, state.selectedTags);
}

function syncUrl() {
  const next = new URLSearchParams();
  if (state.topScope !== "issue") next.set("topView", state.topScope);
  if (!state.autoPlay && state.issue) next.set("top", state.issue);
  if (state.relationshipScope !== "issue") next.set("networkView", state.relationshipScope);
  if (state.relationshipScope === "month" && state.relationshipIssue) next.set("network", state.relationshipIssue);
  if (state.relationshipScope === "issue" && state.relationshipIssue && state.relationshipIssue !== state.issues.at(-1)) next.set("network", state.relationshipIssue);
  if (state.overviewScope !== "issue") next.set("overviewView", state.overviewScope);
  if (state.overviewScope === "month" && state.overviewIssue) next.set("overview", state.overviewIssue);
  if (state.overviewScope === "issue" && state.overviewIssue && state.overviewIssue !== state.issues.at(-1)) next.set("overview", state.overviewIssue);
  if (state.cloudScope !== "issue") next.set("cloudView", state.cloudScope);
  if (state.cloudScope === "month" && state.cloudIssue) next.set("cloud", state.cloudIssue);
  if (state.cloudScope === "issue" && state.cloudIssue && state.cloudIssue !== state.issues.at(-1)) next.set("cloud", state.cloudIssue);
  for (const tag of state.selectedTags) next.append("tag", tag);
  const query = next.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

function toggleFocusTag(tag) {
  if (!state.allTags.includes(tag)) return;
  if (state.selectedTags.includes(tag)) state.selectedTags = state.selectedTags.filter((item) => item !== tag);
  else if (state.selectedTags.length < 2) state.selectedTags = [...state.selectedTags, tag];
  else state.selectedTags = [tag];
  renderAll();
}

function clearPlaybackTimer() {
  if (state.playbackTimer) clearTimeout(state.playbackTimer);
  state.playbackTimer = null;
  els.playbackProgress.classList.remove("running");
}

function restartPlaybackProgress() {
  els.playbackProgress.classList.remove("running");
  void els.playbackProgress.offsetWidth;
  els.playbackProgress.classList.add("running");
}

function renderPlaybackState() {
  const keys = topKeys();
  const index = Math.max(0, keys.indexOf(state.issue));
  const nextKey = keys[(index + 1) % Math.max(1, keys.length)] || state.issue;
  const unit = state.topScope === "month" ? "月" : "期";
  els.playbackToggle.textContent = state.autoPlay ? "暫停" : "播放";
  els.playbackToggle.setAttribute("aria-pressed", String(state.autoPlay));
  els.playbackStatus.textContent = state.autoPlay
    ? `下一${unit} ${topPeriodTitle(nextKey)}`
    : `已停在 ${topPeriodTitle(state.issue)}`;
  els.currentPeriodTitle.textContent = `第 ${index + 1} / ${keys.length} 個範圍 · ${topPeriodTitle(state.issue)}`;
  if (state.topScope === "month") {
    const issueCount = state.issues.filter((issue) => issue.startsWith(`${state.issue}.`)).length;
    els.currentPeriodRange.textContent = `本月涵蓋 ${issueCount} 期、${articlesForScope("month", state.issue).length} 篇文章`;
  } else els.currentPeriodRange.textContent = `本期文章日期 ${issueRange(state.issue, true)}`;
  els.topPrevious.textContent = `← 上一${unit}`;
  els.topNext.textContent = `下一${unit} →`;
  if (!state.autoPlay) els.playbackProgress.classList.remove("running");
}

function schedulePlayback() {
  const keys = topKeys();
  clearPlaybackTimer();
  if (!state.autoPlay || document.hidden || keys.length < 2) return;
  restartPlaybackProgress();
  state.playbackTimer = setTimeout(() => {
    const currentIndex = Math.max(0, keys.indexOf(state.issue));
    state.issue = keys[(currentIndex + 1) % keys.length];
    renderTopModule();
    schedulePlayback();
  }, PLAYBACK_DELAY);
}

function startPlayback() {
  state.autoPlay = true;
  renderTopModule();
  schedulePlayback();
}

function pauseAtIssue(issue) {
  state.autoPlay = false;
  state.issue = issue;
  clearPlaybackTimer();
  renderTopModule();
}

function stepTopIssue(direction) {
  const keys = topKeys();
  const currentIndex = Math.max(0, keys.indexOf(state.issue));
  state.autoPlay = false;
  state.issue = keys[(currentIndex + direction + keys.length) % keys.length];
  clearPlaybackTimer();
  renderTopModule();
}

function renderIssuePicker() {
  els.issuePicker.replaceChildren();
  const keys = topKeys();
  els.issuePicker.setAttribute("aria-label", `選擇熱門 tag ${state.topScope === "month" ? "月份" : "期數"}`);
  keys.forEach((issue) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "issue-choice";
    button.classList.toggle("selected", state.issue === issue);
    button.classList.toggle("auto-frame", state.autoPlay && state.issue === issue);
    button.setAttribute("aria-pressed", String(state.issue === issue));
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    title.textContent = topPeriodTitle(issue);
    if (state.topScope === "month") {
      const issueCount = state.issues.filter((item) => item.startsWith(`${issue}.`)).length;
      meta.textContent = `${issueCount} 期｜${articlesForScope("month", issue).length} 篇`;
    } else meta.textContent = `${issueRange(issue)}｜${articlesForScope("issue", issue).length} 篇`;
    button.append(title, meta);
    button.addEventListener("click", () => pauseAtIssue(issue));
    els.issuePicker.append(button);
  });
  requestAnimationFrame(() => {
    const activeButton = els.issuePicker.querySelector(".issue-choice.selected");
    if (activeButton) {
      els.issuePicker.scrollLeft = Math.max(0, activeButton.offsetLeft - (els.issuePicker.clientWidth - activeButton.offsetWidth) / 2);
    }
  });
}

function fillIssueSelect(select, selected) {
  select.replaceChildren();
  [...state.issues].reverse().forEach((issue) => {
    const option = document.createElement("option");
    option.value = issue;
    option.textContent = `${issueTitle(issue)}｜${issueRange(issue, true)}`;
    option.selected = issue === selected;
    select.append(option);
  });
}

function monthTitle(value) {
  const [year, month] = value.split(".").map(Number);
  return `${year} 年 ${month} 月`;
}

function topKeys() {
  return state.topScope === "month" ? state.months : state.issues;
}

function topPeriodTitle(value) {
  return state.topScope === "month" ? monthTitle(value) : issueTitle(value);
}

function articlesForScope(scope, key) {
  if (scope === "all") return state.data.articles;
  if (scope === "month") return state.data.articles.filter((article) => issueDate(article).startsWith(`${key}.`));
  return articlesInWindow(key);
}

function scopeTitle(scope, key) {
  if (scope === "all") return `全部 ${state.issues.length} 期`;
  if (scope === "month") return monthTitle(key);
  return issueTitle(key);
}

function previousCloudScopeKey() {
  if (state.cloudScope === "all") return "";
  const keys = state.cloudScope === "month" ? state.months : state.issues;
  const index = keys.indexOf(state.cloudIssue);
  return index > 0 ? keys[index - 1] : "";
}

function cloudStatistics() {
  const articles = articlesForScope(state.cloudScope, state.cloudIssue);
  const periods = periodsFor(articles);
  const stats = tagStatistics(articles, periods, true, "");
  const previousKey = previousCloudScopeKey();
  const previousArticles = previousKey ? articlesForScope(state.cloudScope, previousKey) : [];
  stats.forEach((item) => {
    const currentRate = articles.length ? (item.count / articles.length) * 100 : 0;
    const previousRate = previousArticles.length ? (countContaining(previousArticles, [item.tag]) / previousArticles.length) * 100 : 0;
    item.trend = previousKey ? trendFor([previousRate, currentRate]) : { delta: 0, percent: 0, recent: currentRate, previous: 0 };
  });
  return { articles, stats, previousKey };
}

function renderRangeControls(scopeSelect, periodSelect, periodLabel, scope, selected) {
  scopeSelect.value = scope;
  periodSelect.replaceChildren();
  if (scope === "all") {
    periodLabel.textContent = "範圍";
    const option = document.createElement("option");
    option.value = "all";
    option.textContent = `全部 ${state.issues.length} 期｜共 ${state.data.articles.length} 篇`;
    periodSelect.append(option);
    periodSelect.disabled = true;
    return;
  }
  periodSelect.disabled = false;
  if (scope === "month") {
    periodLabel.textContent = "月份";
    [...state.months].reverse().forEach((month) => {
      const issueCount = state.issues.filter((issue) => issue.startsWith(`${month}.`)).length;
      const articleCount = articlesForScope("month", month).length;
      const option = document.createElement("option");
      option.value = month;
      option.textContent = `${monthTitle(month)}｜${issueCount} 期・${articleCount} 篇`;
      option.selected = month === selected;
      periodSelect.append(option);
    });
    return;
  }
  periodLabel.textContent = "期數";
  fillIssueSelect(periodSelect, selected);
}

function renderCloudControls() {
  renderRangeControls(els.cloudScope, els.cloudIssue, els.cloudPeriodLabel, state.cloudScope, state.cloudIssue);
}

function renderRelationshipControls() {
  renderRangeControls(els.relationshipScope, els.relationshipIssue, els.relationshipPeriodLabel, state.relationshipScope, state.relationshipIssue);
}

function renderOverviewControls() {
  renderRangeControls(els.overviewScope, els.overviewIssue, els.overviewPeriodLabel, state.overviewScope, state.overviewIssue);
}

function renderIndependentIssueControls() {
  renderOverviewControls();
  renderRelationshipControls();
  renderCloudControls();
}

function renderRelationshipPanel() {
  renderRelationshipControls();
  const renderKey = `${state.relationshipScope}|${state.relationshipIssue}|${state.selectedTags.join("|")}`;
  if (state.relationshipRenderKey === renderKey && els.relationshipNetwork.childElementCount) return;
  state.relationshipRenderKey = renderKey;
  const articles = articlesForScope(state.relationshipScope, state.relationshipIssue);
  const periods = periodsFor(articles);
  const stats = tagStatistics(articles, periods, true, "");
  renderRelationships(articles, stats, relationshipsFor(articles));
}

function renderSelectedTags() {
  els.selectedTagList.replaceChildren();
  els.clearFocus.hidden = !state.selectedTags.length;
  if (!state.selectedTags.length) {
    const empty = document.createElement("span");
    empty.textContent = "尚未選擇，顯示目前資料範圍的最強關聯";
    els.selectedTagList.append(empty);
    return;
  }
  state.selectedTags.forEach((tag, index) => {
    const chip = document.createElement("span");
    chip.className = "selected-tag";
    const order = document.createElement("b");
    order.textContent = index + 1;
    const label = document.createElement("span");
    label.textContent = tag;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除「${tag}」`);
    remove.addEventListener("click", () => toggleFocusTag(tag));
    chip.append(order, label, remove);
    els.selectedTagList.append(chip);
  });
}

function statsMapFor(stats) {
  return new Map(stats.map((item) => [item.tag, item]));
}

function relatedTags(articles, tag, limit = 9) {
  return singleTagRelationships(articles, tag).slice(0, limit);
}

function clearTagHighlights() {
  els.overviewGrid.classList.remove("has-hover");
  els.keywordCloud.classList.remove("has-hover");
  document.querySelectorAll(".overview-tag, .cloud-word").forEach((item) => item.classList.remove("related"));
  els.tooltip.hidden = true;
}

function positionTooltip(event) {
  const margin = 12;
  const rect = els.tooltip.getBoundingClientRect();
  const clientX = Number.isFinite(event.clientX) ? event.clientX : innerWidth / 2;
  const clientY = Number.isFinite(event.clientY) ? event.clientY : innerHeight / 2;
  const left = Math.max(margin, Math.min(innerWidth - rect.width - margin, clientX + 14));
  const preferredTop = clientY - rect.height - 14;
  els.tooltip.style.left = `${left}px`;
  els.tooltip.style.top = `${preferredTop > margin ? preferredTop : clientY + 16}px`;
}

function highlightTag(tag, event, articles, statsByTag, trendFormatter = (trend) => trendTextForSelection(trend, state.overviewIssue)) {
  const relations = relatedTags(articles, tag);
  const relationMap = new Map(relations.map((item) => [item.target, item]));
  els.overviewGrid.classList.add("has-hover");
  els.keywordCloud.classList.add("has-hover");
  document.querySelectorAll(".overview-tag, .cloud-word").forEach((item) => {
    item.classList.toggle("related", item.dataset.tag === tag || relationMap.has(item.dataset.tag));
  });
  const stat = statsByTag.get(tag);
  els.tooltip.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = tag;
  const details = document.createElement("span");
  const topRelated = relations.slice(0, 3).map((item) => item.target).join("、") || "尚無穩定關聯";
  details.textContent = `${stat?.count || 0} 篇 · ${trendFormatter(stat?.trend || { percent: 0 })}｜主要關聯：${topRelated}`;
  els.tooltip.append(title, details);
  els.tooltip.hidden = false;
  requestAnimationFrame(() => positionTooltip(event));
}

function sortStats(stats, sort) {
  return [...stats].sort((a, b) => {
    if (sort === "name") return a.tag.localeCompare(b.tag, "zh-Hant");
    if (sort === "trend") return b.trend.delta - a.trend.delta || b.count - a.count;
    if (sort === "latest") return b.latest.localeCompare(a.latest) || b.count - a.count;
    return b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hant");
  });
}

function renderTagOverview(articles, stats, previousKey = "") {
  renderSelectedTags();
  const statsByTag = statsMapFor(stats);
  const query = state.overviewQuery.trim().toLocaleLowerCase("zh-Hant");
  const filtered = sortStats(stats.filter((item) => item.tag.toLocaleLowerCase("zh-Hant").includes(query)), state.overviewSort);
  els.overviewGrid.replaceChildren();
  els.overviewCount.textContent = `顯示 ${filtered.length} / ${state.allTags.length} 個 tag`;
  for (const item of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overview-tag";
    button.classList.toggle("selected", state.selectedTags.includes(item.tag));
    button.dataset.tag = item.tag;
    button.setAttribute("aria-pressed", String(state.selectedTags.includes(item.tag)));
    const label = document.createElement("span");
    label.textContent = item.tag;
    const count = document.createElement("small");
    count.textContent = item.count;
    button.append(label, count);
    button.addEventListener("click", () => toggleFocusTag(item.tag));
    const trendFormatter = (trend) => previousKey ? trendText(trend) : "無比較基準";
    button.addEventListener("pointerenter", (event) => highlightTag(item.tag, event, articles, statsByTag, trendFormatter));
    button.addEventListener("pointermove", positionTooltip);
    button.addEventListener("pointerleave", clearTagHighlights);
    button.addEventListener("focus", (event) => highlightTag(item.tag, event, articles, statsByTag, trendFormatter));
    button.addEventListener("blur", clearTagHighlights);
    els.overviewGrid.append(button);
  }
}

function appendSignalCard(label, value, description, accent = false, help = null) {
  const card = document.createElement("article");
  card.className = `signal-card${accent ? " accent" : ""}`;
  const labelRow = document.createElement("span");
  labelRow.className = "signal-label-row";
  const small = document.createElement("small"); small.textContent = label;
  const strong = document.createElement("strong"); strong.textContent = value;
  const paragraph = document.createElement("p"); paragraph.textContent = description;
  labelRow.append(small);
  if (help) labelRow.append(createCalculationHelp(help.title, help.body));
  card.append(labelRow, strong, paragraph);
  els.signalCards.append(card);
}

function renderSignals(articles, periods, stats, relationships, previousKey = "") {
  els.signalCards.replaceChildren();
  const activeTags = stats.filter((item) => item.count > 0);
  const observedIssues = periods.length;
  const scopeDescription = state.overviewScope === "all"
    ? `全部資料｜${state.issues.length} 期`
    : state.overviewScope === "month"
      ? `${monthTitle(state.overviewIssue)}｜${observedIssues} 期`
      : `${issueTitle(state.overviewIssue)}｜${issueRange(state.overviewIssue, true)}`;
  appendSignalCard("觀測範圍", `${observedIssues} 期`, scopeDescription);
  appendSignalCard("涵蓋文章", `${articles.length} 篇`, `目前期間共涵蓋 ${activeTags.length} 個 tag`, false, {
    title: "涵蓋文章怎麼算？",
    body: "文章數是目前所選範圍的文章總數；tag 數會把這些文章使用過的 tag 去除重複後計算。",
  });
  if (!state.selectedTags.length) {
    const strongest = relationships[0];
    appendSignalCard("最強關聯", strongest ? strongest.tags.join(" × ") : "資料不足", strongest ? `關聯強度 ${strongest.score}；共同 ${strongest.support} 篇` : "請擴大時間範圍", true, {
      title: "最強關聯怎麼算？",
      body: "比較所有 tag 組合的 NPMI，再依共同文章數折減小樣本。熱門但沒有特別常一起出現的 tag，不會只靠篇數排到前面。",
    });
  } else if (state.selectedTags.length === 1) {
    const strongest = relationships[0];
    const focusCount = countContaining(articles, state.selectedTags);
    appendSignalCard("單 tag 模式", state.selectedTags[0], `${focusCount} 篇；最強延伸 ${strongest?.target || "資料不足"}`, true, {
      title: "單 tag 模式怎麼算？",
      body: "先找出含有焦點 tag 的文章，再逐一比較其他 tag 與它共同出現的程度；最強延伸是經 NPMI 與低樣本折減後分數最高者。",
    });
  } else {
    const pairCount = countContaining(articles, state.selectedTags);
    const strongest = relationships[0];
    appendSignalCard("雙 tag 交集", `${pairCount} 篇`, `${state.selectedTags.join(" × ")}；最強延伸 ${strongest?.target || "資料不足"}`, true, {
      title: "雙 tag 交集怎麼算？",
      body: "交集篇數是同一篇文章同時含有兩個焦點 tag 的數量。第三層排名再把這個交集視為一個主題，與其他 tag 計算關聯。",
    });
  }
  const rising = [...activeTags].filter((item) => item.trend.delta > 0).sort((a, b) => b.trend.delta - a.trend.delta || b.count - a.count)[0];
  const comparisonLabel = state.overviewScope === "month" ? "較前月升溫" : state.overviewScope === "all" ? "近期升溫" : "較前一期升溫";
  const comparisonUnit = state.overviewScope === "month" ? "前一月" : "前一期";
  appendSignalCard(comparisonLabel, rising?.tag || "資料不足", rising ? `${trendText(rising.trend)}；目前範圍出現 ${rising.count} 篇` : !previousKey ? `沒有${comparisonUnit}資料可比較` : "目前沒有明顯升溫的 tag", false, {
    title: "升溫怎麼算？",
    body: `先算每個 tag 在目前範圍的文章占比，再與${comparisonUnit}比較；卡片挑出占比增加最多的 tag。百分比表示相對增幅，不是增加的文章篇數。`,
  });
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function graphData(articles, stats, relationships) {
  const counts = new Map(stats.map((item) => [item.tag, item.count]));
  // 框較小、球較大，整體圖只放最強的 16 組關聯；其餘仍列在下方排名。
  const limited = relationships.slice(0, state.selectedTags.length ? 10 : 16);
  const nodeMap = new Map();
  const edges = [];
  const ensureNode = (id, tag, options = {}) => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, tag, count: counts.get(tag) || 0, ...options });
    else Object.assign(nodeMap.get(id), options);
    return nodeMap.get(id);
  };
  if (!state.selectedTags.length) {
    limited.forEach((item) => {
      const left = ensureNode(item.tags[0], item.tags[0]);
      const right = ensureNode(item.tags[1], item.tags[1]);
      edges.push({ a: left.id, b: right.id, score: item.score, support: item.support });
    });
  } else if (state.selectedTags.length === 1) {
    const focus = ensureNode("focus", state.selectedTags[0], { selected: true, fixed: true });
    limited.forEach((item) => {
      const target = ensureNode(`target:${item.target}`, item.target);
      edges.push({ a: focus.id, b: target.id, score: item.score, support: item.support });
    });
  } else {
    const pairSupport = countContaining(articles, state.selectedTags);
    const first = ensureNode("focus-a", state.selectedTags[0], { selected: true, fixed: true });
    const second = ensureNode("focus-b", state.selectedTags[1], { selected: true, fixed: true });
    const compound = ensureNode("compound", "共同文章", { count: pairSupport, compound: true, fixed: true });
    edges.push({ a: first.id, b: compound.id, score: 0, support: pairSupport, structural: true });
    edges.push({ a: second.id, b: compound.id, score: 0, support: pairSupport, structural: true });
    limited.slice(0, 8).forEach((item) => {
      const target = ensureNode(`target:${item.target}`, item.target);
      edges.push({ a: compound.id, b: target.id, score: item.score, support: item.support });
    });
  }
  return { nodes: [...nodeMap.values()], edges };
}

function stableHash(value) {
  return [...value].reduce((hash, character) => ((hash * 31) + character.codePointAt(0)) >>> 0, 2166136261);
}

function assignGraphCommunities(nodes, edges) {
  const neighbors = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    neighbors.get(edge.a)?.push({ id: edge.b, weight: Math.max(1, edge.score) });
    neighbors.get(edge.b)?.push({ id: edge.a, weight: Math.max(1, edge.score) });
  });
  const labels = new Map(nodes.map((node, index) => [node.id, index]));
  for (let pass = 0; pass < 8; pass += 1) {
    [...nodes].sort((a, b) => stableHash(`${a.id}:${pass}`) - stableHash(`${b.id}:${pass}`)).forEach((node) => {
      const scores = new Map();
      neighbors.get(node.id).forEach((neighbor) => {
        const label = labels.get(neighbor.id);
        scores.set(label, (scores.get(label) || 0) + neighbor.weight);
      });
      const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (best) labels.set(node.id, best[0]);
    });
  }
  const sizes = new Map();
  labels.forEach((label) => sizes.set(label, (sizes.get(label) || 0) + 1));
  const ordered = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([label]) => label);
  const normalized = new Map(ordered.map((label, index) => [label, Math.min(index, COMMUNITY_NAMES.length - 1)]));
  nodes.forEach((node) => { node.community = node.compound || node.selected ? COMMUNITY_NAMES.length : normalized.get(labels.get(node.id)) || 0; });
}

function fitLayoutToCanvas(nodes) {
  const area = networkFitArea();
  const maxRadius = Math.max(...nodes.map((node) => node.radius));
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const usableWidth = area.right - area.left - maxRadius * 2;
  const usableHeight = area.bottom - area.top - maxRadius * 2 - NETWORK_LABEL_SPACE;
  // 節點少時拉開間距鋪滿畫面，但最多拉開 2.4 倍，免得三五個節點散得太遠。
  // 水平與垂直分開計算，橫長的外框也能用滿寬度；兩軸差距限制在 1.8 倍內，避免圖形被拉得太扁。
  const clampSpread = (value) => Math.max(.85, Math.min(NETWORK_MAX_SPREAD, value));
  const fitX = clampSpread(usableWidth / Math.max(1, maxX - minX));
  const fitY = clampSpread(usableHeight / Math.max(1, maxY - minY));
  const spreadX = Math.min(fitX, Math.min(fitX, fitY) * 1.8);
  const spreadY = Math.min(fitY, Math.min(fitX, fitY) * 1.8);
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const targetX = (area.left + area.right) / 2, targetY = (area.top + area.bottom) / 2;
  nodes.forEach((node) => {
    node.x = targetX + (node.x - centerX) * spreadX;
    node.y = targetY + (node.y - centerY) * spreadY;
  });
  resolveNodeCollisions(nodes);
  const left = Math.min(...nodes.map((node) => node.x - node.radius));
  const right = Math.max(...nodes.map((node) => node.x + node.radius));
  const top = Math.min(...nodes.map((node) => node.y - node.radius));
  const bottom = Math.max(...nodes.map((node) => node.y + node.radius + NETWORK_LABEL_SPACE));
  const width = right - left;
  const height = bottom - top;
  const zoom = Math.max(1, Math.min(NETWORK_MAX_FIT_ZOOM, (area.right - area.left) / width, (area.bottom - area.top) / height));
  // 縮放以畫布中心為基準；補償平移，讓放大後整張圖的中心落在可用區域中央。
  const boxX = (left + right) / 2, boxY = (top + bottom) / 2;
  const areaX = (area.left + area.right) / 2, areaY = (area.top + area.bottom) / 2;
  return {
    zoom,
    panX: areaX - GRAPH_WIDTH / 2 - (boxX - GRAPH_WIDTH / 2) * zoom,
    panY: areaY - GRAPH_HEIGHT / 2 - (boxY - GRAPH_HEIGHT / 2) * zoom,
  };
}

// 兩球所需的最小中心距離：橫向留 22 單位（吸收 3D 視角的位移），越接近上下排列，越要多留下方標籤的高度。
function requiredNodeDistance(a, b, dx, dy, distance) {
  const verticalShare = Math.abs(dy) / Math.max(distance, .01);
  return a.radius + b.radius + 22 + NETWORK_LABEL_SPACE * verticalShare;
}

function relaxNodeCollisions(nodes, area, bottom) {
  for (let pass = 0; pass < 300; pass += 1) {
    let overlapping = false;
    for (let first = 0; first < nodes.length; first += 1) {
      for (let second = first + 1; second < nodes.length; second += 1) {
        const a = nodes[first], b = nodes[second];
        if (a.fixed && b.fixed) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance < .01) { dx = first % 2 ? 1 : -1; dy = .5; distance = Math.hypot(dx, dy); }
        const needed = requiredNodeDistance(a, b, dx, dy, distance);
        if (distance >= needed) continue;
        overlapping = true;
        // 沿兩球連線推開，擁擠時球能互相繞開，不會卡在框邊。
        const push = needed - distance + .5;
        const ux = dx / distance, uy = dy / distance;
        const shareA = a.fixed ? 0 : b.fixed ? 1 : .5;
        const shareB = 1 - shareA;
        a.x -= ux * push * shareA; a.y -= uy * push * shareA;
        b.x += ux * push * shareB; b.y += uy * push * shareB;
      }
    }
    nodes.forEach((node) => {
      node.x = Math.max(area.left + node.radius, Math.min(area.right - node.radius, node.x));
      node.y = Math.max(area.top + node.radius, Math.min(bottom - node.radius, node.y));
    });
    if (!overlapping) return true;
  }
  return false;
}

// 推開到不重疊為止（固定節點不動）；空間真的不夠時，整張圖的球縮小 6% 再試，最多三次。
function resolveNodeCollisions(nodes) {
  const area = networkFitArea();
  const bottom = area.bottom - NETWORK_LABEL_SPACE;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (relaxNodeCollisions(nodes, area, bottom)) return;
    if (attempt < 3) nodes.forEach((node) => { node.radius *= .94; });
  }
}

function layoutGraph(nodes, edges) {
  assignGraphCommunities(nodes, edges);
  const tagCounts = nodes.filter((node) => !node.compound).map((node) => Math.max(0, node.count));
  const minRoot = tagCounts.length ? Math.sqrt(Math.min(...tagCounts)) : 0;
  const maxRoot = Math.sqrt(Math.max(0, ...tagCounts));
  // 排版只在說明框與圖例之間進行，球不會壓到上方說明或下方圖例。
  const area = networkFitArea();
  const areaBottom = area.bottom - NETWORK_LABEL_SPACE;
  const middleX = (area.left + area.right) / 2;
  const middleY = (area.top + areaBottom) / 2;
  const centers = COMMUNITY_NAMES.map((_, index) => {
    const angle = -Math.PI / 2 + (index / COMMUNITY_NAMES.length) * Math.PI * 2;
    return { x: middleX + Math.cos(angle) * (area.right - area.left) * .36, y: middleY + Math.sin(angle) * (areaBottom - area.top) * .32 };
  });
  const focusCenter = { x: middleX, y: middleY };
  nodes.forEach((node, index) => {
    const sizeRatio = maxRoot > minRoot ? (Math.sqrt(node.count) - minRoot) / (maxRoot - minRoot) : .5;
    node.radius = node.compound ? NODE_COMPOUND_RADIUS : NODE_MIN_RADIUS + sizeRatio * (NODE_MAX_RADIUS - NODE_MIN_RADIUS);
    const center = centers[node.community] || centers[0];
    const angle = (stableHash(node.id) % 628) / 100;
    const distance = 45 + (stableHash(`${node.id}:distance`) % 90);
    node.x = center.x + Math.cos(angle) * distance;
    node.y = center.y + Math.sin(angle) * distance;
    node.vx = 0; node.vy = 0;
    // 深度只用來在旋轉時錯開重疊節點；幅度壓小，避免透視讓同篇數的節點忽大忽小。
    node.z = ((stableHash(`${node.id}:depth`) % 360) - 180) * .07 + (Math.min(node.community, COMMUNITY_NAMES.length - 1) - 3.5) * 2;
    if (node.id === "focus") { node.x = focusCenter.x; node.y = focusCenter.y; }
    if (node.id === "focus-a") { node.x = GRAPH_WIDTH * .35; node.y = area.top + (areaBottom - area.top) * .22; }
    if (node.id === "focus-b") { node.x = GRAPH_WIDTH * .65; node.y = area.top + (areaBottom - area.top) * .22; }
    if (node.id === "compound") { node.x = focusCenter.x; node.y = middleY + (areaBottom - area.top) * .08; }
    if (node.fixed) node.z = 10;
    node.layoutIndex = index;
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  for (let iteration = 0; iteration < 130; iteration += 1) {
    for (let first = 0; first < nodes.length; first += 1) {
      for (let second = first + 1; second < nodes.length; second += 1) {
        const a = nodes[first], b = nodes[second];
        let dx = b.x - a.x, dy = b.y - a.y;
        let distance = Math.max(1, Math.hypot(dx, dy));
        const minimum = a.radius + b.radius + 24;
        const force = distance < minimum ? (minimum - distance) * .055 : 1150 / (distance * distance);
        dx /= distance; dy /= distance;
        if (!a.fixed) { a.vx -= dx * force; a.vy -= dy * force; }
        if (!b.fixed) { b.vx += dx * force; b.vy += dy * force; }
      }
    }
    edges.forEach((edge) => {
      const a = nodeMap.get(edge.a), b = nodeMap.get(edge.b);
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const target = Math.max(a.radius + b.radius + 34, edge.structural ? 125 : 150 - Math.min(35, edge.score * .35));
      const force = (distance - target) * .014;
      if (!a.fixed) { a.vx += (dx / distance) * force; a.vy += (dy / distance) * force; }
      if (!b.fixed) { b.vx -= (dx / distance) * force; b.vy -= (dy / distance) * force; }
    });
    nodes.forEach((node) => {
      if (node.fixed) return;
      const center = state.selectedTags.length ? focusCenter : (centers[node.community] || centers[0]);
      node.vx += (center.x - node.x) * .004;
      node.vy += (center.y - node.y) * .004;
      node.vx *= .82; node.vy *= .82;
      node.x = Math.max(area.left + node.radius, Math.min(area.right - node.radius, node.x + node.vx));
      node.y = Math.max(area.top + node.radius, Math.min(areaBottom - node.radius, node.y + node.vy));
    });
  }
  const view = fitLayoutToCanvas(nodes);
  nodes.forEach((node) => { node.baseX = node.x; node.baseY = node.y; node.baseZ = node.z; });
  return view;
}

function communityLabel(node) {
  if (node.compound) return "共同文章";
  if (node.selected) return "已選 tag";
  return `關聯社群 ${COMMUNITY_NAMES[node.community] || "A"}`;
}

function communitySummaries(nodes) {
  return COMMUNITY_NAMES.map((_, community) => {
    const members = nodes
      .filter((node) => node.community === community && !node.selected && !node.compound)
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hant"));
    if (!members.length) return null;
    return {
      community,
      representativeTags: members.slice(0, 3).map((node) => node.tag),
    };
  }).filter(Boolean);
}

function renderNetwork(articles, stats, relationships) {
  if (state.networkFrame) cancelAnimationFrame(state.networkFrame);
  state.networkFrame = null;
  els.relationshipNetwork.classList.remove("dragging", "is-moving");
  els.relationshipNetwork.replaceChildren();
  GRAPH_HEIGHT = measureGraphHeight();
  const { nodes, edges } = graphData(articles, stats, relationships);
  if (!nodes.length || !edges.length) {
    const empty = document.createElement("div");
    empty.className = "network-empty";
    empty.textContent = "目前範圍沒有足夠的共同出現資料，請擴大期間或改選 tag。";
    els.relationshipNetwork.append(empty);
    return;
  }
  const fittedView = layoutGraph(nodes, edges);
  const minZoom = fittedView.zoom * .6;
  const maxZoom = fittedView.zoom * 2.2;
  els.relationshipNetwork.classList.add("network-3d");
  const nodeTooltip = document.createElement("div");
  nodeTooltip.className = "network-node-tooltip";
  nodeTooltip.hidden = true;
  const tooltipTitle = document.createElement("strong");
  const tooltipMeta = document.createElement("span");
  nodeTooltip.append(tooltipTitle, tooltipMeta);
  function positionNodeTooltip(event) {
    if (!event || nodeTooltip.hidden || orbit.dragging || orbit.pinching) return;
    const rect = els.relationshipNetwork.getBoundingClientRect();
    const width = nodeTooltip.offsetWidth || 180;
    const height = nodeTooltip.offsetHeight || 50;
    const left = Math.max(10, Math.min(rect.width - width - 10, event.clientX - rect.left + 14));
    const top = Math.max(10, Math.min(rect.height - height - 10, event.clientY - rect.top + 14));
    nodeTooltip.style.left = `${left}px`;
    nodeTooltip.style.top = `${top}px`;
  }
  function showNodeTooltip(node, event) {
    tooltipTitle.textContent = node.tag;
    tooltipMeta.textContent = `${node.count} 篇文章 · ${communityLabel(node)}`;
    nodeTooltip.hidden = false;
    if (event) positionNodeTooltip(event);
    else { nodeTooltip.style.left = "12px"; nodeTooltip.style.top = "54px"; }
  }
  function hideNodeTooltip() {
    nodeTooltip.hidden = true;
  }
  const svg = svgElement("svg", { viewBox: `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`, role: "group", "aria-label": "tag 關聯節點；可用 Tab 鍵逐一查看" });
  const edgeLayer = svgElement("g");
  const nodeLayer = svgElement("g");
  svg.append(edgeLayer, nodeLayer);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeElements = [];
  edges.forEach((edge, index) => {
    const a = nodeMap.get(edge.a), b = nodeMap.get(edge.b);
    const community = a.community === b.community ? a.community : "mixed";
    const path = svgElement("path", { class: `network-edge${edge.score >= 60 ? " strong" : ""}${edge.structural ? " structural" : ""}`, "data-community": community, "stroke-width": edge.structural ? 2 : 1 + edge.score / 28 });
    path.style.setProperty("--edge-delay", `${index * 24}ms`);
    const title = svgElement("title");
    title.textContent = edge.structural ? `${a.tag}匯入共同文章｜${edge.support} 篇` : `${a.tag} × ${b.tag}｜強度 ${edge.score}｜共同 ${edge.support} 篇`;
    path.append(title);
    edgeLayer.append(path);
    edgeElements.push({ edge, path, index });
  });
  const nodeElements = new Map();
  const orbit = {
    yaw: -.2,
    pitch: -.16,
    targetYaw: -.2,
    targetPitch: -.16,
    zoom: fittedView.zoom,
    targetZoom: fittedView.zoom,
    panX: fittedView.panX,
    panY: fittedView.panY,
    targetPanX: fittedView.panX,
    targetPanY: fittedView.panY,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    suppressClickUntil: 0,
    pointers: new Map(),
    pinching: false,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    pinchStartCenter: null,
    pinchStartPanX: 0,
    pinchStartPanY: 0,
  };
  let clientToGraphMatrix = null;
  let matrixUpdatedAt = 0;
  let zoomLevel = null;
  let zoomOutButton = null;
  let zoomInButton = null;
  function clientPointToGraph(clientX, clientY, refreshMatrix = false) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const now = performance.now();
    if (refreshMatrix || !clientToGraphMatrix || now - matrixUpdatedAt > 250) {
      const screenMatrix = svg.getScreenCTM();
      clientToGraphMatrix = screenMatrix ? screenMatrix.inverse() : null;
      matrixUpdatedAt = now;
    }
    if (!clientToGraphMatrix) return { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
    const graphPoint = point.matrixTransform(clientToGraphMatrix);
    return { x: graphPoint.x, y: graphPoint.y };
  }
  function constrainNetworkPan(panX, panY, zoom) {
    const maxPanX = GRAPH_WIDTH * Math.max(0, zoom - minZoom) * .5 + Math.abs(fittedView.panX) + panelShift.x;
    const maxPanY = GRAPH_HEIGHT * Math.max(0, zoom - minZoom) * .5 + Math.abs(fittedView.panY);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, panX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, panY)),
    };
  }
  function zoomPanAtPoint(nextZoom, focus, startZoom = orbit.targetZoom, startPanX = orbit.targetPanX, startPanY = orbit.targetPanY) {
    const zoomRatio = nextZoom / Math.max(.001, startZoom);
    const centerX = GRAPH_WIDTH / 2;
    const centerY = GRAPH_HEIGHT / 2;
    const nextPan = constrainNetworkPan(
      focus.x - centerX - (focus.x - centerX - startPanX) * zoomRatio,
      focus.y - centerY - (focus.y - centerY - startPanY) * zoomRatio,
      nextZoom,
    );
    orbit.targetPanX = nextPan.x;
    orbit.targetPanY = nextPan.y;
  }
  function projectNode(node, rotationX, rotationY) {
    const x = node.baseX - GRAPH_WIDTH / 2;
    const y = node.baseY - GRAPH_HEIGHT / 2;
    const z = node.baseZ;
    const cosY = Math.cos(rotationY), sinY = Math.sin(rotationY);
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    const cosX = Math.cos(rotationX), sinX = Math.sin(rotationX);
    const y1 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;
    const perspectiveScale = 2400 / (2400 - z2);
    const scale = perspectiveScale * orbit.zoom;
    return { x: GRAPH_WIDTH / 2 + orbit.panX + x1 * scale, y: GRAPH_HEIGHT / 2 + orbit.panY + y1 * scale, z: z2, scale: Math.max(.3, Math.min(3.2, scale)) };
  }
  function updatePositions(lightweight = false) {
    const projected = new Map(nodes.map((node) => [node.id, projectNode(node, orbit.pitch, orbit.yaw)]));
    edgeElements.forEach(({ edge, path, index }) => {
      const a = projected.get(edge.a), b = projected.get(edge.b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const curve = (index % 2 ? 1 : -1) * Math.min(38, Math.hypot(dx, dy) * .13);
      const length = Math.max(1, Math.hypot(dx, dy));
      const cx = (a.x + b.x) / 2 - (dy / length) * curve;
      const cy = (a.y + b.y) / 2 + (dx / length) * curve;
      path.setAttribute("d", `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`);
      path.style.opacity = String(Math.max(.16, Math.min(.82, .42 + ((a.z + b.z) / 900))));
    });
    nodeElements.forEach((group, id) => {
      const point = projected.get(id);
      group.setAttribute("transform", `translate(${point.x} ${point.y}) scale(${point.scale})`);
      // 用變數而非行內 opacity，滑過節點時 .dimmed 的淡化才會生效。
      group.style.setProperty("--depth-opacity", String(Math.max(.86, Math.min(1, .94 + point.z / 900))));
      if (!lightweight) group.style.setProperty("--depth-shadow", `${Math.max(2, 14 * point.scale)}px`);
    });
    if (!lightweight) {
      [...nodes]
        .sort((a, b) => projected.get(a.id).z - projected.get(b.id).z)
        .forEach((node) => nodeLayer.append(nodeElements.get(node.id)));
      const activeNode = nodeLayer.querySelector(".network-node.hovered, .network-node:focus");
      if (activeNode) nodeLayer.append(activeNode);
    }
  }
  function orbitIsMoving() {
    return Math.abs(orbit.targetYaw - orbit.yaw) > .0005
      || Math.abs(orbit.targetPitch - orbit.pitch) > .0005
      || Math.abs(orbit.targetZoom - orbit.zoom) > .0005
      || Math.abs(orbit.targetPanX - orbit.panX) > .01
      || Math.abs(orbit.targetPanY - orbit.panY) > .01;
  }
  function animateOrbit() {
    const response = orbit.dragging || orbit.pinching ? .42 : .3;
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * response;
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * response;
    orbit.zoom += (orbit.targetZoom - orbit.zoom) * response;
    orbit.panX += (orbit.targetPanX - orbit.panX) * response;
    orbit.panY += (orbit.targetPanY - orbit.panY) * response;
    if (orbitIsMoving()) {
      updatePositions(true);
      state.networkFrame = requestAnimationFrame(animateOrbit);
    } else {
      orbit.yaw = orbit.targetYaw;
      orbit.pitch = orbit.targetPitch;
      orbit.zoom = orbit.targetZoom;
      orbit.panX = orbit.targetPanX;
      orbit.panY = orbit.targetPanY;
      updatePositions();
      els.relationshipNetwork.classList.remove("is-moving");
      state.networkFrame = null;
    }
  }
  function requestOrbitFrame() {
    els.relationshipNetwork.classList.add("is-moving");
    if (!state.networkFrame) state.networkFrame = requestAnimationFrame(animateOrbit);
  }
  function setNetworkZoom(nextZoom, focus = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 }, zoomOrigin = null) {
    const boundedZoom = Math.max(minZoom, Math.min(maxZoom, nextZoom));
    const origin = zoomOrigin || { zoom: orbit.targetZoom, panX: orbit.targetPanX, panY: orbit.targetPanY };
    zoomPanAtPoint(boundedZoom, focus, origin.zoom, origin.panX, origin.panY);
    orbit.targetZoom = boundedZoom;
    if (zoomLevel) zoomLevel.textContent = `縮放 ${Math.round((orbit.targetZoom / fittedView.zoom) * 100)}%`;
    if (zoomOutButton) zoomOutButton.disabled = orbit.targetZoom <= minZoom * 1.001;
    if (zoomInButton) zoomInButton.disabled = orbit.targetZoom >= maxZoom * .999;
    requestOrbitFrame();
  }
  function resetNetworkView() {
    orbit.targetYaw = -.2;
    orbit.targetPitch = -.16;
    orbit.targetPanX = fittedView.panX - panelShift.x;
    orbit.targetPanY = fittedView.panY;
    setNetworkZoom(fittedView.zoom, { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 }, { zoom: fittedView.zoom, panX: orbit.targetPanX, panY: orbit.targetPanY });
  }
  // 點圓球後在右側列出對應文章；圖往左挪，讓文章面板不擋住節點。
  const panelShift = { x: 0 };
  function closeArticlePanel() {
    const panel = els.relationshipNetwork.querySelector(".network-article-panel");
    if (!panel) return;
    panel.remove();
    nodeElements.forEach((element) => element.classList.remove("active"));
    if (panelShift.x) {
      orbit.targetPanX += panelShift.x;
      panelShift.x = 0;
      requestOrbitFrame();
    }
  }
  function shiftGraphBesidePanel(panel) {
    if (panelShift.x) return;
    const networkRect = els.relationshipNetwork.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (!networkRect.width || panelRect.width > networkRect.width * .6) return;
    const visibleLeft = clientPointToGraph(networkRect.left, networkRect.top + networkRect.height / 2, true).x;
    const visibleRight = clientPointToGraph(panelRect.left - 12, networkRect.top + networkRect.height / 2).x;
    const wanted = (Math.max(0, visibleLeft) + Math.min(GRAPH_WIDTH, visibleRight)) / 2 - GRAPH_WIDTH / 2;
    // 只往左挪到最左邊的球貼近邊緣為止；球多時寧可讓面板蓋住一點，也不把左側的球推出框外。
    const leftmost = Math.min(...nodes.map((node) => {
      const point = projectNode(node, orbit.pitch, orbit.yaw);
      return point.x - node.radius * point.scale;
    }));
    const shift = Math.max(wanted, Math.min(0, Math.max(0, visibleLeft) + 12 - leftmost));
    if (shift >= 0) return;
    panelShift.x = -shift;
    orbit.targetPanX += shift;
    requestOrbitFrame();
  }
  function openArticlePanel(tags, nodeId = "") {
    const hadPanel = Boolean(els.relationshipNetwork.querySelector(".network-article-panel"));
    els.relationshipNetwork.querySelector(".network-article-panel")?.remove();
    nodeElements.forEach((element, id) => element.classList.toggle("active", id === nodeId));
    const panel = buildArticlePanel(articles, tags, closeArticlePanel, (nextTags) => openArticlePanel(nextTags, nodeIdForTags(nextTags)));
    els.relationshipNetwork.append(panel);
    if (!hadPanel) shiftGraphBesidePanel(panel);
    panel.querySelector(".network-article-panel-close")?.focus({ preventScroll: true });
  }
  function nodeIdForTags(tags) {
    if (tags.length !== 1) return "";
    return nodes.find((node) => node.tag === tags[0] && !node.compound)?.id || "";
  }
  function panelTagsForNode(node) {
    if (node.compound) return [...state.selectedTags];
    if (node.selected || !state.selectedTags.length) return [node.tag];
    return [...state.selectedTags, node.tag];
  }
  nodes.forEach((node, index) => {
    const group = svgElement("g", { class: `network-node${node.selected ? " selected" : ""}${node.compound ? " compound" : ""}`, "data-community": node.community, "data-minor": String(node.count <= 5 && !node.selected), tabindex: "0", role: "button", "aria-label": `${node.tag}，${node.count} 篇文章；按下可列出文章` });
    group.style.setProperty("--node-delay", `${index * 32}ms`);
    const title = svgElement("title"); title.textContent = `${node.tag}｜${node.count} 篇文章`;
    const circle = svgElement("circle", { r: node.radius });
    const count = svgElement("text", { y: "4", class: "node-count" }); count.textContent = node.count;
    const label = svgElement("text", { y: node.radius + 17, class: "network-label" }); label.textContent = [...node.tag].length > 9 ? `${[...node.tag].slice(0, 8).join("")}…` : node.tag;
    group.append(title, circle, count, label);
    group.addEventListener("pointerenter", (event) => {
      nodeLayer.append(group);
      showNodeTooltip(node, event);
      const neighbors = new Set([node.id]);
      edges.forEach((edge) => { if (edge.a === node.id) neighbors.add(edge.b); if (edge.b === node.id) neighbors.add(edge.a); });
      nodeElements.forEach((element, id) => { element.classList.toggle("hovered", id === node.id); element.classList.toggle("related", neighbors.has(id) && id !== node.id); element.classList.toggle("dimmed", !neighbors.has(id)); });
      edgeElements.forEach(({ edge, path }) => path.classList.toggle("dimmed", edge.a !== node.id && edge.b !== node.id));
    });
    group.addEventListener("pointerleave", () => {
      hideNodeTooltip();
      nodeElements.forEach((element) => element.classList.remove("hovered", "related", "dimmed"));
      edgeElements.forEach(({ path }) => path.classList.remove("dimmed"));
    });
    group.addEventListener("pointermove", positionNodeTooltip);
    group.addEventListener("focus", () => { nodeLayer.append(group); showNodeTooltip(node); });
    group.addEventListener("blur", hideNodeTooltip);
    group.addEventListener("click", (event) => {
      if (performance.now() < orbit.suppressClickUntil) { event.preventDefault(); return; }
      openArticlePanel(panelTagsForNode(node), node.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openArticlePanel(panelTagsForNode(node), node.id); }
    });
    nodeLayer.append(group);
    nodeElements.set(node.id, group);
  });
  els.relationshipNetwork.onpointerdown = (event) => {
    if (event.target.closest?.(".network-zoom-controls, .network-article-panel")) return;
    if (event.button !== 0) return;
    orbit.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    hideNodeTooltip();
    if (orbit.pointers.size >= 2) {
      orbit.pointers.forEach((_, pointerId) => els.relationshipNetwork.setPointerCapture?.(pointerId));
      const [first, second] = [...orbit.pointers.values()];
      orbit.pinching = true;
      orbit.dragging = false;
      orbit.pinchStartDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      orbit.pinchStartZoom = orbit.targetZoom;
      orbit.pinchStartCenter = clientPointToGraph((first.x + second.x) / 2, (first.y + second.y) / 2, true);
      orbit.pinchStartPanX = orbit.targetPanX;
      orbit.pinchStartPanY = orbit.targetPanY;
      orbit.moved = true;
      els.relationshipNetwork.classList.add("dragging");
      return;
    }
    orbit.dragging = true;
    orbit.pointerId = event.pointerId;
    orbit.lastX = event.clientX;
    orbit.lastY = event.clientY;
    orbit.startX = event.clientX;
    orbit.startY = event.clientY;
    orbit.moved = false;
    els.relationshipNetwork.classList.add("dragging");
  };
  els.relationshipNetwork.onpointermove = (event) => {
    if (!orbit.pointers.has(event.pointerId)) return;
    orbit.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (orbit.pinching && orbit.pointers.size >= 2) {
      event.preventDefault();
      const [first, second] = [...orbit.pointers.values()];
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const pinchRatio = distance / orbit.pinchStartDistance;
      const pinchCenter = clientPointToGraph((first.x + second.x) / 2, (first.y + second.y) / 2);
      const boundedZoom = Math.max(minZoom, Math.min(maxZoom, orbit.pinchStartZoom * Math.pow(pinchRatio, PINCH_ZOOM_SENSITIVITY)));
      const startCenter = orbit.pinchStartCenter || { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
      const zoomRatio = boundedZoom / Math.max(.001, orbit.pinchStartZoom);
      const centerX = GRAPH_WIDTH / 2;
      const centerY = GRAPH_HEIGHT / 2;
      const nextPan = constrainNetworkPan(
        pinchCenter.x - centerX - (startCenter.x - centerX - orbit.pinchStartPanX) * zoomRatio,
        pinchCenter.y - centerY - (startCenter.y - centerY - orbit.pinchStartPanY) * zoomRatio,
        boundedZoom,
      );
      orbit.targetPanX = nextPan.x;
      orbit.targetPanY = nextPan.y;
      orbit.targetZoom = boundedZoom;
      setNetworkZoom(boundedZoom, pinchCenter, { zoom: boundedZoom, panX: nextPan.x, panY: nextPan.y });
      orbit.moved = true;
      orbit.suppressClickUntil = performance.now() + 300;
      return;
    }
    if (!orbit.dragging || event.pointerId !== orbit.pointerId) return;
    if (!orbit.moved) {
      // 點擊時的細微晃動不算拖曳；原本超過 1px 就攔截 click 並抓走指標，節點常常點了沒反應。
      const threshold = event.pointerType === "mouse" ? 5 : 10;
      if (Math.hypot(event.clientX - orbit.startX, event.clientY - orbit.startY) < threshold) return;
      orbit.moved = true;
      if (!els.relationshipNetwork.hasPointerCapture?.(event.pointerId)) els.relationshipNetwork.setPointerCapture?.(event.pointerId);
    }
    const dx = event.clientX - orbit.lastX;
    const dy = event.clientY - orbit.lastY;
    orbit.lastX = event.clientX;
    orbit.lastY = event.clientY;
    orbit.targetYaw += dx * .012;
    orbit.targetPitch = Math.max(-1.05, Math.min(1.05, orbit.targetPitch - dy * .009));
    requestOrbitFrame();
  };
  function finishOrbitDrag(event) {
    if (!orbit.pointers.has(event.pointerId)) return;
    const moved = orbit.moved || orbit.pinching;
    orbit.pointers.delete(event.pointerId);
    if (els.relationshipNetwork.hasPointerCapture?.(event.pointerId)) els.relationshipNetwork.releasePointerCapture(event.pointerId);
    if (orbit.pointers.size === 1) {
      const [pointerId, position] = [...orbit.pointers.entries()][0];
      orbit.pinching = false;
      orbit.dragging = true;
      orbit.pointerId = pointerId;
      orbit.lastX = position.x;
      orbit.lastY = position.y;
      orbit.moved = true;
    } else {
      orbit.pinching = false;
      orbit.dragging = false;
      orbit.pointerId = null;
      orbit.moved = false;
      els.relationshipNetwork.classList.remove("dragging");
    }
    if (moved) {
      orbit.suppressClickUntil = performance.now() + 300;
      requestOrbitFrame();
    }
  }
  els.relationshipNetwork.onpointerup = finishOrbitDrag;
  els.relationshipNetwork.onpointercancel = finishOrbitDrag;
  els.relationshipNetwork.onwheel = (event) => {
    if (event.target.closest?.(".network-article-panel")) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * .0015);
    setNetworkZoom(orbit.targetZoom * factor, clientPointToGraph(event.clientX, event.clientY));
  };
  els.relationshipNetwork.ondblclick = (event) => {
    if (event.target.closest?.(".network-article-panel")) return;
    event.preventDefault();
    resetNetworkView();
  };
  updatePositions();
  const guide = document.createElement("div");
  guide.className = "network-guide";
  guide.innerHTML = "<strong>怎麼看空間圖？</strong><span>點圓球看文章 · 拖曳旋轉 · 滾輪／雙指／按鈕縮放 · 雙擊重設</span>";
  const zoomControls = document.createElement("div");
  zoomControls.className = "network-zoom-controls";
  zoomOutButton = document.createElement("button");
  zoomOutButton.type = "button";
  zoomOutButton.dataset.networkZoom = "out";
  zoomOutButton.setAttribute("aria-label", "縮小關聯圖");
  zoomOutButton.textContent = "−";
  const zoomResetButton = document.createElement("button");
  zoomResetButton.type = "button";
  zoomResetButton.dataset.networkZoom = "reset";
  zoomResetButton.setAttribute("aria-label", "重設關聯圖視角與縮放");
  zoomResetButton.textContent = "↺";
  zoomInButton = document.createElement("button");
  zoomInButton.type = "button";
  zoomInButton.dataset.networkZoom = "in";
  zoomInButton.setAttribute("aria-label", "放大關聯圖");
  zoomInButton.textContent = "+";
  [zoomOutButton, zoomResetButton, zoomInButton].forEach((button) => button.addEventListener("pointerdown", (event) => event.stopPropagation()));
  zoomOutButton.addEventListener("click", () => setNetworkZoom(orbit.targetZoom / 1.22));
  zoomResetButton.addEventListener("click", resetNetworkView);
  zoomInButton.addEventListener("click", () => setNetworkZoom(orbit.targetZoom * 1.22));
  zoomControls.append(zoomOutButton, zoomResetButton, zoomInButton);
  zoomLevel = document.createElement("span");
  zoomLevel.className = "network-zoom-level";
  zoomLevel.setAttribute("aria-live", "polite");
  zoomLevel.textContent = "縮放 100%";
  const key = document.createElement("div");
  key.className = "network-key";
  const appendKeyItem = (className, label, titleText = "") => {
    const item = document.createElement("span");
    const marker = document.createElement("i");
    marker.className = className;
    item.append(marker, label);
    if (titleText) item.title = titleText;
    key.append(item);
  };
  if (state.selectedTags.length) appendKeyItem("selected-node", "已選 tag");
  communitySummaries(nodes).forEach(({ community, representativeTags }) => {
    appendKeyItem(
      `community-${community}`,
      `社群 ${COMMUNITY_NAMES[community]}：${representativeTags.slice(0, 2).join("、")}`,
      `這群目前以 ${representativeTags.join("、")} 為代表`,
    );
  });
  if (state.selectedTags.length === 2) appendKeyItem("compound-node", "共同文章");
  const orbitHint = document.createElement("b");
  orbitHint.textContent = "點圓球看文章 · 拖曳旋轉 · 滾輪或雙指縮放 · 雙擊重設";
  const legendNote = document.createElement("small");
  legendNote.textContent = "社群是依目前範圍的連線密度自動形成，不是固定主題分類；冒號後列出該群代表 tag。大小＝文章篇數；遠近只用來分開重疊節點。";
  key.append(orbitHint, legendNote);
  els.relationshipNetwork.append(svg, guide, zoomControls, zoomLevel, key, nodeTooltip);
  const modeText = !state.selectedTags.length ? "全站關聯" : state.selectedTags.length === 1 ? `${state.selectedTags[0]}的關聯圈` : `${state.selectedTags.join("與")}的共同延伸`;
  els.relationshipNetwork.setAttribute("aria-label", `${modeText}，顯示 ${nodes.length} 個 tag 與 ${edges.length} 條關聯`);
  state.closeNetworkPanel = closeArticlePanel;
  if (state.pendingNetworkPanel) {
    const tags = state.pendingNetworkPanel;
    state.pendingNetworkPanel = null;
    openArticlePanel(tags, nodeIdForTags(tags) || (tags.length === 1 ? "focus" : "compound"));
  }
}

function articlesWithTags(articles, tags) {
  return articles
    .filter((article) => tags.every((tag) => (article.keywordsZh || []).includes(tag)))
    .sort((a, b) => issueDate(b).localeCompare(issueDate(a)) || (a.titleEn || "").localeCompare(b.titleEn || ""));
}

function buildArticlePanel(articles, tags, onClose, onShowTags) {
  const matches = articlesWithTags(articles, tags);
  const panel = document.createElement("aside");
  panel.className = "network-article-panel";
  const label = tags.length === 1 ? `「${tags[0]}」相關文章` : `「${tags.join("」×「")}」共同文章`;
  panel.setAttribute("aria-label", label);

  const header = document.createElement("div");
  header.className = "network-article-panel-header";
  const heading = document.createElement("div");
  const range = document.createElement("small");
  range.textContent = scopeTitle(state.relationshipScope, state.relationshipIssue);
  const title = document.createElement("h3");
  title.textContent = `${label}・${matches.length} 篇`;
  heading.append(range, title);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "network-article-panel-close";
  close.setAttribute("aria-label", "關閉文章列表");
  close.textContent = "×";
  close.addEventListener("click", onClose);
  header.append(heading, close);

  const actions = document.createElement("div");
  actions.className = "network-article-panel-actions";
  const lastTag = tags.at(-1);
  if (tags.length === 1 && !state.selectedTags.includes(lastTag)) {
    const focus = document.createElement("button");
    focus.type = "button";
    focus.textContent = `以「${lastTag}」為中心看關聯`;
    focus.addEventListener("click", () => {
      state.pendingNetworkPanel = [lastTag];
      state.selectedTags = [lastTag];
      renderAll();
    });
    actions.append(focus);
  }
  if (tags.length === 2 && state.selectedTags.length === 1 && !state.selectedTags.includes(lastTag)) {
    const pair = document.createElement("button");
    pair.type = "button";
    pair.textContent = `把「${lastTag}」加入分析`;
    pair.addEventListener("click", () => {
      state.pendingNetworkPanel = [...tags];
      toggleFocusTag(lastTag);
    });
    const only = document.createElement("button");
    only.type = "button";
    only.className = "secondary";
    only.textContent = `只看「${lastTag}」的文章`;
    only.addEventListener("click", () => onShowTags([lastTag]));
    actions.append(pair, only);
  }
  const indexLink = document.createElement("a");
  indexLink.href = articleIndexUrl(tags);
  indexLink.textContent = "在文章索引查看 →";
  actions.append(indexLink);

  const list = document.createElement("div");
  list.className = "network-article-panel-list";
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "related-articles-empty";
    empty.textContent = "這個資料範圍沒有符合的文章。";
    list.append(empty);
  }
  const appendCards = (items) => items.forEach((article) => list.append(createRelatedArticleCard(article, tags)));
  appendCards(matches.slice(0, RELATED_ARTICLES_PREVIEW_LIMIT));
  if (matches.length > RELATED_ARTICLES_PREVIEW_LIMIT) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "related-articles-more";
    more.textContent = `顯示其餘 ${matches.length - RELATED_ARTICLES_PREVIEW_LIMIT} 篇`;
    more.addEventListener("click", () => {
      more.remove();
      appendCards(matches.slice(RELATED_ARTICLES_PREVIEW_LIMIT));
    });
    list.append(more);
  }

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  });
  panel.append(header, actions, list);
  return panel;
}

function renderRelationshipRanking(relationships) {
  els.relationshipList.replaceChildren();
  const visible = relationships.slice(0, 12);
  if (!visible.length) {
    const empty = document.createElement("p"); empty.className = "chart-empty"; empty.textContent = "目前沒有足夠資料計算穩定關聯。"; els.relationshipList.append(empty); return;
  }
  visible.forEach((item) => {
    const row = document.createElement("button"); row.type = "button"; row.className = "relationship-row";
    const pair = document.createElement("span"); pair.className = "relation-pair";
    pair.textContent = state.selectedTags.length === 2 ? `${state.selectedTags.join(" × ")} → ${item.target}` : item.tags.join(" × ");
    const score = document.createElement("strong"); score.className = "relation-score"; score.textContent = item.score;
    const meta = document.createElement("span"); meta.className = "relation-meta";
    const support = document.createElement("span"); support.textContent = `共同 ${item.support} 篇`;
    meta.append(support);
    if (item.lowSample) { const low = document.createElement("span"); low.className = "low-sample"; low.textContent = "低樣本"; meta.append(low); }
    row.append(pair, score, meta);
    row.addEventListener("click", () => {
      if (!state.selectedTags.length) state.selectedTags = item.tags.slice(0, 2);
      else if (state.selectedTags.length === 1) state.selectedTags = [state.selectedTags[0], item.target];
      else state.selectedTags = [state.selectedTags[0], item.target];
      renderAll();
    });
    els.relationshipList.append(row);
  });
}

function renderRelationships(articles, stats, relationships) {
  const range = scopeTitle(state.relationshipScope, state.relationshipIssue);
  if (!state.selectedTags.length) {
    els.relationshipTitle.textContent = "tag 關聯網絡"; els.analysisMode.textContent = range; els.rankingTitle.textContent = "最強關聯組合";
    els.relationshipDescription.textContent = `${range}中，顯示比隨機預期更常一起出現在同篇文章的 tag。點圓球可列出相關文章。`;
  } else if (state.selectedTags.length === 1) {
    els.relationshipTitle.textContent = `「${state.selectedTags[0]}」的相關主題`; els.analysisMode.textContent = range; els.rankingTitle.textContent = "相關 tag";
    els.relationshipDescription.textContent = `${range}中，查看「${state.selectedTags[0]}」與其他 tag 的關聯強度。點選另一個圓球可列出兩者的共同文章。`;
  } else {
    els.relationshipTitle.textContent = `「${state.selectedTags.join("」與「")}」的共同文章`; els.analysisMode.textContent = range; els.rankingTitle.textContent = "共同文章的相關 tag";
    els.relationshipDescription.textContent = `${range}中，黑色節點代表同時包含「${state.selectedTags.join("」與「")}」的文章；外圍節點顯示這些文章還常和哪些 tag 一起出現。`;
  }
  renderNetwork(articles, stats, relationships);
  renderRelationshipRanking(relationships);
  renderRelatedArticles(articles);
}

function articleIndexUrl(tags, title = "") {
  const query = new URLSearchParams();
  tags.forEach((tag) => query.append("tag", tag));
  if (title) query.set("q", title);
  return `./index.html?${query.toString()}#articles`;
}

function createRelatedArticleCard(article, cardTags = state.selectedTags) {
  const item = document.createElement("article");
  item.className = "related-article-card";

  const meta = document.createElement("p");
  meta.className = "related-article-meta";
  meta.textContent = [issueTitle(issueDate(article)), article.categoryZh || article.section].filter(Boolean).join("｜");

  const title = document.createElement("h4");
  title.textContent = article.titleEn || "Untitled";

  const rubric = document.createElement("p");
  rubric.className = "related-article-rubric";
  rubric.textContent = article.rubricEn || "";
  rubric.hidden = !article.rubricEn;

  const summary = document.createElement("p");
  summary.className = "related-article-summary";
  summary.textContent = article.summaryZh || "這篇文章目前沒有中文摘要，可前往文章索引查看英文全文。";

  const tags = document.createElement("div");
  tags.className = "related-article-tags";
  cardTags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.textContent = tag;
    tags.append(chip);
  });

  const actions = document.createElement("div");
  actions.className = "related-article-links";
  const indexLink = document.createElement("a");
  indexLink.href = articleIndexUrl(cardTags, article.titleEn || "");
  indexLink.textContent = "查看站內文章";
  actions.append(indexLink);
  if (article.sourceUrl) {
    const sourceLink = document.createElement("a");
    sourceLink.href = article.sourceUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceLink.textContent = "英文原文 ↗";
    actions.append(sourceLink);
  }

  item.append(meta, title, rubric, summary, tags, actions);
  return item;
}

function renderRelatedArticles(articles) {
  els.relatedArticlesList.replaceChildren();
  els.relatedArticlesActions.replaceChildren();

  if (state.selectedTags.length < 2) {
    els.relatedArticlesTitle.textContent = "共同文章";
    els.relatedArticlesDescription.textContent = state.selectedTags.length
      ? `再選一個 tag，即可列出與「${state.selectedTags[0]}」同時出現的文章。`
      : "選擇兩個 tag 後，這裡會列出同時包含兩者的文章。";
    const empty = document.createElement("p");
    empty.className = "related-articles-empty";
    empty.textContent = state.selectedTags.length ? "還差一個 tag" : "尚未選擇分析組合";
    els.relatedArticlesList.append(empty);
    return;
  }

  const matches = articles
    .filter((article) => state.selectedTags.every((tag) => (article.keywordsZh || []).includes(tag)))
    .sort((a, b) => issueDate(b).localeCompare(issueDate(a)) || (a.titleEn || "").localeCompare(b.titleEn || ""));
  const pair = `「${state.selectedTags.join("」與「")}」`;
  els.relatedArticlesTitle.textContent = `${pair}共同文章・${matches.length} 篇`;
  els.relatedArticlesDescription.textContent = `列出${scopeTitle(state.relationshipScope, state.relationshipIssue)}中，同時包含${pair}的文章。`;

  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "related-articles-empty";
    empty.textContent = "這個資料範圍沒有同時包含兩個 tag 的文章。";
    els.relatedArticlesList.append(empty);
    return;
  }

  const appendCards = (items) => items.forEach((article) => els.relatedArticlesList.append(createRelatedArticleCard(article)));
  appendCards(matches.slice(0, RELATED_ARTICLES_PREVIEW_LIMIT));

  if (matches.length > RELATED_ARTICLES_PREVIEW_LIMIT) {
    const showAll = document.createElement("button");
    showAll.type = "button";
    showAll.className = "related-articles-more";
    showAll.textContent = `顯示其餘 ${matches.length - RELATED_ARTICLES_PREVIEW_LIMIT} 篇`;
    showAll.addEventListener("click", () => {
      appendCards(matches.slice(RELATED_ARTICLES_PREVIEW_LIMIT));
      showAll.remove();
    });
    els.relatedArticlesActions.append(showAll);
  }

  const indexLink = document.createElement("a");
  indexLink.className = "related-articles-index-link";
  indexLink.href = articleIndexUrl(state.selectedTags);
  indexLink.textContent = "在文章索引延伸搜尋 →";
  els.relatedArticlesActions.append(indexLink);
}

function cloudFontSize(item, minCount, maxCount, cloudWidth) {
  const ratio = maxCount === minCount ? .5 : (Math.sqrt(item.count) - Math.sqrt(minCount)) / (Math.sqrt(maxCount) - Math.sqrt(minCount));
  const scale = Math.max(.48, Math.min(1, cloudWidth / 980));
  return Math.max(8, (13 + ratio * 39) * scale);
}

function layoutCloudWords(buttons) {
  if (!buttons.length || buttons.some((button) => !button.isConnected)) return;
  const width = els.keywordCloud.clientWidth || 900;
  const height = els.keywordCloud.clientHeight || 540;
  const boxes = [];
  const padding = width < 600 ? 3 : 6;
  const spiralY = Math.min(.82, height / Math.max(1, width));
  buttons.forEach((button, index) => {
    const wordWidth = button.offsetWidth + padding * 2;
    const wordHeight = button.offsetHeight + padding * 2;
    let placed = null;
    for (let step = 0; step < 2400; step += 1) {
      const angle = step * .31;
      const radius = index === 0 ? 0 : step * (width < 600 ? .17 : .29);
      const x = width / 2 + Math.cos(angle) * radius;
      const y = height / 2 + Math.sin(angle) * radius * spiralY;
      const candidate = { left: x - wordWidth / 2, right: x + wordWidth / 2, top: y - wordHeight / 2, bottom: y + wordHeight / 2, x, y };
      if (candidate.left < 10 || candidate.right > width - 10 || candidate.top < 10 || candidate.bottom > height - 10) continue;
      const collision = boxes.some((box) => candidate.left < box.right && candidate.right > box.left && candidate.top < box.bottom && candidate.bottom > box.top);
      if (!collision) { placed = candidate; break; }
    }
    if (!placed) {
      const angle = index * 2.399963;
      const radius = Math.min(width, height) * (.28 + (index % 6) * .045);
      placed = { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius * .75, left: 0, right: 0, top: 0, bottom: 0 };
      button.style.opacity = ".55";
    } else boxes.push(placed);
    button.style.left = `${placed.x}px`; button.style.top = `${placed.y}px`;
    button.dataset.baseX = placed.x; button.dataset.baseY = placed.y;
    button.style.visibility = "visible";
  });
}

function resetCloudDrift() {
  els.keywordCloud.querySelectorAll(".cloud-word").forEach((button) => { button.style.setProperty("--drift-x", "0px"); button.style.setProperty("--drift-y", "0px"); });
}

function updateCloudMagnet(event) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(pointer: coarse)").matches) return;
  if (state.cloudFrame) cancelAnimationFrame(state.cloudFrame);
  state.cloudFrame = requestAnimationFrame(() => {
    const rect = els.keywordCloud.getBoundingClientRect();
    const cursorX = event.clientX - rect.left, cursorY = event.clientY - rect.top;
    els.keywordCloud.querySelectorAll(".cloud-word").forEach((button) => {
      const baseX = Number(button.dataset.baseX), baseY = Number(button.dataset.baseY);
      const dx = cursorX - baseX, dy = cursorY - baseY, distance = Math.hypot(dx, dy);
      const influence = Math.max(0, 1 - distance / 190);
      button.style.setProperty("--drift-x", `${dx * influence * .075}px`);
      button.style.setProperty("--drift-y", `${dy * influence * .075}px`);
    });
  });
}

function renderCloud(articles, stats) {
  els.keywordCloud.replaceChildren();
  const cloudWidth = els.keywordCloud.clientWidth || innerWidth;
  const itemLimit = cloudWidth < 480 ? 34 : cloudWidth < 760 ? 42 : 52;
  const items = stats.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, itemLimit);
  if (!items.length) return;
  const statsByTag = statsMapFor(stats), counts = items.map((item) => item.count), min = Math.min(...counts), max = Math.max(...counts);
  const cloudTrendFormatter = (trend) => previousCloudScopeKey() ? trendText(trend) : "無比較基準";
  const buttons = items.map((item) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "cloud-word"; button.dataset.tag = item.tag;
    button.dataset.trendLevel = trendLevel(item.trend); button.style.fontSize = `${cloudFontSize(item, min, max, cloudWidth)}px`; button.style.visibility = "hidden";
    button.classList.toggle("selected", state.selectedTags.includes(item.tag)); button.textContent = item.tag;
    const trendLabel = cloudTrendFormatter(item.trend);
    button.setAttribute("aria-label", `${item.tag}，${item.count} 篇，${trendLabel}`);
    button.addEventListener("click", () => toggleFocusTag(item.tag));
    button.addEventListener("pointerenter", (event) => highlightTag(item.tag, event, articles, statsByTag, cloudTrendFormatter));
    button.addEventListener("pointermove", positionTooltip); button.addEventListener("pointerleave", clearTagHighlights);
    button.addEventListener("focus", (event) => highlightTag(item.tag, event, articles, statsByTag, cloudTrendFormatter)); button.addEventListener("blur", clearTagHighlights);
    els.keywordCloud.append(button); return button;
  });
  requestAnimationFrame(() => layoutCloudWords(buttons));
  els.keywordCloud.onpointermove = updateCloudMagnet;
  els.keywordCloud.onpointerleave = () => { resetCloudDrift(); clearTagHighlights(); };
}

function renderCloudComparisonStatus(articles, previousKey) {
  const hasPrevious = Boolean(previousKey);
  els.trendFlatLabel.textContent = hasPrevious ? "持平" : "無比較基準";
  els.cloudComparisonStatus.classList.toggle("no-baseline", !hasPrevious);
  if (state.cloudScope === "all") {
    els.cloudComparisonStatus.textContent = `全部資料：合併 ${state.issues.length} 期、共 ${articles.length} 篇文章。因為沒有單一前期，顏色統一表示無比較基準。`;
    return;
  }
  if (!hasPrevious) {
    const unit = state.cloudScope === "month" ? "月份" : "期數";
    els.cloudComparisonStatus.textContent = `這是資料庫最早${unit}，沒有前一個範圍可比較；灰色不代表趨勢持平。`;
    return;
  }
  if (state.cloudScope === "month") {
    els.cloudComparisonStatus.textContent = `每月比較：顏色比較 ${monthTitle(previousKey)} 與 ${monthTitle(state.cloudIssue)} 的文章占比。相對增減未達 10% 時標為持平。`;
    return;
  }
  els.cloudComparisonStatus.textContent = `每期比較：顏色比較 ${issueTitle(previousKey)} 與 ${issueTitle(state.cloudIssue)} 的文章占比。相對增減未達 10% 時標為持平。`;
}

function createTopTagRow(tag) {
  const row = document.createElement("li");
  row.className = "top-tag-row";
  row.dataset.tag = tag;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "top-tag-button";
  const rank = document.createElement("b"); rank.className = "top-tag-rank";
  const tagLabel = document.createElement("strong"); tagLabel.className = "top-tag-label";
  const barTrack = document.createElement("span"); barTrack.className = "top-tag-track";
  const bar = document.createElement("i"); barTrack.append(bar);
  const metrics = document.createElement("span"); metrics.className = "top-tag-metrics";
  const count = document.createElement("b"); count.className = "top-tag-count";
  const rate = document.createElement("span"); rate.className = "top-tag-rate";
  const trend = document.createElement("span"); trend.className = "top-tag-trend";
  metrics.append(count, rate, trend);
  button.append(rank, tagLabel, barTrack, metrics);
  button.addEventListener("click", () => {
    state.selectedTags = [row.dataset.tag];
    renderAll();
    document.querySelector("#relationship-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  row.append(button);
  return row;
}

function updateTopTagRow(row, item, index, totalArticles, isNew) {
  const rateValue = item.rate ?? ((item.count / Math.max(1, totalArticles)) * 100);
  const previousRank = Number(row.dataset.rank || 0);
  const nextRank = index + 1;
  row.dataset.rank = nextRank;
  row.dataset.movement = previousRank && nextRank < previousRank ? "up" : previousRank && nextRank > previousRank ? "down" : "flat";
  const button = row.querySelector(".top-tag-button");
  button.setAttribute("aria-label", `第 ${nextRank} 名，${item.tag}，${item.count.toFixed(0)} 篇，占${state.topScope === "month" ? "當月" : "當期"} ${rateValue.toFixed(1)}%`);
  row.querySelector(".top-tag-rank").textContent = String(nextRank).padStart(2, "0");
  row.querySelector(".top-tag-label").textContent = item.tag;
  row.querySelector(".top-tag-count").textContent = `${item.count.toFixed(0)} 篇`;
  row.querySelector(".top-tag-rate").textContent = `${rateValue.toFixed(1)}%`;
  const trend = row.querySelector(".top-tag-trend");
  trend.className = `top-tag-trend ${directionFor(item.trend)}`;
  trend.textContent = trendTextForSelection(item.trend);
  const bar = row.querySelector(".top-tag-track i");
  row.dataset.nextBarWidth = `${Math.min(100, (rateValue / 45) * 100)}%`;
  if (isNew) bar.style.width = "0%";
}

function paintTopTags(items, totalArticles, label) {
  const visible = items
    .filter((item) => item.count > .05)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hant"))
    .slice(0, 15);
  els.topTagsIssue.textContent = label;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targetTags = new Set(visible.map((item) => item.tag));
  const currentRows = [...els.topTagsRanking.querySelectorAll(".top-tag-row")];
  currentRows.forEach((row) => row.getAnimations?.().forEach((animation) => animation.finish()));
  const existing = new Map(currentRows.map((row) => [row.dataset.tag, row]));
  const oldRects = new Map(currentRows.map((row) => [row.dataset.tag, row.getBoundingClientRect()]));
  const listRect = els.topTagsRanking.getBoundingClientRect();

  currentRows.filter((row) => !targetTags.has(row.dataset.tag)).forEach((row) => {
    if (reduceMotion) { row.remove(); return; }
    const rect = oldRects.get(row.dataset.tag);
    row.classList.add("rank-leaving");
    Object.assign(row.style, { position: "absolute", left: `${rect.left - listRect.left}px`, top: `${rect.top - listRect.top}px`, width: `${rect.width}px`, zIndex: "1" });
    const exitDistance = Math.max(44, listRect.bottom - rect.bottom);
    const animation = row.animate(
      [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${exitDistance}px)`, opacity: 0 }],
      { duration: 520, easing: "cubic-bezier(.35,0,.2,1)", fill: "forwards" },
    );
    animation.finished.finally(() => row.remove());
  });

  const rendered = visible.map((item, index) => {
    const isNew = !existing.has(item.tag);
    const row = existing.get(item.tag) || createTopTagRow(item.tag);
    updateTopTagRow(row, item, index, totalArticles, isNew);
    row.style.position = ""; row.style.left = ""; row.style.top = ""; row.style.width = ""; row.style.zIndex = "";
    row.classList.remove("rank-leaving");
    els.topTagsRanking.append(row);
    return { row, isNew };
  });

  requestAnimationFrame(() => {
    rendered.forEach(({ row, isNew }) => {
      const bar = row.querySelector(".top-tag-track i");
      bar.style.width = row.dataset.nextBarWidth;
      if (reduceMotion) return;
      if (isNew) {
        const current = row.getBoundingClientRect();
        const updatedList = els.topTagsRanking.getBoundingClientRect();
        const entryDistance = Math.max(54, updatedList.bottom - current.bottom);
        row.animate(
          [{ transform: `translateY(${entryDistance}px)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
          { duration: 620, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
        );
        return;
      }
      const previous = oldRects.get(row.dataset.tag);
      const current = row.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      row.animate(
        [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }],
        { duration: 720, easing: "cubic-bezier(.22,.8,.25,1)", fill: "both" },
      );
    });
  });
}

function renderTopTags(articles, stats) {
  const label = state.topScope === "month"
    ? `${monthTitle(state.issue)}｜${state.issues.filter((issue) => issue.startsWith(`${state.issue}.`)).length} 期｜共 ${articles.length} 篇`
    : `${issueTitle(state.issue)}｜${issueRange(state.issue, true)}｜共 ${articles.length} 篇`;
  paintTopTags(
    stats.map((item) => ({ ...item, rate: (item.count / Math.max(1, articles.length)) * 100 })),
    articles.length,
    label,
  );
}

function renderTopModule() {
  const keys = topKeys();
  if (!keys.includes(state.issue)) state.issue = keys[0] || "";
  const articles = articlesForScope(state.topScope, state.issue);
  const stats = tagStatistics(articles, periodsFor(articles), true, "");
  const previousIndex = keys.indexOf(state.issue) - 1;
  const previousArticles = previousIndex >= 0 ? articlesForScope(state.topScope, keys[previousIndex]) : [];
  stats.forEach((item) => {
    const currentRate = articles.length ? (item.count / articles.length) * 100 : 0;
    const previousRate = previousArticles.length ? (countContaining(previousArticles, [item.tag]) / previousArticles.length) * 100 : 0;
    item.trend = previousIndex >= 0 ? trendFor([previousRate, currentRate]) : { delta: 0, percent: 0, recent: currentRate, previous: 0 };
  });
  renderRangeControls(els.topScope, els.topPeriod, els.topPeriodLabel, state.topScope, state.issue);
  renderIssuePicker();
  renderPlaybackState();
  renderTopTags(articles, stats);
  syncUrl();
}

function overviewStatistics() {
  const articles = articlesForScope(state.overviewScope, state.overviewIssue);
  const periods = periodsFor(articles);
  const stats = tagStatistics(articles, periods, true, "");
  if (state.overviewScope === "all") {
    return { articles, periods, stats, previousKey: state.issues.at(-2) || "" };
  }

  const keys = state.overviewScope === "month" ? state.months : state.issues;
  const index = keys.indexOf(state.overviewIssue);
  const previousKey = index > 0 ? keys[index - 1] : "";
  const previousArticles = previousKey ? articlesForScope(state.overviewScope, previousKey) : [];
  stats.forEach((item) => {
    const currentRate = articles.length ? (item.count / articles.length) * 100 : 0;
    const previousRate = previousArticles.length ? (countContaining(previousArticles, [item.tag]) / previousArticles.length) * 100 : 0;
    item.trend = previousKey ? trendFor([previousRate, currentRate]) : { delta: 0, percent: 0, recent: currentRate, previous: 0 };
  });
  return { articles, periods, stats, previousKey };
}

function renderOverviewModule() {
  const { articles, periods, stats, previousKey } = overviewStatistics();
  renderOverviewControls();
  renderTagOverview(articles, stats, previousKey);
  renderSignals(articles, periods, stats, relationshipsFor(articles), previousKey);
  syncUrl();
}

function syncRelationshipWithOverview() {
  state.relationshipScope = state.overviewScope;
  state.relationshipIssue = state.overviewIssue;
  state.relationshipRenderKey = "";
}

function renderCloudModule() {
  const { articles, stats, previousKey } = cloudStatistics();
  renderCloudControls();
  renderCloudComparisonStatus(articles, previousKey);
  renderCloud(articles, stats);
  syncUrl();
}

function renderAll() {
  hideCalculationHelp();
  renderIndependentIssueControls();
  renderOverviewModule();
  renderRelationshipPanel();
  renderCloudModule();
  renderTopModule();
  syncUrl();
}

els.clearFocus.addEventListener("click", () => { state.selectedTags = []; renderAll(); });
els.overviewSearch.addEventListener("input", () => { state.overviewQuery = els.overviewSearch.value; renderOverviewModule(); });
els.overviewSort.addEventListener("change", () => { state.overviewSort = els.overviewSort.value; renderOverviewModule(); });
els.overviewScope.addEventListener("change", () => {
  state.overviewScope = els.overviewScope.value;
  state.overviewIssue = state.overviewScope === "all" ? "all" : state.overviewScope === "month" ? state.months.at(-1) : state.issues.at(-1);
  syncRelationshipWithOverview();
  renderOverviewModule();
  renderRelationshipPanel();
  syncUrl();
});
els.overviewIssue.addEventListener("change", () => {
  state.overviewIssue = els.overviewIssue.value;
  syncRelationshipWithOverview();
  renderOverviewModule();
  renderRelationshipPanel();
  syncUrl();
});
els.relationshipScope.addEventListener("change", () => {
  state.relationshipScope = els.relationshipScope.value;
  state.relationshipIssue = state.relationshipScope === "all" ? "all" : state.relationshipScope === "month" ? state.months.at(-1) : state.issues.at(-1);
  state.relationshipRenderKey = "";
  renderRelationshipPanel();
  syncUrl();
});
els.relationshipIssue.addEventListener("change", () => { state.relationshipIssue = els.relationshipIssue.value; renderRelationshipPanel(); syncUrl(); });
els.cloudScope.addEventListener("change", () => {
  state.cloudScope = els.cloudScope.value;
  state.cloudIssue = state.cloudScope === "all" ? "all" : state.cloudScope === "month" ? state.months.at(-1) : state.issues.at(-1);
  renderCloudModule();
});
els.cloudIssue.addEventListener("change", () => { state.cloudIssue = els.cloudIssue.value; renderCloudModule(); });
els.topScope.addEventListener("change", () => {
  state.topScope = els.topScope.value;
  state.issue = topKeys().at(-1) || "";
  state.autoPlay = false;
  clearPlaybackTimer();
  renderTopModule();
});
els.topPeriod.addEventListener("change", () => pauseAtIssue(els.topPeriod.value));
els.topPrevious.addEventListener("click", () => stepTopIssue(-1));
els.topNext.addEventListener("click", () => stepTopIssue(1));
els.playbackToggle.addEventListener("click", () => {
  if (state.autoPlay) {
    state.autoPlay = false;
    clearPlaybackTimer();
    renderTopModule();
  } else startPlayback();
});
els.tourLaunch.addEventListener("click", () => showTourStep(0));
els.tourClose.addEventListener("click", closeFeatureTour);
els.tourPrevious.addEventListener("click", () => showTourStep(tourStepIndex - 1));
els.tourNext.addEventListener("click", () => {
  if (tourStepIndex >= TOUR_STEPS.length - 1) closeFeatureTour();
  else showTourStep(tourStepIndex + 1);
});
els.featureTour.addEventListener("click", (event) => { if (event.target === els.featureTour) closeFeatureTour(); });
let networkResizeTimer = null;
window.addEventListener("resize", () => {
  positionTourStep();
  if (!state.data) return;
  clearTimeout(networkResizeTimer);
  networkResizeTimer = setTimeout(() => {
    if (Math.abs(measureGraphHeight() - GRAPH_HEIGHT) / GRAPH_HEIGHT < .12) return;
    state.relationshipRenderKey = "";
    renderRelationshipPanel();
  }, 250);
  hideCalculationHelp();
  const { articles, stats } = cloudStatistics();
  renderCloud(articles, stats);
});
window.addEventListener("scroll", () => { hideCalculationHelp(); positionTourStep(); }, { passive: true });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.featureTour.hidden) closeFeatureTour();
  else state.closeNetworkPanel?.();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearPlaybackTimer();
  else if (state.autoPlay) schedulePlayback();
});

async function loadPublicCatalog() {
  try {
    const manifestResponse = await fetch("./data/public-manifest.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const response = await fetch(`./data/${manifest.catalog.path}?v=${encodeURIComponent(manifest.catalog.version || "1")}`);
    if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
    return response.json();
  } catch {
    const response = await fetch("./data/articles.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
}

loadPublicCatalog()
  .then((data) => {
    state.data = data;
    state.issues = [...new Set(data.articles.map(issueDate).filter(Boolean))].sort();
    state.months = [...new Set(state.issues.map((issue) => issue.slice(0, 7)))].sort();
    const initialTopKeys = topKeys();
    if (!initialTopKeys.includes(state.issue)) state.issue = "";
    if (state.topScope === "issue" && !state.issue && (state.legacyFrom || state.legacyTo)) {
      const from = state.legacyFrom || state.issues[0].replaceAll(".", "-");
      const to = state.legacyTo || state.issues.at(-1).replaceAll(".", "-");
      const matched = state.issues.filter((issue) => { const date = issue.replaceAll(".", "-"); return date >= from && date <= to; });
      if (matched.length === 1) { state.issue = matched[0]; state.autoPlay = false; }
    }
    if (!state.issue) { state.issue = initialTopKeys[0] || ""; state.autoPlay = true; }
    if (state.relationshipScope === "all") state.relationshipIssue = "all";
    else if (state.relationshipScope === "month") {
      if (!state.months.includes(state.relationshipIssue)) state.relationshipIssue = state.months.at(-1) || "";
    } else if (!state.issues.includes(state.relationshipIssue)) state.relationshipIssue = state.issues.at(-1) || state.issue;
    if (state.overviewScope === "all") state.overviewIssue = "all";
    else if (state.overviewScope === "month") {
      if (!state.months.includes(state.overviewIssue)) state.overviewIssue = state.months.at(-1) || "";
    } else if (!state.issues.includes(state.overviewIssue)) state.overviewIssue = state.issues.at(-1) || state.issue;
    if (state.cloudScope === "all") state.cloudIssue = "all";
    else if (state.cloudScope === "month") {
      if (!state.months.includes(state.cloudIssue)) state.cloudIssue = state.months.at(-1) || "";
    } else if (!state.issues.includes(state.cloudIssue)) state.cloudIssue = state.issues.at(-1) || state.issue;
    state.allTags = [...new Set(data.articles.flatMap((article) => article.keywordsZh || []))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    state.selectedTags = state.selectedTags.filter((tag) => state.allTags.includes(tag)).slice(0, 2);
    renderStaticCalculationHelp();
    renderAll();
    schedulePlayback();
  })
  .catch(() => { els.signalCards.innerHTML = '<div class="chart-empty"><strong>資料暫時無法載入</strong><p>請稍後重新整理頁面。</p></div>'; });
