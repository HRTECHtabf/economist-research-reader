const CATEGORY_ORDER = [
  "國際與政策",
  "金融與經濟",
  "產業與科技",
  "區域政情",
  "觀點與文化",
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
  "By Invitation": "觀點與文化",
  Letters: "觀點與文化",
  Culture: "觀點與文化",
  Obituary: "觀點與文化",
};

const FAVORITES_STORAGE_KEY = "economist-research-reader:favorites:v1";

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
  query: "",
  category: "全部",
  sort: "newest",
  favorites: loadFavorites(),
  favoritesOnly: false,
  internalTextById: new Map(),
};

const els = {
  issueDate: document.querySelector("#issue-date"),
  articleCount: document.querySelector("#article-count"),
  summaryCount: document.querySelector("#summary-count"),
  categoryCount: document.querySelector("#category-count"),
  updateCadence: document.querySelector("#update-cadence"),
  siteUpdated: document.querySelector("#site-updated"),
  searchInput: document.querySelector("#search-input"),
  sortSelect: document.querySelector("#sort-select"),
  favoritesFilter: document.querySelector("#favorites-filter"),
  favoritesCount: document.querySelector("#favorites-count"),
  categoryFilters: document.querySelector("#category-filters"),
  resultCount: document.querySelector("#result-count"),
  clearFilters: document.querySelector("#clear-filters"),
  articleList: document.querySelector("#article-list"),
  emptyState: document.querySelector("#empty-state"),
  template: document.querySelector("#article-template"),
};

function categoryFor(article) {
  return article.categoryZh || SECTION_CATEGORIES[article.section] || "其他";
}

function articleKey(article) {
  return `${article.issueKey || state.data?.issueKey || "unknown"}:${article.id}`;
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

function formatIssueDate(value) {
  const match = value?.match(/([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th)\s+(\d{4})/);
  if (!match) return value || "—";
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 12:00:00`);
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
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

function setupMeta(data) {
  const currentIssueArticles = data.articles.filter(
    (article) => !article.issueKey || article.issueKey === data.issueKey,
  );
  const currentSummaryCount = currentIssueArticles.filter((article) => article.summaryZh).length;
  els.issueDate.textContent = formatIssueDate(data.issueDate);
  els.articleCount.textContent = currentIssueArticles.length || data.articleCount;
  els.summaryCount.textContent = `${currentSummaryCount}/${currentIssueArticles.length || data.articleCount}`;
  els.categoryCount.textContent = CATEGORY_ORDER.length;
  els.updateCadence.textContent = data.updateCadenceZh;
  els.siteUpdated.textContent = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(data.generatedAt || data.sourceUpdatedAt));
}

function setupFilters(data) {
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
      els.categoryFilters.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      render();
    });
    els.categoryFilters.append(button);
  }
}

function searchableText(article) {
  return [
    article.titleEn,
    article.rubricEn,
    article.section,
    categoryFor(article),
    article.summaryZh,
    article.researchLensZh,
    ...(article.keyPointsZh || []),
    ...(article.keywordsZh || []),
    ...(article.highlightTermsZh || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-Hant");
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
  fragment.querySelector(".article-title").textContent = article.titleEn;

  const rubric = fragment.querySelector(".rubric");
  rubric.textContent = article.rubricEn || "";
  rubric.hidden = !article.rubricEn;

  const summaryBlock = fragment.querySelector(".summary-block");
  const pendingBlock = fragment.querySelector(".pending-block");
  const hasSummary = Boolean(article.summaryZh);
  summaryBlock.hidden = !hasSummary;
  pendingBlock.hidden = hasSummary;

  if (hasSummary) {
    const list = fragment.querySelector(".key-points");
    for (const point of article.keyPointsZh || []) {
      const li = document.createElement("li");
      li.textContent = point;
      list.append(li);
    }
    appendHighlightedText(
      fragment.querySelector(".summary"),
      article.summaryZh,
      highlightTermsFor(article),
    );
    fragment.querySelector(".research-lens").textContent = article.researchLensZh || "";
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

  const internalEnglish = state.internalTextById.get(article.id);
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

function render() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase("zh-Hant");
  const filtered = sortedArticles(state.data.articles.filter((article) => {
    if (state.category !== "全部" && categoryFor(article) !== state.category) return false;
    if (state.favoritesOnly && !state.favorites.has(articleKey(article))) return false;
    if (normalizedQuery && !searchableText(article).includes(normalizedQuery)) return false;
    return true;
  }));

  els.articleList.replaceChildren(...filtered.map(renderCard));
  els.resultCount.textContent = `顯示 ${filtered.length} 篇文章，共 ${state.data.articles.length} 篇`;
  els.clearFilters.hidden = !state.query && state.category === "全部" && !state.favoritesOnly;
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
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
els.favoritesFilter.addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly;
  render();
});
els.clearFilters.addEventListener("click", () => {
  state.query = "";
  state.category = "全部";
  state.favoritesOnly = false;
  els.searchInput.value = "";
  els.categoryFilters.querySelectorAll("button").forEach((button, index) => {
    button.classList.toggle("active", index === 0);
  });
  render();
});

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
    // 公開網站與一般靜態預覽不提供內部英文內容。
  }
}

fetch("./data/articles.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(async (data) => {
    state.data = data;
    setupMeta(data);
    setupFilters(data);
    await loadInternalEnglishText();
    render();
  })
  .catch(() => {
    els.articleList.innerHTML = '<div class="empty-state"><strong>資料暫時無法載入</strong><p>請稍後重新整理頁面。</p></div>';
  });
