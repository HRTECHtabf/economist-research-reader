const state = {
  data: null,
  query: "",
  section: "全部",
  featuredOnly: true,
};

const els = {
  issueDate: document.querySelector("#issue-date"),
  articleCount: document.querySelector("#article-count"),
  sectionCount: document.querySelector("#section-count"),
  featuredCount: document.querySelector("#featured-count"),
  updateCadence: document.querySelector("#update-cadence"),
  sourceUpdated: document.querySelector("#source-updated"),
  issueSourceLink: document.querySelector("#issue-source-link"),
  searchInput: document.querySelector("#search-input"),
  featuredView: document.querySelector("#featured-view"),
  allView: document.querySelector("#all-view"),
  sectionFilters: document.querySelector("#section-filters"),
  resultCount: document.querySelector("#result-count"),
  articleGrid: document.querySelector("#article-grid"),
  emptyState: document.querySelector("#empty-state"),
  template: document.querySelector("#article-template"),
};

function formatIssueDate(value) {
  const match = value.match(/([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th)\s+(\d{4})/);
  if (!match) return value;
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 12:00:00`);
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function setupMeta(data) {
  els.issueDate.textContent = formatIssueDate(data.issueDate);
  els.articleCount.textContent = data.articleCount;
  els.sectionCount.textContent = data.sectionCount;
  els.featuredCount.textContent = data.featuredCount;
  els.updateCadence.textContent = data.updateCadenceZh;
  els.sourceUpdated.textContent = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(data.sourceUpdatedAt));
  els.issueSourceLink.href = data.issueRepository;
}

function setupFilters(data) {
  const sections = ["全部", ...new Set(data.articles.map((article) => article.section))];
  for (const section of sections) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section;
    button.classList.toggle("active", section === state.section);
    button.addEventListener("click", () => {
      state.section = section;
      els.sectionFilters.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      render();
    });
    els.sectionFilters.append(button);
  }
}

function searchableText(article) {
  return [
    article.titleEn,
    article.rubricEn,
    article.section,
    article.summaryZh,
    article.researchLensZh,
    ...(article.keyPointsZh || []),
    ...(article.keywordsZh || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-Hant");
}

function renderCard(article) {
  const fragment = els.template.content.cloneNode(true);
  const card = fragment.querySelector("article");
  card.dataset.featured = String(article.featured);
  fragment.querySelector(".section-label").textContent = article.section;
  fragment.querySelector("time").textContent = article.publishedEn;
  fragment.querySelector(".article-title").textContent = article.titleEn;

  const rubric = fragment.querySelector(".rubric");
  rubric.textContent = article.rubricEn || "";
  rubric.hidden = !article.rubricEn;

  const summaryBlock = fragment.querySelector(".summary-block");
  const pendingBlock = fragment.querySelector(".pending-block");
  summaryBlock.hidden = !article.featured;
  pendingBlock.hidden = article.featured;

  if (article.featured) {
    fragment.querySelector(".summary").textContent = article.summaryZh;
    const list = fragment.querySelector(".key-points");
    for (const point of article.keyPointsZh) {
      const li = document.createElement("li");
      li.textContent = point;
      list.append(li);
    }
    fragment.querySelector(".research-lens").textContent = article.researchLensZh;
    const tags = fragment.querySelector(".tags");
    for (const keyword of article.keywordsZh) {
      const tag = document.createElement("span");
      tag.textContent = keyword;
      tags.append(tag);
    }
  }

  const link = fragment.querySelector(".source-link");
  link.href = article.sourceUrl;
  if (!article.sourceUrl) {
    link.hidden = true;
  }
  return fragment;
}

function render() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase("zh-Hant");
  const filtered = state.data.articles.filter((article) => {
    if (state.featuredOnly && !article.featured) return false;
    if (state.section !== "全部" && article.section !== state.section) return false;
    if (normalizedQuery && !searchableText(article).includes(normalizedQuery)) return false;
    return true;
  });

  els.articleGrid.replaceChildren(...filtered.map(renderCard));
  els.resultCount.textContent = `顯示 ${filtered.length} 篇${state.featuredOnly ? "中文導讀" : "文章"}`;
  els.emptyState.hidden = filtered.length > 0;
}

function setView(featuredOnly) {
  state.featuredOnly = featuredOnly;
  els.featuredView.classList.toggle("active", featuredOnly);
  els.allView.classList.toggle("active", !featuredOnly);
  render();
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
els.featuredView.addEventListener("click", () => setView(true));
els.allView.addEventListener("click", () => setView(false));

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
    els.articleGrid.innerHTML = '<div class="empty-state"><strong>資料暫時無法載入</strong><p>請稍後重新整理頁面。</p></div>';
  });
