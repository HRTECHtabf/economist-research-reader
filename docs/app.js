const CATEGORY_ORDER = [
  "國際與政策",
  "金融與經濟",
  "產業與科技",
  "區域政情",
  "文化與人物",
  "其他",
];

const SECTION_CATEGORIES = {
  "The world this week": "國際與政策",
  Leaders: "國際與政策",
  Briefing: "國際與政策",
  International: "國際與政策",
  "Finance & economics": "金融與經濟",
  Business: "產業與科技",
  "Science & technology": "產業與科技",
  Asia: "區域政情",
  China: "區域政情",
  "United States": "區域政情",
  "The Americas": "區域政情",
  "Middle East & Africa": "區域政情",
  Europe: "區域政情",
  Britain: "區域政情",
  "By Invitation": "其他",
  Letters: "其他",
  Culture: "文化與人物",
  Obituary: "文化與人物",
};

const FAVORITES_STORAGE_KEY = "economist-research-reader:favorites:v1";
const ARTICLES_PER_PAGE = 5;
const urlParams = new URLSearchParams(location.search);
const initialPage = Number(urlParams.get("page"));
const allowedSorts = new Set(["newest", "oldest", "category"]);

function loadFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

const state = {
  data: null,
  query: urlParams.get("q") || "",
  category: urlParams.get("category") || "全部",
  issue: urlParams.get("issue") || "全部",
  sort: allowedSorts.has(urlParams.get("sort")) ? urlParams.get("sort") : "newest",
  favorites: loadFavorites(),
  favoritesOnly: urlParams.get("favorites") === "1",
  page: Number.isInteger(initialPage) && initialPage > 0 ? initialPage : 1,
  internalTextById: new Map(),
};

const els = {
  searchInput: document.querySelector("#search-input"),
  issueSelect: document.querySelector("#issue-select"),
  sortSelect: document.querySelector("#sort-select"),
  favoritesFilter: document.querySelector("#favorites-filter"),
  favoritesCount: document.querySelector("#favorites-count"),
  categoryFilters: document.querySelector("#category-filters"),
  resultCount: document.querySelector("#result-count"),
  clearFilters: document.querySelector("#clear-filters"),
  articleList: document.querySelector("#article-list"),
  pagination: document.querySelector("#pagination"),
  previousPage: document.querySelector("#previous-page"),
  pageNumbers: document.querySelector("#page-numbers"),
  nextPage: document.querySelector("#next-page"),
  emptyState: document.querySelector("#empty-state"),
  template: document.querySelector("#article-template"),
};

function categoryFor(article) {
  return article.categoryZh || SECTION_CATEGORIES[article.section] || "其他";
}

function articleKey(article) {
  return `${article.issueKey || state.data?.issueKey || "unknown"}:${article.id}`;
}

function issueFor(article) {
  return article.issueKey || state.data?.issueKey || "";
}

function formatIssueKey(issueKey) {
  const match = issueKey.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!match) return issueKey;
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
  } catch {
    // 收藏功能仍可在本次瀏覽使用；瀏覽器禁止儲存時不讓頁面中斷。
  }
}

function updateFavoritesControl() {
  els.favoritesCount.textContent = state.favorites.size;
  els.favoritesFilter.classList.toggle("active", state.favoritesOnly);
  els.favoritesFilter.setAttribute("aria-pressed", String(state.favoritesOnly));
  els.favoritesFilter.querySelector(".favorite-symbol").textContent = state.favoritesOnly ? "★" : "☆";
}

function publishedDateParts(article) {
  const match = article.sourceUrl?.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return { date, year, month, day };
}

function publishedDateText(article) {
  const parts = publishedDateParts(article);
  if (!parts) return article.publishedEn || "—";
  const monthName = new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(parts.date);
  const remainder = parts.day % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[parts.day % 10] || "th");
  return `${monthName} ${parts.day}${suffix} ${parts.year}`;
}

function articleTimestamp(article) {
  const urlDate = publishedDateParts(article)?.date;
  if (urlDate) return urlDate.getTime();
  const published = article.publishedEn?.replace(/(\d+)(st|nd|rd|th)/, "$1");
  const parsed = Date.parse(published || "");
  if (Number.isFinite(parsed)) return parsed;
  const issueKey = article.issueKey || state.data.issueKey;
  return Date.parse(issueKey?.replaceAll(".", "-") || "") || 0;
}

function setupFilters(data) {
  if (!["全部", ...CATEGORY_ORDER].includes(state.category)) state.category = "全部";
  const counts = new Map(CATEGORY_ORDER.map((category) => [category, 0]));
  for (const article of data.articles) {
    const category = categoryFor(article);
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  for (const category of ["全部", ...CATEGORY_ORDER]) {
    const button = document.createElement("button");
    button.type = "button";
    const count = category === "全部" ? data.articles.length : counts.get(category) || 0;
    button.innerHTML = `<span>${category}</span><small>${count}</small>`;
    button.classList.toggle("active", category === state.category);
    button.addEventListener("click", () => {
      state.category = category;
      state.page = 1;
      els.categoryFilters.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      render();
    });
    els.categoryFilters.append(button);
  }
}

function setupIssueFilter(data) {
  const issueCounts = new Map();
  for (const article of data.articles) {
    const issue = issueFor(article);
    issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
  }
  const issues = [...issueCounts.keys()].filter(Boolean).sort((a, b) => b.localeCompare(a));
  if (state.issue !== "全部" && !issueCounts.has(state.issue)) state.issue = "全部";

  const allOption = document.createElement("option");
  allOption.value = "全部";
  allOption.textContent = `全部期數（${data.articles.length}）`;
  els.issueSelect.append(allOption);
  for (const issue of issues) {
    const option = document.createElement("option");
    option.value = issue;
    option.textContent = `${formatIssueKey(issue)}（${issueCounts.get(issue)}）`;
    els.issueSelect.append(option);
  }
  els.issueSelect.value = state.issue;
}

function searchTerms(query) {
  return query.trim().toLocaleLowerCase("zh-Hant").split(/\s+/).filter(Boolean);
}

function termMatchesText(text, term) {
  const normalized = (text || "").toLocaleLowerCase("zh-Hant");
  if (/^[a-z0-9]{1,3}$/.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalized);
  }
  return normalized.includes(term);
}

function searchableFields(article) {
  return [
    { label: "英文標題／副標", text: [article.titleEn, article.rubricEn].filter(Boolean).join(" ") },
    { label: "英文全文", text: article.textEn || "" },
    { label: "欄目／分類", text: [article.section, categoryFor(article)].filter(Boolean).join(" ") },
    { label: "中文摘要", text: article.summaryZh || "" },
    { label: "論述重點", text: (article.keyPointsZh || []).join(" ") },
    { label: "研究角度", text: article.researchLensZh || "" },
    { label: "關鍵字", text: [...(article.keywordsZh || []), ...(article.highlightTermsZh || [])].join(" ") },
  ];
}

function matchesSearch(article, query) {
  const fields = searchableFields(article);
  return searchTerms(query).every((term) => fields.some((field) => termMatchesText(field.text, term)));
}

function searchMatchLabels(article) {
  const terms = searchTerms(state.query);
  return searchableFields(article)
    .filter((field) => terms.some((term) => termMatchesText(field.text, term)))
    .map((field) => field.label);
}

function searchMatchRanges(text) {
  const normalizedText = text.toLocaleLowerCase("zh-Hant");
  const ranges = [];
  for (const term of searchTerms(state.query)) {
    if (/^[a-z0-9]{1,3}$/.test(term)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^a-z0-9])(${escaped})(?=[^a-z0-9]|$)`, "gi");
      for (const match of normalizedText.matchAll(pattern)) {
        ranges.push({ index: match.index + match[1].length, length: match[2].length });
      }
    } else {
      let index = normalizedText.indexOf(term);
      while (index >= 0) {
        ranges.push({ index, length: term.length });
        index = normalizedText.indexOf(term, index + term.length);
      }
    }
  }
  return ranges
    .sort((a, b) => a.index - b.index || b.length - a.length)
    .filter((range, index, all) => !all.slice(0, index).some(
      (previous) => range.index < previous.index + previous.length,
    ));
}

function appendSearchHighlightedText(element, text) {
  const ranges = searchMatchRanges(text);
  if (!ranges.length) {
    element.textContent = text;
    return;
  }
  let cursor = 0;
  for (const { index, length } of ranges) {
    if (index > cursor) element.append(document.createTextNode(text.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.className = "search-highlight";
    mark.textContent = text.slice(index, index + length);
    element.append(mark);
    cursor = index + length;
  }
  if (cursor < text.length) element.append(document.createTextNode(text.slice(cursor)));
}

function highlightTermsFor(article) {
  return [...new Set(article.highlightTermsZh || [])]
    .map((term) => term.trim())
    .filter((term) => term && article.summaryZh.includes(term))
    .slice(0, 3);
}

function appendHighlightedText(element, text, terms) {
  const matches = terms
    .map((term) => ({ term, index: text.indexOf(term) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index || b.term.length - a.term.length)
    .filter((match, index, all) => !all.slice(0, index).some(
      (previous) => match.index < previous.index + previous.term.length,
    ));

  if (!matches.length) {
    element.textContent = text;
    return;
  }

  let cursor = 0;
  for (const { term, index } of matches) {
    if (index > cursor) element.append(document.createTextNode(text.slice(cursor, index)));
    const strong = document.createElement("strong");
    strong.textContent = term;
    element.append(strong);
    cursor = index + term.length;
  }
  if (cursor < text.length) element.append(document.createTextNode(text.slice(cursor)));
}

function renderCard(article) {
  const fragment = els.template.content.cloneNode(true);
  const favoriteButton = fragment.querySelector(".favorite-button");
  const key = articleKey(article);
  const isFavorite = state.favorites.has(key);
  favoriteButton.classList.toggle("active", isFavorite);
  favoriteButton.setAttribute("aria-pressed", String(isFavorite));
  favoriteButton.title = isFavorite ? "移除收藏" : "加入收藏";
  favoriteButton.querySelector("[aria-hidden]").textContent = isFavorite ? "★" : "☆";
  favoriteButton.querySelector(".sr-only").textContent = isFavorite ? "移除收藏" : "加入收藏";
  favoriteButton.addEventListener("click", () => {
    if (state.favorites.has(key)) state.favorites.delete(key);
    else state.favorites.add(key);
    saveFavorites();
    render();
  });

  fragment.querySelector(".category-label").textContent = categoryFor(article);
  fragment.querySelector(".section-label").textContent = article.section;
  const publishedTime = fragment.querySelector("time");
  const publishedParts = publishedDateParts(article);
  publishedTime.textContent = publishedDateText(article);
  if (publishedParts) {
    publishedTime.dateTime = [
      publishedParts.year,
      String(publishedParts.month).padStart(2, "0"),
      String(publishedParts.day).padStart(2, "0"),
    ].join("-");
  }
  const articleTitle = fragment.querySelector(".article-title");
  if (state.query) appendSearchHighlightedText(articleTitle, article.titleEn);
  else articleTitle.textContent = article.titleEn;

  const rubric = fragment.querySelector(".rubric");
  if (state.query) appendSearchHighlightedText(rubric, article.rubricEn || "");
  else rubric.textContent = article.rubricEn || "";
  rubric.hidden = !article.rubricEn;

  const matchReasons = fragment.querySelector(".search-match-reasons");
  if (state.query) {
    matchReasons.textContent = `命中：${searchMatchLabels(article).join("、")}`;
    matchReasons.hidden = false;
  }

  const summaryBlock = fragment.querySelector(".summary-block");
  const pendingBlock = fragment.querySelector(".pending-block");
  const hasSummary = Boolean(article.summaryZh);
  summaryBlock.hidden = !hasSummary;
  pendingBlock.hidden = hasSummary;

  if (hasSummary) {
    const list = fragment.querySelector(".key-points");
    for (const point of article.keyPointsZh || []) {
      const li = document.createElement("li");
      if (state.query) appendSearchHighlightedText(li, point);
      else li.textContent = point;
      list.append(li);
    }
    const summary = fragment.querySelector(".summary");
    if (state.query) appendSearchHighlightedText(summary, article.summaryZh);
    else appendHighlightedText(summary, article.summaryZh, highlightTermsFor(article));
    const researchLens = fragment.querySelector(".research-lens");
    if (state.query) appendSearchHighlightedText(researchLens, article.researchLensZh || "");
    else researchLens.textContent = article.researchLensZh || "";
  }

  const tags = fragment.querySelector(".tags");
  for (const keyword of article.keywordsZh || []) {
    const tag = document.createElement("span");
    tag.textContent = keyword;
    tags.append(tag);
  }
  tags.hidden = !tags.childElementCount;

  const link = fragment.querySelector(".source-link");
  link.href = article.sourceUrl;
  link.hidden = !article.sourceUrl;

  const internalEnglish = article.textEn || state.internalTextById.get(article.id);
  const internalBlock = fragment.querySelector(".internal-english-block");
  if (internalEnglish) {
    const textContainer = fragment.querySelector(".english-full-text");
    for (const paragraph of internalEnglish.split(/\n+/).filter(Boolean)) {
      const p = document.createElement("p");
      p.textContent = paragraph;
      textContainer.append(p);
    }
    internalBlock.hidden = false;
  }
  return fragment;
}

function sortedArticles(articles) {
  return [...articles].sort((a, b) => {
    if (state.sort === "category") {
      const categoryDiff = CATEGORY_ORDER.indexOf(categoryFor(a)) - CATEGORY_ORDER.indexOf(categoryFor(b));
      if (categoryDiff) return categoryDiff;
    }
    const dateDiff = articleTimestamp(b) - articleTimestamp(a);
    return state.sort === "oldest" ? -dateDiff : dateDiff;
  });
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.category !== "全部") params.set("category", state.category);
  if (state.issue !== "全部") params.set("issue", state.issue);
  if (state.sort !== "newest") params.set("sort", state.sort);
  if (state.favoritesOnly) params.set("favorites", "1");
  if (state.page > 1) params.set("page", state.page);
  const queryString = params.toString();
  history.replaceState(null, "", `${location.pathname}${queryString ? `?${queryString}` : ""}${location.hash}`);
}

function goToPage(page) {
  state.page = page;
  render();
  document.querySelector("#articles").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPagination(pageCount) {
  els.pagination.hidden = pageCount <= 1;
  els.previousPage.disabled = state.page === 1;
  els.nextPage.disabled = state.page === pageCount;
  els.pageNumbers.replaceChildren();

  const visiblePages = new Set([1, pageCount, state.page - 1, state.page, state.page + 1]);
  let previousVisiblePage = 0;
  for (const page of [...visiblePages].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b)) {
    if (page - previousVisiblePage > 1) {
      const gap = document.createElement("span");
      gap.className = "page-gap";
      gap.textContent = "…";
      gap.setAttribute("aria-hidden", "true");
      els.pageNumbers.append(gap);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = page;
    button.className = "page-number";
    button.classList.toggle("active", page === state.page);
    if (page === state.page) button.setAttribute("aria-current", "page");
    button.setAttribute("aria-label", `第 ${page} 頁`);
    button.addEventListener("click", () => goToPage(page));
    els.pageNumbers.append(button);
    previousVisiblePage = page;
  }
}

function render() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase("zh-Hant");
  const filtered = sortedArticles(state.data.articles.filter((article) => {
    if (state.category !== "全部" && categoryFor(article) !== state.category) return false;
    if (state.issue !== "全部" && issueFor(article) !== state.issue) return false;
    if (state.favoritesOnly && !state.favorites.has(articleKey(article))) return false;
    if (normalizedQuery && !matchesSearch(article, normalizedQuery)) return false;
    return true;
  }));

  const pageCount = Math.max(1, Math.ceil(filtered.length / ARTICLES_PER_PAGE));
  state.page = Math.min(state.page, pageCount);
  const pageStart = (state.page - 1) * ARTICLES_PER_PAGE;
  const visibleArticles = filtered.slice(pageStart, pageStart + ARTICLES_PER_PAGE);

  els.articleList.replaceChildren(...visibleArticles.map(renderCard));
  const rangeStart = filtered.length ? pageStart + 1 : 0;
  const rangeEnd = pageStart + visibleArticles.length;
  els.resultCount.textContent = `顯示第 ${rangeStart}–${rangeEnd} 篇，篩選結果共 ${filtered.length} 篇（資料庫 ${state.data.articles.length} 篇）`;
  renderPagination(pageCount);
  els.clearFilters.hidden = !state.query && state.category === "全部" && state.issue === "全部" && !state.favoritesOnly;
  els.emptyState.hidden = filtered.length > 0;
  const emptyTitle = els.emptyState.querySelector("strong");
  const emptyHint = els.emptyState.querySelector("p");
  if (state.favoritesOnly && state.favorites.size === 0) {
    emptyTitle.textContent = "還沒有收藏文章";
    emptyHint.textContent = "按文章右上角的星號，就能把文章留在這台裝置。";
  } else {
    emptyTitle.textContent = "找不到符合條件的文章";
    emptyHint.textContent = "試著縮短搜尋文字，或切換其他主題。";
  }
  updateFavoritesControl();
  syncUrl();
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.page = 1;
  render();
});
els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  state.page = 1;
  render();
});
els.issueSelect.addEventListener("change", (event) => {
  state.issue = event.target.value;
  state.page = 1;
  render();
});
els.favoritesFilter.addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly;
  state.page = 1;
  render();
});
els.clearFilters.addEventListener("click", () => {
  state.query = "";
  state.category = "全部";
  state.issue = "全部";
  state.favoritesOnly = false;
  state.page = 1;
  els.searchInput.value = "";
  els.issueSelect.value = "全部";
  els.categoryFilters.querySelectorAll("button").forEach((button, index) => {
    button.classList.toggle("active", index === 0);
  });
  render();
});
els.previousPage.addEventListener("click", () => goToPage(state.page - 1));
els.nextPage.addEventListener("click", () => goToPage(state.page + 1));

async function loadInternalEnglishText() {
  if (!["localhost", "127.0.0.1"].includes(location.hostname)) return;
  try {
    const response = await fetch("/internal/articles.json");
    if (!response.ok) return;
    const data = await response.json();
    state.internalTextById = new Map(
      (data.articles || []).map((article) => [article.id, article.textEn]),
    );
  } catch {
    // 舊版本機資料沒有 textEn 時，英文內容維持隱藏，不中斷頁面。
  }
}

fetch("./data/articles.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(async (data) => {
    state.data = data;
    els.searchInput.value = state.query;
    els.sortSelect.value = state.sort;
    setupFilters(data);
    setupIssueFilter(data);
    await loadInternalEnglishText();
    render();
  })
  .catch(() => {
    els.articleList.innerHTML = '<div class="empty-state"><strong>資料暫時無法載入</strong><p>請稍後重新整理頁面。</p></div>';
  });
