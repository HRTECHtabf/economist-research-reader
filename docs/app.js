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
const NOTES_STORAGE_KEY = "economist-research-reader:notes:v1";
const SAVED_TAGS_STORAGE_KEY = "economist-research-reader:saved-search-tags:v1";
const COMMON_SEARCH_TAGS = ["AI", "通膨", "利率", "能源", "中國", "航運"];
const ARTICLES_PER_PAGE = 5;
const urlParams = new URLSearchParams(location.search);
const initialPage = Number(urlParams.get("page"));
const allowedSorts = new Set(["newest", "oldest"]);

function isFullTextNote(note) {
  return /^(?:en|zh):p\d+$/.test(note?.contextId || "");
}

function loadFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

function loadNotes() {
  try {
    const stored = JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || "[]");
    const validNotes = Array.isArray(stored)
      ? stored.filter((note) => note?.id && note?.articleKey && isFullTextNote(note))
      : [];
    if (Array.isArray(stored) && validNotes.length !== stored.length) {
      try {
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(validNotes));
      } catch {
        // 即使浏览器禁止写入，也先在本次浏览中排除旧的导读笔记。
      }
    }
    return validNotes;
  } catch {
    return [];
  }
}

function loadSavedTags() {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVED_TAGS_STORAGE_KEY) || "[]");
    return Array.isArray(stored)
      ? stored
        .filter((tag) => tag?.id && tag?.query)
        .map((tag) => ({ ...tag, label: tag.query }))
      : [];
  } catch {
    return [];
  }
}

const state = {
  data: null,
  query: urlParams.get("q") || "",
  category: urlParams.get("category") || "全部",
  issue: urlParams.get("issue") || "全部",
  sort: allowedSorts.has(urlParams.get("sort")) ? urlParams.get("sort") : "newest",
  favorites: loadFavorites(),
  notes: loadNotes(),
  savedTags: loadSavedTags(),
  favoritesOnly: urlParams.get("favorites") === "1",
  page: Number.isInteger(initialPage) && initialPage > 0 ? initialPage : 1,
  internalTextById: new Map(),
  readingModes: new Map(),
  chineseTextByArticle: new Map(),
  chineseTextLoading: new Set(),
  pendingSelection: null,
  editingNoteId: null,
  noteAnchorRect: null,
  previewedNoteId: null,
};

const els = {
  searchInput: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
  issueSelect: document.querySelector("#issue-select"),
  sortSelect: document.querySelector("#sort-select"),
  favoritesFilter: document.querySelector("#favorites-filter"),
  favoritesCount: document.querySelector("#favorites-count"),
  categoryFilters: document.querySelector("#category-filters"),
  toolbar: document.querySelector("#articles"),
  backToFilters: document.querySelector("#back-to-filters"),
  resultCount: document.querySelector("#result-count"),
  clearFilters: document.querySelector("#clear-filters"),
  articleList: document.querySelector("#article-list"),
  pagination: document.querySelector("#pagination"),
  previousPage: document.querySelector("#previous-page"),
  pageNumbers: document.querySelector("#page-numbers"),
  nextPage: document.querySelector("#next-page"),
  emptyState: document.querySelector("#empty-state"),
  template: document.querySelector("#article-template"),
  selectionToolbar: document.querySelector("#selection-toolbar"),
  addSelectionNote: document.querySelector("#add-selection-note"),
  noteHoverPreview: document.querySelector("#note-hover-preview"),
  noteHoverPreviewBody: document.querySelector("#note-hover-preview-body"),
  noteDrawer: document.querySelector("#note-drawer"),
  noteDrawerClose: document.querySelector("#note-drawer-close"),
  noteQuote: document.querySelector("#note-quote"),
  noteEditor: document.querySelector("#note-editor"),
  noteSave: document.querySelector("#note-save"),
  noteDelete: document.querySelector("#note-delete"),
  quickTagsList: document.querySelector("#quick-tags-list"),
  manageTagsButton: document.querySelector("#manage-tags-button"),
  tagManager: document.querySelector("#tag-manager"),
  tagManagerClose: document.querySelector("#tag-manager-close"),
  tagManagerForm: document.querySelector("#tag-manager-form"),
  tagQueryInput: document.querySelector("#tag-query-input"),
  savedTagsList: document.querySelector("#saved-tags-list"),
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

function saveNotes() {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(state.notes));
  } catch {
    // 後端同步接上前先使用本機儲存；儲存被瀏覽器禁止時不讓閱讀頁中斷。
  }
}

function saveSavedTags() {
  try {
    localStorage.setItem(SAVED_TAGS_STORAGE_KEY, JSON.stringify(state.savedTags));
  } catch {
    // 登入同步接上前先保留在本機；儲存被禁止時不讓搜尋中斷。
  }
}

function applySearchTag(query) {
  state.query = query;
  state.page = 1;
  els.searchInput.value = query;
  render();
}

function renderQuickTags() {
  els.quickTagsList.replaceChildren();
  for (const tag of [
    ...COMMON_SEARCH_TAGS.map((query) => ({ id: `common:${query}`, label: query, query, custom: false })),
    ...state.savedTags.map((tag) => ({ ...tag, custom: true })),
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quick-tag${tag.custom ? " custom" : ""}`;
    button.classList.toggle("active", state.query === tag.query);
    button.textContent = tag.label;
    button.title = `搜尋「${tag.query}」`;
    button.addEventListener("click", () => applySearchTag(tag.query));
    els.quickTagsList.append(button);
  }
}

function renderSavedTags() {
  els.savedTagsList.replaceChildren();
  if (!state.savedTags.length) {
    const empty = document.createElement("p");
    empty.className = "note-empty";
    empty.textContent = "還沒有自訂標籤。可以把目前的搜尋內容存起來。";
    els.savedTagsList.append(empty);
    return;
  }
  for (const tag of state.savedTags) {
    const row = document.createElement("div");
    row.className = "saved-tag-row";
    const query = document.createElement("span");
    query.textContent = tag.query;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "刪除";
    remove.addEventListener("click", () => {
      state.savedTags = state.savedTags.filter((item) => item.id !== tag.id);
      saveSavedTags();
      renderSavedTags();
      renderQuickTags();
    });
    row.append(query, remove);
    els.savedTagsList.append(row);
  }
}

function notesForArticle(key) {
  return state.notes
    .filter((note) => note.articleKey === key && isFullTextNote(note))
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
}

function noteLanguageLabel(note) {
  return note.contextId.startsWith("en:") ? "EN" : "中文";
}

function noteMode(note) {
  if (note.contextId.startsWith("en:")) return "en";
  if (note.contextId.startsWith("zh:")) return "zh";
  return "guide";
}

function noteRangeInText(note, text) {
  if (
    Number.isInteger(note.start) &&
    Number.isInteger(note.end) &&
    note.start >= 0 &&
    note.end <= text.length &&
    text.slice(note.start, note.end) === note.quote
  ) return { start: note.start, end: note.end };
  const foundAt = text.indexOf(note.quote || "");
  return foundAt >= 0 ? { start: foundAt, end: foundAt + note.quote.length } : null;
}

function renderAnnotatedText(element, text, articleKeyValue, contextId, emphasisTerms = [], allowNotes = true) {
  element.replaceChildren();
  if (allowNotes) {
    element.tabIndex = 0;
    element.dataset.articleKey = articleKeyValue;
    element.dataset.contextId = contextId;
  } else {
    element.removeAttribute("tabindex");
    delete element.dataset.articleKey;
    delete element.dataset.contextId;
  }
  const noteRanges = allowNotes
    ? notesForArticle(articleKeyValue)
      .filter((note) => note.contextId === contextId)
      .map((note) => ({ note, range: noteRangeInText(note, text) }))
      .filter(({ range }) => range)
    : [];
  const emphasisRanges = emphasisTerms
    .map((term) => ({ start: text.indexOf(term), end: text.indexOf(term) + term.length }))
    .filter(({ start, end }) => start >= 0 && end > start);
  const boundaries = new Set([0, text.length]);
  for (const { range } of noteRanges) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  for (const range of emphasisRanges) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const positions = [...boundaries].sort((a, b) => a - b);
  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index];
    const end = positions[index + 1];
    if (end <= start) continue;
    const value = text.slice(start, end);
    const noteMatch = noteRanges.find(({ range }) => start >= range.start && end <= range.end)?.note;
    const emphasized = emphasisRanges.some((range) => start >= range.start && end <= range.end);
    let content = document.createTextNode(value);
    if (emphasized) {
      const strong = document.createElement("strong");
      strong.append(content);
      content = strong;
    }
    if (noteMatch) {
      const mark = document.createElement("mark");
      mark.className = "note-highlight";
      mark.dataset.noteId = noteMatch.id;
      mark.tabIndex = 0;
      mark.setAttribute("aria-label", `開啟筆記：${noteMatch.body || "尚未填寫內容"}`);
      mark.append(content);
      mark.addEventListener("mouseenter", (event) => showNotePreview(noteMatch, event.currentTarget.getBoundingClientRect()));
      mark.addEventListener("mouseleave", hideNotePreview);
      mark.addEventListener("focus", (event) => showNotePreview(noteMatch, event.currentTarget.getBoundingClientRect()));
      mark.addEventListener("blur", hideNotePreview);
      mark.addEventListener("click", (event) => {
        hideNotePreview();
        openNoteEditor(noteMatch, event.currentTarget.getBoundingClientRect());
      });
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openNoteEditor(noteMatch, event.currentTarget.getBoundingClientRect());
        }
      });
      content = mark;
    }
    element.append(content);
  }
  if (allowNotes) {
    element.addEventListener("mouseup", () => captureSelection(element));
    element.addEventListener("keyup", () => captureSelection(element));
  }
}

function captureSelection(element) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
  const quote = range.toString().trim();
  if (quote.length < 2) return;
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length + range.toString().indexOf(quote);
  const end = start + quote.length;
  const articleKeyValue = element.dataset.articleKey;
  const contextId = element.dataset.contextId;
  const overlap = notesForArticle(articleKeyValue).find((note) => {
    if (note.contextId !== contextId) return false;
    const existing = noteRangeInText(note, element.innerText);
    return existing && start < existing.end && end > existing.start;
  });
  if (overlap) {
    hideSelectionToolbar();
    openNoteEditor(overlap, range.getBoundingClientRect());
    return;
  }
  state.pendingSelection = { articleKey: articleKeyValue, contextId, start, end, quote };
  const rect = range.getBoundingClientRect();
  state.noteAnchorRect = {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
  els.selectionToolbar.hidden = false;
  const toolbarWidth = 112;
  els.selectionToolbar.style.left = `${Math.max(8, Math.min(innerWidth - toolbarWidth - 8, rect.left + rect.width / 2 - toolbarWidth / 2))}px`;
  els.selectionToolbar.style.top = `${Math.max(8, rect.top - 44)}px`;
}

function hideSelectionToolbar() {
  els.selectionToolbar.hidden = true;
}

function showNotePreview(note, anchorRect) {
  const body = note.body?.trim();
  if (!body) return;
  state.previewedNoteId = note.id;
  els.noteHoverPreviewBody.textContent = body;
  els.noteHoverPreview.hidden = false;
  els.noteHoverPreview.classList.remove("positioned");
  requestAnimationFrame(() => {
    if (state.previewedNoteId !== note.id) return;
    const margin = 12;
    const gap = 8;
    const previewRect = els.noteHoverPreview.getBoundingClientRect();
    const anchorWidth = anchorRect.width || anchorRect.right - anchorRect.left;
    const centeredLeft = anchorRect.left + anchorWidth / 2 - previewRect.width / 2;
    const left = Math.max(margin, Math.min(innerWidth - previewRect.width - margin, centeredLeft));
    const above = anchorRect.top - previewRect.height - gap;
    const below = anchorRect.bottom + gap;
    const top = above >= margin
      ? above
      : Math.min(innerHeight - previewRect.height - margin, below);
    els.noteHoverPreview.style.left = `${left}px`;
    els.noteHoverPreview.style.top = `${Math.max(margin, top)}px`;
    els.noteHoverPreview.classList.add("positioned");
  });
}

function hideNotePreview() {
  state.previewedNoteId = null;
  els.noteHoverPreview.hidden = true;
  els.noteHoverPreview.classList.remove("positioned");
}

function positionNoteEditor(anchorRect) {
  const margin = 12;
  const gap = 9;
  const editorRect = els.noteDrawer.getBoundingClientRect();
  const anchor = anchorRect || {
    left: innerWidth / 2,
    right: innerWidth / 2,
    top: innerHeight / 2,
    bottom: innerHeight / 2,
    width: 0,
  };
  const anchorWidth = anchor.width || anchor.right - anchor.left;
  const centeredLeft = anchor.left + anchorWidth / 2 - editorRect.width / 2;
  const left = Math.max(margin, Math.min(innerWidth - editorRect.width - margin, centeredLeft));
  const below = anchor.bottom + gap;
  const above = anchor.top - editorRect.height - gap;
  const top = below + editorRect.height <= innerHeight - margin ? below : Math.max(margin, above);
  els.noteDrawer.style.left = `${left}px`;
  els.noteDrawer.style.top = `${top}px`;
  els.noteDrawer.classList.add("positioned");
}

function openNoteEditor(note = null, anchorRect = null) {
  state.editingNoteId = note?.id || null;
  const source = note || state.pendingSelection;
  if (!source) return;
  els.noteQuote.textContent = source.quote;
  els.noteEditor.value = note?.body || "";
  els.noteEditor.setCustomValidity("");
  els.noteDelete.hidden = !note;
  els.noteDrawer.hidden = false;
  els.noteDrawer.classList.remove("positioned");
  els.noteDrawer.classList.add("open");
  els.noteDrawer.setAttribute("aria-hidden", "false");
  hideNotePreview();
  hideSelectionToolbar();
  requestAnimationFrame(() => {
    positionNoteEditor(anchorRect || state.noteAnchorRect);
    els.noteEditor.focus();
  });
}

function closeNoteEditor() {
  els.noteDrawer.classList.remove("open");
  els.noteDrawer.classList.remove("positioned");
  els.noteDrawer.setAttribute("aria-hidden", "true");
  els.noteDrawer.hidden = true;
  state.editingNoteId = null;
  state.pendingSelection = null;
  state.noteAnchorRect = null;
  window.getSelection()?.removeAllRanges();
}

function captureReadingPosition(source) {
  if (!source?.articleKey || !source?.contextId) return null;
  const selector = `[data-article-key="${CSS.escape(source.articleKey)}"][data-context-id="${CSS.escape(source.contextId)}"]`;
  const anchor = document.querySelector(selector);
  const scroller = anchor?.closest(".full-text");
  if (!anchor || !scroller) return null;
  const anchorRect = anchor.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  return {
    articleKey: source.articleKey,
    contextId: source.contextId,
    scrollTop: scroller.scrollTop,
    relativeTop: anchorRect.top - scrollerRect.top,
  };
}

function restoreReadingPosition(position) {
  if (!position) return;
  const selector = `[data-article-key="${CSS.escape(position.articleKey)}"][data-context-id="${CSS.escape(position.contextId)}"]`;
  const anchor = document.querySelector(selector);
  const scroller = anchor?.closest(".full-text");
  if (!anchor || !scroller) return;
  const anchorRect = anchor.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const relativeTop = anchorRect.top - scrollerRect.top;
  scroller.scrollTop += relativeTop - position.relativeTop;
}

function saveCurrentNote() {
  const body = els.noteEditor.value.trim();
  if (!body) {
    els.noteEditor.setCustomValidity("請先寫下筆記內容");
    els.noteEditor.reportValidity();
    els.noteEditor.focus();
    return;
  }
  els.noteEditor.setCustomValidity("");
  const now = new Date().toISOString();
  let noteSource = state.pendingSelection;
  if (state.editingNoteId) {
    const note = state.notes.find((item) => item.id === state.editingNoteId);
    if (!note) return;
    note.body = body;
    note.updatedAt = now;
    noteSource = note;
  } else if (state.pendingSelection) {
    state.notes.push({
      id: crypto.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ...state.pendingSelection,
      body,
      createdAt: now,
      updatedAt: now,
    });
  } else return;
  const viewport = { x: scrollX, y: scrollY };
  const readingPosition = captureReadingPosition(noteSource);
  saveNotes();
  closeNoteEditor();
  renderPreservingViewport(viewport, readingPosition);
}

function deleteCurrentNote() {
  if (!state.editingNoteId || !window.confirm("確定刪除這則筆記？")) return;
  state.notes = state.notes.filter((note) => note.id !== state.editingNoteId);
  saveNotes();
  closeNoteEditor();
  render();
}

async function focusNote(note) {
  state.readingModes.set(note.articleKey, noteMode(note));
  const article = state.data?.articles.find((item) => articleKey(item) === note.articleKey);
  if (noteMode(note) === "zh" && article && !state.chineseTextByArticle.has(note.articleKey)) {
    await loadChineseFullText(article);
  } else {
    render();
  }
  requestAnimationFrame(() => {
    const highlight = document.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
    const paragraphSelector = `[data-article-key="${CSS.escape(note.articleKey)}"][data-context-id="${CSS.escape(note.contextId)}"]`;
    const target = highlight || document.querySelector(paragraphSelector);
    target?.scrollIntoView({ behavior: "auto", block: "center" });
    target?.classList.add("note-flash");
    setTimeout(() => target?.classList.remove("note-flash"), 1300);
  });
}

async function loadChineseFullText(article) {
  const key = articleKey(article);
  if (state.chineseTextByArticle.has(key) || state.chineseTextLoading.has(key)) return;
  state.chineseTextLoading.add(key);
  render();
  try {
    const issue = encodeURIComponent(issueFor(article));
    const id = encodeURIComponent(article.id);
    const response = await fetch(`./data/fulltext/${issue}/${id}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    if (!Array.isArray(value.paragraphsZh) || !value.paragraphsZh.length) throw new Error("缺少中文段落");
    state.chineseTextByArticle.set(key, value);
  } catch {
    state.chineseTextByArticle.set(key, { unavailable: true });
  } finally {
    state.chineseTextLoading.delete(key);
    render();
  }
}

function updateBackToFiltersVisibility() {
  els.backToFilters.hidden = els.categoryFilters.getBoundingClientRect().bottom >= 84;
}

let backToFiltersFrame = null;
function scheduleBackToFiltersUpdate() {
  if (backToFiltersFrame !== null) return;
  backToFiltersFrame = requestAnimationFrame(() => {
    updateBackToFiltersVisibility();
    backToFiltersFrame = null;
  });
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
    button.className = "category-filter";
    const count = category === "全部" ? data.articles.length : counts.get(category) || 0;
    button.innerHTML = `<span>${category}</span><small>${count}</small>`;
    button.classList.toggle("active", category === state.category);
    button.addEventListener("click", () => {
      state.category = category;
      state.page = 1;
      els.categoryFilters.querySelectorAll(".category-filter").forEach((item) => {
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

function renderCard(article) {
  const fragment = els.template.content.cloneNode(true);
  const favoriteButton = fragment.querySelector(".favorite-button");
  const key = articleKey(article);
  const mode = state.readingModes.get(key) || "guide";
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
  summaryBlock.hidden = mode === "guide" && !hasSummary;
  pendingBlock.hidden = mode !== "guide" || hasSummary;

  if (hasSummary) {
    const summary = fragment.querySelector(".summary");
    summary.classList.remove("annotatable-paragraph");
    renderAnnotatedText(summary, article.summaryZh, key, "guide:summary", highlightTermsFor(article), false);
    const list = fragment.querySelector(".key-points");
    for (const [index, point] of (article.keyPointsZh || []).entries()) {
      const li = document.createElement("li");
      renderAnnotatedText(li, point, key, `guide:keypoint-${index + 1}`, [], false);
      list.append(li);
    }
    const researchLens = fragment.querySelector(".research-lens");
    researchLens.classList.remove("annotatable-paragraph");
    renderAnnotatedText(researchLens, article.researchLensZh || "", key, "guide:lens", [], false);
  }

  const tags = fragment.querySelector(".tags");
  for (const keyword of article.keywordsZh || []) {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.textContent = keyword;
    tag.title = `搜尋「${keyword}」`;
    tag.addEventListener("click", () => {
      state.query = keyword;
      state.page = 1;
      els.searchInput.value = keyword;
      render();
      els.toolbar.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    tags.append(tag);
  }
  tags.hidden = !tags.childElementCount;

  const link = fragment.querySelector(".source-link");
  link.href = article.sourceUrl;
  link.hidden = !article.sourceUrl;

  const internalEnglish = article.textEn || state.internalTextById.get(article.id);
  if (internalEnglish) {
    const textContainer = fragment.querySelector(".english-full-text");
    for (const [index, paragraph] of internalEnglish.split(/\n+/).filter(Boolean).entries()) {
      const p = document.createElement("p");
      p.className = "annotatable-paragraph";
      renderAnnotatedText(p, paragraph, key, `en:p${index + 1}`);
      textContainer.append(p);
    }
  }

  const chineseValue = state.chineseTextByArticle.get(key);
  const chineseContainer = fragment.querySelector(".chinese-full-text");
  const chineseStatus = fragment.querySelector(".full-text-status");
  if (chineseValue?.paragraphsZh?.length) {
    for (const [index, paragraph] of chineseValue.paragraphsZh.entries()) {
      const p = document.createElement("p");
      p.className = "annotatable-paragraph";
      renderAnnotatedText(p, paragraph, key, `zh:p${index + 1}`);
      chineseContainer.append(p);
    }
  } else if (state.chineseTextLoading.has(key)) {
    chineseStatus.textContent = "中文全文載入中…";
    chineseStatus.hidden = false;
  } else if (chineseValue?.unavailable) {
    chineseStatus.textContent = "這篇中文全文尚未完成，請先閱讀英文原文。";
    chineseStatus.hidden = false;
  } else {
    chineseStatus.textContent = "切換後將載入中文全文。";
    chineseStatus.hidden = false;
  }

  fragment.querySelectorAll(".reading-mode").forEach((button) => {
    const buttonMode = button.dataset.mode;
    const active = buttonMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    if (buttonMode === "en" && !internalEnglish) {
      button.disabled = true;
      button.title = "英文全文尚未載入";
    }
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.readingModes.set(key, buttonMode);
      if (buttonMode === "zh") loadChineseFullText(article);
      else render();
    });
  });
  fragment.querySelectorAll(".reading-pane").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== mode;
  });

  const articleNotes = notesForArticle(key);
  const noteCount = fragment.querySelector(".note-count");
  const noteEmpty = fragment.querySelector(".note-empty");
  const noteList = fragment.querySelector(".note-index-list");
  const noteHint = fragment.querySelector(".note-index-hint");
  noteCount.textContent = articleNotes.length;
  noteEmpty.hidden = articleNotes.length > 0;
  for (let pageStart = 0; pageStart < articleNotes.length; pageStart += 4) {
    const page = document.createElement("div");
    page.className = "note-index-page";
    page.setAttribute("aria-label", `第 ${Math.floor(pageStart / 4) + 1} 組筆記`);
    for (const note of articleNotes.slice(pageStart, pageStart + 4)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "note-index-item";
      const language = document.createElement("small");
      language.className = "note-index-language";
      language.textContent = noteLanguageLabel(note);
      const body = document.createElement("span");
      body.className = "note-index-body";
      body.textContent = note.body || "（尚未填寫筆記內容）";
      button.title = `原文：${note.quote}`;
      button.append(language, body);
      button.addEventListener("click", () => focusNote(note));
      page.append(button);
    }
    noteList.append(page);
  }
  if (articleNotes.length > 4) {
    noteHint.hidden = false;
    noteHint.textContent = `↔ 左右滑動查看全部 ${articleNotes.length} 則筆記`;
  }
  return fragment;
}

function sortedArticles(articles) {
  return [...articles].sort((a, b) => {
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
  hideNotePreview();
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
  els.clearSearch.hidden = !state.query;
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
  renderQuickTags();
  syncUrl();
}

function renderPreservingViewport(viewport, readingPosition = null) {
  const root = document.documentElement;
  root.classList.add("preserve-scroll-position");
  render();
  restoreReadingPosition(readingPosition);
  window.scrollTo(viewport.x, viewport.y);
  requestAnimationFrame(() => {
    restoreReadingPosition(readingPosition);
    window.scrollTo(viewport.x, viewport.y);
    requestAnimationFrame(() => {
      restoreReadingPosition(readingPosition);
      window.scrollTo(viewport.x, viewport.y);
      root.classList.remove("preserve-scroll-position");
    });
  });
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.page = 1;
  render();
});
els.clearSearch.addEventListener("click", () => {
  state.query = "";
  state.page = 1;
  els.searchInput.value = "";
  render();
  els.searchInput.focus();
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
els.backToFilters.addEventListener("click", () => {
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  els.toolbar.scrollIntoView({ behavior, block: "start" });
});
window.addEventListener("scroll", scheduleBackToFiltersUpdate, { passive: true });
window.addEventListener("resize", scheduleBackToFiltersUpdate);
updateBackToFiltersVisibility();
els.clearFilters.addEventListener("click", () => {
  state.query = "";
  state.category = "全部";
  state.issue = "全部";
  state.favoritesOnly = false;
  state.page = 1;
  els.searchInput.value = "";
  els.issueSelect.value = "全部";
  els.categoryFilters.querySelectorAll(".category-filter").forEach((button, index) => {
    button.classList.toggle("active", index === 0);
  });
  render();
});
els.previousPage.addEventListener("click", () => goToPage(state.page - 1));
els.nextPage.addEventListener("click", () => goToPage(state.page + 1));
els.addSelectionNote.addEventListener("click", () => openNoteEditor(null, state.noteAnchorRect));
els.noteSave.addEventListener("click", saveCurrentNote);
els.noteDelete.addEventListener("click", deleteCurrentNote);
els.noteDrawerClose.addEventListener("click", closeNoteEditor);
els.noteEditor.addEventListener("input", () => els.noteEditor.setCustomValidity(""));
els.manageTagsButton.addEventListener("click", () => {
  els.tagQueryInput.value = state.query.trim();
  renderSavedTags();
  els.tagManager.showModal();
  setTimeout(() => els.tagQueryInput.focus(), 0);
});
els.tagManagerClose.addEventListener("click", () => els.tagManager.close());
els.tagManager.addEventListener("click", (event) => {
  if (event.target === els.tagManager) els.tagManager.close();
});
els.tagManagerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = els.tagQueryInput.value.trim();
  if (!query) return;
  const duplicate = state.savedTags.find((tag) => tag.query === query);
  if (duplicate) {
    duplicate.query = query;
    duplicate.label = query;
  } else {
    state.savedTags.push({
      id: crypto.randomUUID?.() || `tag-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: query,
      query,
      createdAt: new Date().toISOString(),
    });
  }
  saveSavedTags();
  els.tagQueryInput.value = "";
  renderSavedTags();
  renderQuickTags();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (els.noteDrawer.classList.contains("open")) closeNoteEditor();
  else hideSelectionToolbar();
});
document.addEventListener("pointerdown", (event) => {
  if (els.noteDrawer.classList.contains("open") && !els.noteDrawer.contains(event.target) && !els.selectionToolbar.contains(event.target)) {
    closeNoteEditor();
  }
  if (!els.selectionToolbar.hidden && !els.selectionToolbar.contains(event.target)) {
    hideSelectionToolbar();
  }
});
window.addEventListener("scroll", () => {
  hideSelectionToolbar();
  hideNotePreview();
}, { passive: true });

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
