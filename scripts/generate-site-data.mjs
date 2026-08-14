import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, process.argv[2] || ".cache/articles.raw.json");
const outputPath = resolve(projectRoot, process.argv[3] || "docs/data/articles.json");
const summaryCheckpointPath = resolve(projectRoot, ".cache/summaries.checkpoint.json");
const humanizedCheckpointPath = resolve(projectRoot, ".cache/humanized-summaries.checkpoint.json");
const humanizerGuidePath = resolve(
  projectRoot,
  ".agents/skills/humanizer-zh-tw/references/economist-research-summary.md",
);

function readEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;

  for (const sourceLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt < 1) continue;
    const name = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

function readCheckpoint(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

function saveCheckpoint(path, values) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

const env = {
  ...readEnv(resolve(projectRoot, ".env.local")),
  ...process.env,
};
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const humanizerGuide = readFileSync(humanizerGuidePath, "utf8");

for (const name of ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]) {
  if (!env[name]) throw new Error(`尚未填寫 ${name}`);
}

const preferredTitlesByIssue = {
  "2026.08.15": [
    "China has wrested control of oil markets from OPEC",
    "The yuan is more than a symptom of global imbalances",
    "Zhu Rongji’s death is a reminder of how much has changed in China",
    "Taking Taiwan’s democracy hostage",
    "Donald Trump is getting a new tariff weapon against Russia",
    "Japan's long-overdue revamp of its intelligence services",
    "Nvidia’s great silicon showdown",
    "AI agents lie, cheat and steal. That is putting off users",
    "China is now the world’s great oil power",
    "Is China’s debt-bomb squad about to blow up?",
    "When Japan buys yen, it unwinds a dangerous trade",
    "Maybe scientific progress isn’t slowing, after all",
  ],
};

const sectionWeights = {
  "Finance & economics": 100,
  Leaders: 92,
  China: 88,
  International: 84,
  Briefing: 80,
  Business: 76,
  "Science & technology": 72,
  Asia: 62,
  "United States": 60,
  Europe: 56,
  "The Americas": 54,
  "Middle East & Africa": 54,
  Britain: 48,
  "By Invitation": 82,
};

const researchTerms = [
  "econom",
  "market",
  "bank",
  "debt",
  "currency",
  "yuan",
  "yen",
  "oil",
  "trade",
  "tariff",
  "inflation",
  "interest",
  "china",
  "taiwan",
  "ai ",
  "nvidia",
  "technology",
  "investment",
  "finance",
];

function selectFeaturedArticles() {
  const preferred = preferredTitlesByIssue[source.issueKey];
  if (preferred) {
    const titleSet = new Set(preferred);
    const matches = source.articles.filter((article) => titleSet.has(article.titleEn));
    if (matches.length === preferred.length) return matches;
  }

  const ranked = source.articles
    .filter((article) => !["Letters", "Obituary", "The world this week"].includes(article.section))
    .map((article, index) => {
      const haystack = `${article.titleEn} ${article.rubricEn}`.toLowerCase();
      const termScore = researchTerms.reduce(
        (score, term) => score + (haystack.includes(term) ? 12 : 0),
        0,
      );
      return {
        article,
        score: (sectionWeights[article.section] || 40) + termScore - index / 1000,
      };
    })
    .sort((a, b) => b.score - a.score);

  const sectionCounts = new Map();
  const selected = [];
  for (const item of ranked) {
    const count = sectionCounts.get(item.article.section) || 0;
    if (count >= 4) continue;
    selected.push(item.article);
    sectionCounts.set(item.article.section, count + 1);
    if (selected.length === 12) break;
  }
  return selected;
}

const endpoint = env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "");
const apiPath = (env.AZURE_OPENAI_API_PATH || "/openai/v1/")
  .replace(/^\/*/, "/")
  .replace(/\/*$/, "/");
const responseUrl = `${endpoint}${apiPath}responses`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summaryZh", "keyPointsZh", "researchLensZh", "keywordsZh"],
  properties: {
    // The requested length is shorter; these larger schema ceilings prevent the
    // model from satisfying JSON Schema by cutting a sentence mid-thought.
    summaryZh: { type: "string", maxLength: 360 },
    keyPointsZh: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string", maxLength: 160 },
    },
    researchLensZh: { type: "string", maxLength: 220 },
    keywordsZh: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string" },
    },
  },
};

function endsAsCompleteSentence(value) {
  return typeof value === "string" && /[。！？…》〉」』”’]$/.test(value.trim());
}

function isCompleteBrief(value) {
  return (
    value &&
    endsAsCompleteSentence(value.summaryZh) &&
    value.summaryZh.length >= 120 &&
    value.summaryZh.length <= 280 &&
    endsAsCompleteSentence(value.researchLensZh) &&
    value.researchLensZh.length >= 40 &&
    value.researchLensZh.length <= 160 &&
    Array.isArray(value.keyPointsZh) &&
    value.keyPointsZh.length === 3 &&
    value.keyPointsZh.every(
      (point) => endsAsCompleteSentence(point) && point.length >= 20 && point.length <= 120,
    ) &&
    Array.isArray(value.keywordsZh) &&
    value.keywordsZh.length >= 3
  );
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function parseJsonText(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Azure 回應的 JSON 不完整");
  }
}

async function callAzureJson({ instructions, input, schemaName }, structured = true) {
  const body = {
    model: env.AZURE_OPENAI_DEPLOYMENT,
    store: false,
    max_output_tokens: 1400,
    instructions,
    input,
  };

  if (structured) {
    body.text = {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    };
  }

  const response = await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.AZURE_OPENAI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return parseJsonText(extractOutputText(payload));
}

async function callWithFallback(request) {
  try {
    return await callAzureJson(request, true);
  } catch (error) {
    if (error.status !== 400 && error.message !== "Azure 回應的 JSON 不完整") {
      throw error;
    }
    return callAzureJson(request, false);
  }
}

function summarize(article) {
  return callWithFallback({
    schemaName: "research_brief",
    instructions: [
      "你是台灣金融與經濟研究機構的資深研究助理。",
      "根據英文文章，以繁體中文（台灣用語）製作第一版研究導讀。",
      "不得補造原文沒有的事實、數字、來源或因果關係。",
      "summaryZh 限 180–240 個中文字；keyPointsZh 剛好三點，每點 45–90 個中文字；researchLensZh 限 60–120 個中文字。",
      "輸出 JSON，不要使用 Markdown。",
    ].join("\n"),
    input: [
      `欄目：${article.section}`,
      `標題：${article.titleEn}`,
      article.rubricEn ? `副標：${article.rubricEn}` : "",
      `文章內容：\n${article.textEn.slice(0, 12000)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

function humanize(article, draft) {
  return callWithFallback({
    schemaName: "humanized_research_brief",
    instructions: [
      "你是繁體中文研究摘要編輯。請校修第一版摘要，降低公式化 AI 腔。",
      "必須鎖定英文原文的事實、數字、因果關係與不確定程度，不得新增內容。",
      "保留 JSON 欄位與陣列數量。輸出 JSON，不要使用 Markdown。",
      humanizerGuide,
    ].join("\n\n"),
    input: [
      `欄目：${article.section}`,
      `英文標題：${article.titleEn}`,
      article.rubricEn ? `英文副標：${article.rubricEn}` : "",
      `英文原文核對資料：\n${article.textEn.slice(0, 10000)}`,
      `第一版中文摘要：\n${JSON.stringify(draft)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

async function processWithWorkers({ items, values, label, processItem, checkpointPath }) {
  for (const article of items) {
    if (values[article.id] && !isCompleteBrief(values[article.id])) {
      console.log(`[檢查] 移除不完整暫存：${article.titleEn}`);
      delete values[article.id];
    }
  }
  saveCheckpoint(checkpointPath, values);

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      const article = items[index];
      if (values[article.id]) {
        console.log(`[${label} ${index + 1}/${items.length}] 已有暫存：${article.titleEn}`);
        continue;
      }
      console.log(`[${label} ${index + 1}/${items.length}] 正在處理：${article.titleEn}`);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await processItem(article);
        if (isCompleteBrief(result)) {
          values[article.id] = result;
          break;
        }
        if (attempt === 3) {
          throw new Error(`三次輸出皆未通過完整性與長度檢查：${article.titleEn}`);
        }
        console.log(`[${label}] 輸出不完整或超長，第 ${attempt + 1} 次嘗試。`);
      }
      saveCheckpoint(checkpointPath, values);
    }
  }
  await Promise.all([worker(), worker()]);
}

const selected = selectFeaturedArticles();
if (selected.length !== 12) throw new Error(`精選文章不足：${selected.length}`);

const summaries = readCheckpoint(summaryCheckpointPath);
await processWithWorkers({
  items: selected,
  values: summaries,
  label: "初稿",
  processItem: summarize,
  checkpointPath: summaryCheckpointPath,
});

const humanizedSummaries = readCheckpoint(humanizedCheckpointPath);
await processWithWorkers({
  items: selected,
  values: humanizedSummaries,
  label: "自然化",
  processItem: (article) => humanize(article, summaries[article.id]),
  checkpointPath: humanizedCheckpointPath,
});

const selectedIds = new Set(selected.map((article) => article.id));
const articles = source.articles.map((article) => {
  const summary = selectedIds.has(article.id) ? humanizedSummaries[article.id] : null;
  return {
    id: article.id,
    section: article.section,
    titleEn: article.titleEn,
    rubricEn: article.rubricEn,
    publishedEn: article.publishedEn,
    sourceUrl: article.sourceUrl,
    featured: Boolean(summary),
    summaryZh: summary?.summaryZh || null,
    keyPointsZh: summary?.keyPointsZh || [],
    researchLensZh: summary?.researchLensZh || null,
    keywordsZh: summary?.keywordsZh || [],
  };
});

const output = {
  publication: source.publication,
  issueKey: source.issueKey,
  issueFolder: source.issueFolder,
  issueDate: source.issueDate,
  sourceUpdatedAt: source.sourceModifiedAt || source.parsedAt,
  generatedAt: new Date().toISOString(),
  updateCadenceZh: "每週一期；本站於週五下午至深夜偵測新一期",
  sectionCount: source.sectionCount,
  articleCount: source.articleCount,
  featuredCount: articles.filter((article) => article.featured).length,
  sourceRepository: "https://github.com/hehonghui/awesome-english-ebooks",
  issueRepository: `https://github.com/hehonghui/awesome-english-ebooks/tree/master/01_economist/${source.issueFolder}`,
  articles,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`完成 ${output.featuredCount} 篇繁中研究導讀與自然化校修。`);
