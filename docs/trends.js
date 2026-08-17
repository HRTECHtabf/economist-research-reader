const params = new URLSearchParams(location.search);
const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  data: null,
  issue: params.get("issue") || "",
  legacyFrom: params.get("from") || "",
  legacyTo: params.get("to") || "",
  selectedTags: [...new Set(params.getAll("tag").map((tag) => tag.trim()).filter(Boolean))].slice(0, 2),
  issues: [],
  allTags: [],
  overviewQuery: "",
  overviewSort: "count",
  detailTag: params.get("detail") || "",
  cloudFrame: null,
};

const els = {
  issuePicker: document.querySelector("#issue-picker"),
  dataRangeLabel: document.querySelector("#data-range-label"),
  selectedTagList: document.querySelector("#selected-tag-list"),
  clearFocus: document.querySelector("#clear-focus"),
  overviewSearch: document.querySelector("#tag-overview-search"),
  overviewSort: document.querySelector("#tag-overview-sort"),
  overviewCount: document.querySelector("#tag-overview-count"),
  overviewGrid: document.querySelector("#tag-overview-grid"),
  signalCards: document.querySelector("#signal-cards"),
  relationshipTitle: document.querySelector("#relationship-title"),
  relationshipDescription: document.querySelector("#relationship-description"),
  analysisMode: document.querySelector("#analysis-mode"),
  rankingTitle: document.querySelector("#ranking-title"),
  relationshipNetwork: document.querySelector("#relationship-network"),
  relationshipList: document.querySelector("#relationship-list"),
  relationshipHelp: document.querySelector("#relationship-help"),
  keywordCloud: document.querySelector("#keyword-cloud"),
  cloudHelp: document.querySelector("#cloud-help"),
  trendFlatLabel: document.querySelector("#trend-flat-label"),
  cloudComparisonStatus: document.querySelector("#cloud-comparison-status"),
  detailTagSelect: document.querySelector("#detail-tag-select"),
  detailArticleLink: document.querySelector("#detail-article-link"),
  detailSummary: document.querySelector("#tag-detail-summary"),
  detailChart: document.querySelector("#tag-detail-chart"),
  detailHelp: document.querySelector("#detail-help"),
  tooltip: document.querySelector("#tag-tooltip"),
  calculationTooltip: document.querySelector("#calculation-tooltip"),
};

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
    "先用 NPMI 比較實際共同出現是否高於隨機預期，再依共同文章數折減小樣本，最後轉成 0–100。雙 tag 模式會先把兩個 tag 的交集視為一個主題，再與第三個 tag 比較。分數不是機率、重要性或因果關係。",
  ));
  els.cloudHelp.replaceChildren(createCalculationHelp(
    "關鍵字雲怎麼算？",
    "字體大小依 tag 文章數做平方根縮放，出現愈多就愈靠近中心。顏色比較 tag 在當期文章中的占比與前一期占比；最早一期沒有比較基準，因此灰色代表無前期資料。",
  ));
  els.detailHelp.replaceChildren(createCalculationHelp(
    "單一 tag 趨勢怎麼算？",
    "各期占比＝含有此 tag 的文章數 ÷ 該期文章總數。較前一期的變化＝當期占比減前一期占比，單位是百分點；用占比可避免各期收錄篇數不同造成誤判。",
  ));
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

function articlesInWindow() {
  return state.issue ? state.data.articles.filter((article) => issueDate(article) === state.issue) : state.data.articles;
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

function tagStatistics(articles, periods, includeAll = false) {
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
    if (state.issue) {
      const issueIndex = state.issues.indexOf(state.issue);
      const previousIssue = issueIndex > 0 ? state.issues[issueIndex - 1] : "";
      const currentArticles = state.data.articles.filter((article) => issueDate(article) === state.issue);
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

function trendTextForSelection(trend) {
  return state.issue === state.issues[0] ? "無前期資料" : trendText(trend);
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
  if (state.issue) next.set("issue", state.issue);
  for (const tag of state.selectedTags) next.append("tag", tag);
  if (state.detailTag && state.detailTag !== state.selectedTags[0]) next.set("detail", state.detailTag);
  const query = next.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

function toggleFocusTag(tag) {
  if (!state.allTags.includes(tag)) return;
  if (state.selectedTags.includes(tag)) state.selectedTags = state.selectedTags.filter((item) => item !== tag);
  else if (state.selectedTags.length < 2) { state.selectedTags = [...state.selectedTags, tag]; state.detailTag = tag; }
  else { state.selectedTags = [tag]; state.detailTag = tag; }
  renderAll();
}

function renderIssuePicker() {
  els.issuePicker.replaceChildren();
  const counts = new Map(state.issues.map((issue) => [issue, state.data.articles.filter((article) => issueDate(article) === issue).length]));
  const choices = ["", ...state.issues];
  choices.forEach((issue) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "issue-choice";
    button.classList.toggle("selected", state.issue === issue);
    button.setAttribute("aria-pressed", String(state.issue === issue));
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    if (issue) {
      title.textContent = issueTitle(issue);
      meta.textContent = `${issueRange(issue)}｜${counts.get(issue)} 篇`;
    } else {
      title.textContent = "全部期數";
      const first = issueCoverage(state.issues[0]);
      const latest = issueCoverage(state.issues.at(-1));
      meta.textContent = `${shortDate(first.start)}–${shortDate(latest.end)}｜${state.issues.length} 期`;
    }
    button.append(title, meta);
    button.addEventListener("click", () => { state.issue = issue; renderAll(); });
    els.issuePicker.append(button);
  });
  requestAnimationFrame(() => {
    if (state.issues.length <= 4) return;
    const activeButton = els.issuePicker.querySelector(".issue-choice.selected");
    if (state.issue && activeButton) {
      els.issuePicker.scrollLeft = Math.max(0, activeButton.offsetLeft - (els.issuePicker.clientWidth - activeButton.offsetWidth) / 2);
    } else {
      els.issuePicker.scrollLeft = els.issuePicker.scrollWidth;
    }
  });
}

function renderSelectedTags() {
  els.selectedTagList.replaceChildren();
  els.clearFocus.hidden = !state.selectedTags.length;
  if (!state.selectedTags.length) {
    const empty = document.createElement("span");
    empty.textContent = "尚未選擇，顯示全站最強關聯";
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

function highlightTag(tag, event, articles, statsByTag) {
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
  details.textContent = `${stat?.count || 0} 篇 · ${trendTextForSelection(stat?.trend || { percent: 0 })}｜主要關聯：${topRelated}`;
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

function renderTagOverview(articles, stats) {
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
    button.addEventListener("pointerenter", (event) => highlightTag(item.tag, event, articles, statsByTag));
    button.addEventListener("pointermove", positionTooltip);
    button.addEventListener("pointerleave", clearTagHighlights);
    button.addEventListener("focus", (event) => highlightTag(item.tag, event, articles, statsByTag));
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

function renderSignals(articles, periods, stats, relationships) {
  els.signalCards.replaceChildren();
  const activeTags = stats.filter((item) => item.count > 0);
  appendSignalCard("觀測期數", state.issue ? "1 期" : `${periods.length} 期`, state.issue ? `${issueTitle(state.issue)}｜${issueRange(state.issue, true)}` : `${issueTitle(state.issues[0])}至 ${issueTitle(state.issues.at(-1))}`);
  appendSignalCard("涵蓋文章", `${articles.length} 篇`, `目前期間共涵蓋 ${activeTags.length} 個 tag`, false, {
    title: "涵蓋文章怎麼算？",
    body: "文章數是目前所選期數的文章總數；tag 數會把這些文章使用過的 tag 去除重複後計算。",
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
  appendSignalCard(state.issue ? "較前一期升溫" : "近期升溫", rising?.tag || "資料不足", rising ? `${trendText(rising.trend)}；目前範圍出現 ${rising.count} 篇` : state.issue === state.issues[0] ? "最早一期沒有前期資料可比較" : "目前沒有明顯升溫的 tag", false, {
    title: "升溫怎麼算？",
    body: "先算每個 tag 在當期文章中的占比，再與前一期占比比較；卡片挑出占比增加最多的 tag。百分比表示相對增幅，不是增加的文章篇數。",
  });
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function graphData(articles, stats, relationships) {
  const counts = new Map(stats.map((item) => [item.tag, item.count]));
  const limited = relationships.slice(0, state.selectedTags.length ? 8 : 6);
  const nodes = [];
  const edges = [];
  if (!state.selectedTags.length) {
    limited.forEach((item, index) => {
      const left = { id: `pair-${index}-a`, tag: item.tags[0], count: counts.get(item.tags[0]) || 0 };
      const right = { id: `pair-${index}-b`, tag: item.tags[1], count: counts.get(item.tags[1]) || 0 };
      nodes.push(left, right);
      edges.push({ a: left.id, b: right.id, score: item.score, support: item.support });
    });
  } else if (state.selectedTags.length === 1) {
    const focus = { id: "focus", tag: state.selectedTags[0], count: counts.get(state.selectedTags[0]) || 0, selected: true };
    nodes.push(focus);
    limited.forEach((item, index) => {
      const target = { id: `target-${index}`, tag: item.target, count: counts.get(item.target) || 0 };
      nodes.push(target);
      edges.push({ a: focus.id, b: target.id, score: item.score, support: item.support });
    });
  } else {
    const pairSupport = countContaining(articles, state.selectedTags);
    const first = { id: "focus-a", tag: state.selectedTags[0], count: counts.get(state.selectedTags[0]) || 0, selected: true };
    const second = { id: "focus-b", tag: state.selectedTags[1], count: counts.get(state.selectedTags[1]) || 0, selected: true };
    const compound = { id: "compound", tag: "共同文章", count: pairSupport, compound: true };
    nodes.push(first, second, compound);
    edges.push({ a: first.id, b: compound.id, score: 0, support: pairSupport, structural: true });
    edges.push({ a: second.id, b: compound.id, score: 0, support: pairSupport, structural: true });
    limited.slice(0, 6).forEach((item, index) => {
      const target = { id: `target-${index}`, tag: item.target, count: counts.get(item.target) || 0 };
      nodes.push(target);
      edges.push({ a: compound.id, b: target.id, score: item.score, support: item.support });
    });
  }
  return { nodes, edges };
}

function layoutGraph(nodes) {
  if (!state.selectedTags.length) {
    nodes.forEach((node, index) => {
      const row = Math.floor(index / 2);
      node.x = index % 2 ? 745 : 255;
      node.y = 48 + row * 80;
    });
  } else if (state.selectedTags.length === 1) {
    const focus = nodes.find((node) => node.id === "focus");
    focus.x = 245; focus.y = 250;
    const targets = nodes.filter((node) => node.id !== "focus");
    targets.forEach((node, index) => { node.x = 735; node.y = 38 + index * (424 / Math.max(1, targets.length - 1)); });
  } else {
    nodes.find((node) => node.id === "focus-a").x = 285;
    nodes.find((node) => node.id === "focus-a").y = 62;
    nodes.find((node) => node.id === "focus-b").x = 715;
    nodes.find((node) => node.id === "focus-b").y = 62;
    nodes.find((node) => node.id === "compound").x = 500;
    nodes.find((node) => node.id === "compound").y = 165;
    nodes.filter((node) => node.id.startsWith("target-")).forEach((node, index) => {
      node.x = [220, 500, 780][index % 3];
      node.y = 300 + Math.floor(index / 3) * 125;
    });
  }
}

function renderNetwork(articles, stats, relationships) {
  els.relationshipNetwork.replaceChildren();
  const { nodes, edges } = graphData(articles, stats, relationships);
  if (!nodes.length || !edges.length) {
    const empty = document.createElement("div");
    empty.className = "network-empty";
    empty.textContent = "目前範圍沒有足夠的共同出現資料，請擴大期間或改選 tag。";
    els.relationshipNetwork.append(empty);
    return;
  }
  layoutGraph(nodes);
  const svg = svgElement("svg", { viewBox: "0 0 1000 500", "aria-hidden": "true" });
  const edgeLayer = svgElement("g");
  const nodeLayer = svgElement("g");
  svg.append(edgeLayer, nodeLayer);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeElements = [];
  edges.forEach((edge) => {
    const line = svgElement("line", { class: `network-edge${edge.score >= 60 ? " strong" : ""}${edge.structural ? " structural" : ""}`, "stroke-width": edge.structural ? 2 : 1.2 + edge.score / 24 });
    const title = svgElement("title");
    const a = nodeMap.get(edge.a), b = nodeMap.get(edge.b);
    title.textContent = edge.structural ? `${a.tag}匯入共同文章｜${edge.support} 篇` : `${a.tag} × ${b.tag}｜強度 ${edge.score}｜共同 ${edge.support} 篇`;
    line.append(title);
    edgeLayer.append(line);
    edgeElements.push({ edge, line });
  });
  const nodeElements = new Map();
  function updatePositions() {
    edgeElements.forEach(({ edge, line }) => {
      const a = nodeMap.get(edge.a), b = nodeMap.get(edge.b);
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y); line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
    });
    nodeElements.forEach((group, id) => {
      const node = nodeMap.get(id);
      group.setAttribute("transform", `translate(${node.x} ${node.y})`);
    });
  }
  nodes.forEach((node) => {
    const nodeWidth = Math.max(135, Math.min(230, 54 + [...node.tag].length * 15));
    const group = svgElement("g", { class: `network-node${node.selected ? " selected" : ""}${node.compound ? " compound" : ""}`, tabindex: node.compound ? "-1" : "0", role: node.compound ? "img" : "button", "aria-label": `${node.tag}，${node.count} 篇文章` });
    const rect = svgElement("rect", { x: -nodeWidth / 2, y: -27, width: nodeWidth, height: 54, rx: 14 });
    const label = svgElement("text", { y: "-3" }); label.textContent = node.tag;
    const count = svgElement("text", { y: "15", class: "node-count" }); count.textContent = `${node.count} 篇`;
    group.append(rect, label, count);
    group.addEventListener("pointerenter", () => {
      const neighbors = new Set([node.id]);
      edges.forEach((edge) => { if (edge.a === node.id) neighbors.add(edge.b); if (edge.b === node.id) neighbors.add(edge.a); });
      nodeElements.forEach((element, id) => { element.classList.toggle("hovered", id === node.id); element.classList.toggle("related", neighbors.has(id) && id !== node.id); element.classList.toggle("dimmed", !neighbors.has(id)); });
      edgeElements.forEach(({ edge, line }) => line.classList.toggle("dimmed", edge.a !== node.id && edge.b !== node.id));
    });
    group.addEventListener("pointerleave", () => {
      nodeElements.forEach((element) => element.classList.remove("hovered", "related", "dimmed"));
      edgeElements.forEach(({ line }) => line.classList.remove("dimmed"));
    });
    group.addEventListener("click", () => { if (!node.compound) toggleFocusTag(node.tag); });
    group.addEventListener("keydown", (event) => {
      if (!node.compound && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggleFocusTag(node.tag); }
    });
    nodeLayer.append(group);
    nodeElements.set(node.id, group);
  });
  updatePositions();
  els.relationshipNetwork.append(svg);
  const modeText = !state.selectedTags.length ? "全站關聯" : state.selectedTags.length === 1 ? `${state.selectedTags[0]}的關聯圈` : `${state.selectedTags.join("與")}的共同延伸`;
  els.relationshipNetwork.setAttribute("aria-label", `${modeText}，顯示 ${nodes.length} 個 tag 與 ${edges.length} 條關聯`);
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
  if (!state.selectedTags.length) {
    els.relationshipTitle.textContent = "全站最強關聯"; els.analysisMode.textContent = "全局模式"; els.rankingTitle.textContent = "最強 tag 組合";
    els.relationshipDescription.textContent = "未選 tag 時，直接呈現所選期間關聯性最強的組合；熱門但沒有特殊共現的 tag 不會自動排前。";
  } else if (state.selectedTags.length === 1) {
    els.relationshipTitle.textContent = `${state.selectedTags[0]}的關聯圈`; els.analysisMode.textContent = "單 tag 模式"; els.rankingTitle.textContent = "相關 tag 排名";
    els.relationshipDescription.textContent = `查看「${state.selectedTags[0]}」與其他 tag 的標準化關聯強度。點選另一個 tag 可進入雙 tag 分析。`;
  } else {
    els.relationshipTitle.textContent = "雙 tag 共同延伸"; els.analysisMode.textContent = "雙 tag 模式"; els.rankingTitle.textContent = "第三層關聯排名";
    els.relationshipDescription.textContent = `先找同時包含「${state.selectedTags.join("」與「")}」的文章，再分析這個交集與第三個 tag 的關聯。`;
  }
  renderNetwork(articles, stats, relationships);
  renderRelationshipRanking(relationships);
}

function cloudFontSize(item, minCount, maxCount, compact) {
  const ratio = maxCount === minCount ? .5 : (Math.sqrt(item.count) - Math.sqrt(minCount)) / (Math.sqrt(maxCount) - Math.sqrt(minCount));
  return (compact ? 11 : 14) + ratio * (compact ? 22 : 38);
}

function layoutCloudWords(buttons) {
  if (!buttons.length || buttons.some((button) => !button.isConnected)) return;
  const width = els.keywordCloud.clientWidth || 900;
  const height = els.keywordCloud.clientHeight || 540;
  const boxes = [];
  const padding = width < 480 ? 3 : 6;
  buttons.forEach((button, index) => {
    const wordWidth = button.offsetWidth + padding * 2;
    const wordHeight = button.offsetHeight + padding * 2;
    let placed = null;
    for (let step = 0; step < 2400; step += 1) {
      const angle = step * .31;
      const radius = index === 0 ? 0 : step * (width < 480 ? .19 : .29);
      const x = width / 2 + Math.cos(angle) * radius;
      const y = height / 2 + Math.sin(angle) * radius * (width < 480 ? 1.28 : .62);
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
  const items = stats.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 52);
  if (!items.length) return;
  const statsByTag = statsMapFor(stats), counts = items.map((item) => item.count), min = Math.min(...counts), max = Math.max(...counts);
  const compact = innerWidth < 480;
  const buttons = items.map((item) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "cloud-word"; button.dataset.tag = item.tag;
    button.dataset.trendLevel = trendLevel(item.trend); button.style.fontSize = `${cloudFontSize(item, min, max, compact)}px`; button.style.visibility = "hidden";
    button.classList.toggle("selected", state.selectedTags.includes(item.tag)); button.textContent = item.tag;
    button.setAttribute("aria-label", `${item.tag}，${item.count} 篇，${trendTextForSelection(item.trend)}`);
    button.addEventListener("click", () => toggleFocusTag(item.tag));
    button.addEventListener("pointerenter", (event) => highlightTag(item.tag, event, articles, statsByTag));
    button.addEventListener("pointermove", positionTooltip); button.addEventListener("pointerleave", clearTagHighlights);
    button.addEventListener("focus", (event) => highlightTag(item.tag, event, articles, statsByTag)); button.addEventListener("blur", clearTagHighlights);
    els.keywordCloud.append(button); return button;
  });
  requestAnimationFrame(() => layoutCloudWords(buttons));
  els.keywordCloud.onpointermove = updateCloudMagnet;
  els.keywordCloud.onpointerleave = () => { resetCloudDrift(); clearTagHighlights(); };
}

function renderCloudComparisonStatus() {
  const comparisonIssue = state.issue || state.issues.at(-1);
  const issueIndex = state.issues.indexOf(comparisonIssue);
  const hasPrevious = issueIndex > 0;
  els.trendFlatLabel.textContent = hasPrevious ? "持平" : "無前期資料";
  els.cloudComparisonStatus.classList.toggle("no-baseline", !hasPrevious);
  if (!hasPrevious) {
    els.cloudComparisonStatus.textContent = "這是資料庫最早一期，沒有前一期可比較；灰色代表缺少比較基準，不代表趨勢持平。";
    return;
  }
  const previousIssue = state.issues[issueIndex - 1];
  const scope = state.issue ? "本期" : "全部期數模式以最新一期為準";
  els.cloudComparisonStatus.textContent = `${scope}：顏色比較 ${issueTitle(previousIssue)} 與 ${issueTitle(comparisonIssue)} 的文章占比。相對增減未達 10% 時標為持平。`;
}

function articleSearchUrl(tags) {
  const query = new URLSearchParams();
  for (const tag of tags) query.append("tag", tag);
  return `./index.html?${query.toString()}#articles`;
}

function detailSeries(tag) {
  return state.issues.map((issue) => {
    const articles = state.data.articles.filter((article) => issueDate(article) === issue);
    const count = countContaining(articles, [tag]);
    return { issue, count, total: articles.length, rate: articles.length ? (count / articles.length) * 100 : 0 };
  });
}

function renderTagDetail(stats) {
  const ordered = sortStats(stats, "count");
  if (!state.detailTag || !state.allTags.includes(state.detailTag)) state.detailTag = state.selectedTags[0] || ordered[0]?.tag || state.allTags[0];
  els.detailTagSelect.replaceChildren();
  ordered.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.tag;
    option.textContent = `${item.tag}（目前 ${item.count} 篇）`;
    option.selected = item.tag === state.detailTag;
    els.detailTagSelect.append(option);
  });
  els.detailArticleLink.href = articleSearchUrl([state.detailTag]);
  const series = detailSeries(state.detailTag);
  const totalCount = series.reduce((sum, item) => sum + item.count, 0);
  const activeIndex = state.issue ? state.issues.indexOf(state.issue) : series.length - 1;
  const active = series[Math.max(0, activeIndex)];
  const previous = activeIndex > 0 ? series[activeIndex - 1] : null;
  const delta = previous ? active.rate - previous.rate : 0;
  els.detailSummary.replaceChildren();
  [
    [state.issue ? "目前期數" : "最新一期", active ? `${active.count} 篇` : "0 篇", active ? `${active.rate.toFixed(1)}% 的當期文章` : "沒有資料", "當期文章占比", "含有此 tag 的文章數 ÷ 當期文章總數。用占比比較，可降低每期收錄篇數不同造成的影響。"],
    ["全部期數", `${totalCount} 篇`, `涵蓋 ${series.filter((item) => item.count > 0).length} / ${series.length} 期`, "跨期總數", "把每一期含有此 tag 的文章數加總；涵蓋期數只計算至少出現過一篇的期數。"],
    ["較前一期", previous ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} 個百分點` : "無法比較", previous ? `${previous.rate.toFixed(1)}% → ${active.rate.toFixed(1)}%` : "這是資料中的最早一期", "百分點變化", "當期占比減去前一期占比。例如 10% 上升到 15%，是增加 5 個百分點；最早一期沒有前期可比較。"],
  ].forEach(([label, value, note, helpTitle, helpBody]) => {
    const card = document.createElement("div");
    const labelRow = document.createElement("span"); labelRow.className = "summary-label-row";
    const small = document.createElement("small"); small.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    const span = document.createElement("span"); span.textContent = note;
    labelRow.append(small, createCalculationHelp(helpTitle, helpBody));
    card.append(labelRow, strong, span); els.detailSummary.append(card);
  });
  els.detailChart.replaceChildren();
  els.detailChart.style.setProperty("--period-count", Math.max(1, Math.min(4, series.length)));
  els.detailChart.classList.toggle("many-periods", series.length > 4);
  const maxRate = Math.max(1, ...series.map((item) => item.rate));
  series.forEach((item) => {
    const column = document.createElement("button");
    column.type = "button";
    column.className = "tag-period-column";
    column.classList.toggle("selected", state.issue === item.issue);
    column.setAttribute("aria-label", `${issueTitle(item.issue)}，${state.detailTag} ${item.count} 篇，占 ${item.rate.toFixed(1)}%；點選以分析這一期`);
    const value = document.createElement("strong"); value.textContent = `${item.rate.toFixed(1)}%`;
    const track = document.createElement("span"); track.className = "tag-period-track";
    const bar = document.createElement("i"); bar.style.height = `${Math.max(item.rate ? 8 : 2, (item.rate / maxRate) * 100)}%`; track.append(bar);
    const count = document.createElement("span"); count.className = "tag-period-count"; count.textContent = `${item.count} 篇`;
    const label = document.createElement("span"); label.className = "tag-period-label"; label.textContent = issueRange(item.issue);
    const issueLabel = document.createElement("small"); issueLabel.textContent = issueTitle(item.issue).replace(/^\d{4} 年 /, "");
    column.append(value, track, count, label, issueLabel);
    column.addEventListener("click", () => { state.issue = item.issue; renderAll(); });
    els.detailChart.append(column);
  });
  requestAnimationFrame(() => {
    if (series.length <= 4) return;
    const activeColumn = state.issue ? els.detailChart.querySelector(".tag-period-column.selected") : els.detailChart.lastElementChild;
    if (!activeColumn) return;
    els.detailChart.scrollLeft = Math.max(0, activeColumn.offsetLeft - (els.detailChart.clientWidth - activeColumn.offsetWidth) / 2);
  });
  els.detailChart.setAttribute("aria-label", `${state.detailTag}各期文章占比趨勢；${series.map((item) => `${issueRange(item.issue)} ${item.rate.toFixed(1)}%`).join("，")}`);
}

function renderAll() {
  hideCalculationHelp();
  const articles = articlesInWindow();
  const periods = periodsFor(articles);
  const stats = tagStatistics(articles, periods, true);
  const relationships = relationshipsFor(articles);
  renderIssuePicker();
  renderTagOverview(articles, stats);
  renderSignals(articles, periods, stats, relationships);
  renderRelationships(articles, stats, relationships);
  renderCloudComparisonStatus();
  renderCloud(articles, stats);
  renderTagDetail(stats);
  syncUrl();
}

els.clearFocus.addEventListener("click", () => { state.selectedTags = []; renderAll(); });
els.overviewSearch.addEventListener("input", () => { state.overviewQuery = els.overviewSearch.value; renderTagOverview(articlesInWindow(), tagStatistics(articlesInWindow(), periodsFor(articlesInWindow()), true)); });
els.overviewSort.addEventListener("change", () => { state.overviewSort = els.overviewSort.value; renderTagOverview(articlesInWindow(), tagStatistics(articlesInWindow(), periodsFor(articlesInWindow()), true)); });
els.detailTagSelect.addEventListener("change", () => { state.detailTag = els.detailTagSelect.value; renderAll(); });
window.addEventListener("resize", () => { hideCalculationHelp(); if (state.data) renderCloud(articlesInWindow(), tagStatistics(articlesInWindow(), periodsFor(articlesInWindow()), true)); });
window.addEventListener("scroll", hideCalculationHelp, { passive: true });

fetch("./data/articles.json", { cache: "no-store" })
  .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then((data) => {
    state.data = data;
    state.issues = [...new Set(data.articles.map(issueDate).filter(Boolean))].sort();
    if (!state.issues.includes(state.issue)) state.issue = "";
    if (!state.issue && (state.legacyFrom || state.legacyTo)) {
      const from = state.legacyFrom || state.issues[0].replaceAll(".", "-");
      const to = state.legacyTo || state.issues.at(-1).replaceAll(".", "-");
      const matched = state.issues.filter((issue) => { const date = issue.replaceAll(".", "-"); return date >= from && date <= to; });
      if (matched.length === 1) state.issue = matched[0];
    }
    state.allTags = [...new Set(data.articles.flatMap((article) => article.keywordsZh || []))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    state.selectedTags = state.selectedTags.filter((tag) => state.allTags.includes(tag)).slice(0, 2);
    els.dataRangeLabel.textContent = `共 ${state.issues.length} 期；依最早到最新排列，期數較多時可左右滑動`;
    renderStaticCalculationHelp();
    renderAll();
  })
  .catch(() => { els.signalCards.innerHTML = '<div class="chart-empty"><strong>資料暫時無法載入</strong><p>請稍後重新整理頁面。</p></div>'; });
