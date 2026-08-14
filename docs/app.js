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

const state = {
  data: null,
  query: "",
  category: "全部",
  sort: "newest",
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

function articleTimestamp(article) {
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
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-Hant");
}

function appendHighlightedText(element, text, keywords) {
  const terms = [...new Set((keywords || [])
    .flatMap((keyword) => [keyword, keyword.split(/[（(：:]/)[0]])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && text.includes(term)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);

  if (!terms.length) {
    element.textContent = text;
    return;
  }

  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "g");
  for (const part of text.split(pattern)) {
    if (!part) continue;
    const node = terms.includes(part) ? document.createElement("strong") : document.createTextNode(part);
    if (node.nodeType === Node.ELEMENT_NODE) node.textContent = part;
    element.append(node);
  }
}

function renderCard(article) {
  const fragment = els.template.content.cloneNode(true);
  fragment.querySelector(".category-label").textContent = categoryFor(article);
  fragment.querySelector(".section-label").textContent = article.section;
  fragment.querySelector("time").textContent = article.publishedEn;
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
      article.keywordsZh,
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
    if (normalizedQuery && !searchableText(article).includes(normalizedQuery)) return false;
    return true;
  }));

  els.articleList.replaceChildren(...filtered.map(renderCard));
  els.resultCount.textContent = `顯示 ${filtered.length} 篇文章，共 ${state.data.articles.length} 篇`;
  els.clearFilters.hidden = !state.query && state.category === "全部";
  els.emptyState.hidden = filtered.length > 0;
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
els.clearFilters.addEventListener("click", () => {
  state.query = "";
  state.category = "全部";
  els.searchInput.value = "";
  els.categoryFilters.querySelectorAll("button").forEach((button, index) => {
    button.classList.toggle("active", index === 0);
  });
  render();
});

fetch("./data/articles.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((data) => {
    state.data = data;
    setupMeta(data);
    setupFilters(data);
    render();
  })
  .catch(() => {
    els.articleList.innerHTML = '<div class="empty-state"><strong>資料暫時無法載入</strong><p>請稍後重新整理頁面。</p></div>';
  });
