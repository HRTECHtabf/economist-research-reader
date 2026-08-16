import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, process.argv[2] || ".cache/articles.raw.json");
const outputPath = resolve(projectRoot, process.argv[3] || "docs/data/articles.json");
const summaryCheckpointPath = resolve(projectRoot, ".cache/summaries.checkpoint.json");
const humanizedCheckpointPath = resolve(projectRoot, ".cache/humanized-summaries.checkpoint.json");
const manualSummariesPath = resolve(projectRoot, "scripts/manual-summaries.json");
const humanizerGuidePath = resolve(
  projectRoot,
  ".agents/skills/economist-humanizer-zh-tw/references/economist-research-summary.md",
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
const naturalStyleRules = [
  "直接從具體事件、主張或數據開場，不要固定以『本文指出』『文章聚焦』『作者認為』起句。",
  "採台灣研究員寫給同事的專業語氣；能用短句與動詞說清楚，就不要堆抽象名詞或轉折詞。",
  "避免宣傳式形容、職場黑話、否定對仗、三段排比、戲劇化金句與『總之』『未來可期』等昇華式結尾。",
  "三個重點必須各自提供不同且可核對的資訊，不要把同一結論換句話說三次。",
  "研究角度要指出可檢查的假設、資料、傳導機制或政策取捨，不要寫『值得深入閱讀』『可供參考』。",
  "使用台灣常用譯名與用語，例如川普、輝達、日圓、資訊、軟體、線上。",
].join("\n");

for (const name of ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]) {
  if (!env[name]) throw new Error(`尚未填寫 ${name}`);
}

const sectionCategories = {
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

function publishedDateFromUrl(sourceUrl, fallback = "") {
  const match = sourceUrl?.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (!match) return fallback;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return fallback;

  const monthName = new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const remainder = day % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  return `${monthName} ${day}${suffix} ${year}`;
}

function articleSourceHash(article) {
  return createHash("sha256")
    .update([
      article.section,
      article.titleEn,
      article.rubricEn,
      article.sourceUrl,
      article.textEn,
    ].join("\n"))
    .digest("hex");
}

function buildResponsesUrl(endpointValue, apiPathValue) {
  const endpoint = endpointValue.replace(/\/+$/, "");

  if (/\/openai\/v1\/responses$/i.test(endpoint)) return endpoint;
  if (/\/openai\/v1$/i.test(endpoint)) return `${endpoint}/responses`;

  const apiPath = (apiPathValue || "/openai/v1/")
    .replace(/^\/*/, "/")
    .replace(/\/*$/, "/");

  return `${endpoint}${apiPath}responses`;
}

const responseUrl = buildResponsesUrl(
  env.AZURE_OPENAI_ENDPOINT,
  env.AZURE_OPENAI_API_PATH,
);

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summaryZh", "keyPointsZh", "researchLensZh", "keywordsZh", "highlightTermsZh"],
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
    highlightTermsZh: {
      type: "array",
      minItems: 0,
      maxItems: 3,
      items: { type: "string", maxLength: 30 },
    },
  },
};

function endsAsCompleteSentence(value) {
  return typeof value === "string" && /[。！？…》〉」』”’]$/.test(value.trim());
}

function isCompleteBrief(value) {
  const highlightTermsAreValid =
    value?.highlightTermsZh === undefined ||
    (Array.isArray(value.highlightTermsZh) &&
      value.highlightTermsZh.length <= 3 &&
      value.highlightTermsZh.every(
        (term) => typeof term === "string" && value.summaryZh.includes(term),
      ));
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
    value.keywordsZh.length >= 3 &&
    highlightTermsAreValid
  );
}

function normalizeTaiwanUsage(brief) {
  const replacements = [
    [/特朗普/g, "川普"],
    [/英偉達/g, "輝達"],
    [/日元/g, "日圓"],
    [/信息/g, "資訊"],
    [/軟件/g, "軟體"],
    [/在線/g, "線上"],
  ];
  const normalize = (value) => replacements.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
  return {
    summaryZh: normalize(brief.summaryZh),
    keyPointsZh: brief.keyPointsZh.map(normalize),
    researchLensZh: normalize(brief.researchLensZh),
    keywordsZh: brief.keywordsZh.map(normalize),
    highlightTermsZh: (brief.highlightTermsZh || []).map(normalize),
  };
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
      "highlightTermsZh 通常選 1–3 個在 summaryZh 中逐字出現的短語，只能選關鍵結論、因果機制或重要證據；不要只選國名、地名、人名、機構名或普通名詞。若沒有適合的短語，回傳空陣列，不要硬湊。",
      naturalStyleRules,
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
      naturalStyleRules,
      "保留 JSON 欄位與陣列數量。highlightTermsZh 必須重新檢查，只保留 summaryZh 中逐字出現的關鍵結論、因果機制或重要證據；不得只選國名、地名、人名、機構名或普通名詞。若沒有適合的短語，回傳空陣列，不要硬湊。輸出 JSON，不要使用 Markdown。",
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
  const failures = [];
  const itemIds = new Set(items.map((article) => article.id));
  for (const id of Object.keys(values)) {
    if (!itemIds.has(id)) delete values[id];
  }
  for (const article of items) {
    const storedHash = values[article.id]?.sourceHash;
    if (
      values[article.id] &&
      (!isCompleteBrief(values[article.id]) ||
        (storedHash && storedHash !== articleSourceHash(article)))
    ) {
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
        try {
          const result = await processItem(article);
          if (isCompleteBrief(result)) {
            values[article.id] = {
              ...result,
              sourceHash: articleSourceHash(article),
            };
            break;
          }
          if (attempt === 3) {
            failures.push(`${article.titleEn}：輸出未通過完整性與長度檢查`);
          } else {
            console.log(`[${label}] 輸出不完整或超長，第 ${attempt + 1} 次嘗試。`);
          }
        } catch (error) {
          if (attempt === 3) {
            failures.push(`${article.titleEn}：${error.message}`);
          } else {
            console.log(`[${label}] 單篇處理失敗，第 ${attempt + 1} 次嘗試：${article.titleEn}`);
          }
        }
      }
      if (values[article.id]) saveCheckpoint(checkpointPath, values);
    }
  }
  await Promise.all([worker(), worker()]);
  if (failures.length) {
    throw new Error(`${label}有 ${failures.length} 篇失敗：\n${failures.join("\n")}`);
  }
}

const previousOutput = existsSync(outputPath)
  ? JSON.parse(readFileSync(outputPath, "utf8"))
  : null;
const previousCurrentArticles = new Map(
  (previousOutput?.articles || [])
    .filter((article) => (article.issueKey || previousOutput.issueKey) === source.issueKey)
    .map((article) => [article.id, article]),
);
const reusableBriefs = Object.fromEntries(source.articles.flatMap((article) => {
  const previous = previousCurrentArticles.get(article.id);
  if (
    !previous?.summaryZh ||
    !previous.sourceHash ||
    previous.sourceHash !== articleSourceHash(article)
  ) return [];
  return [[article.id, {
    summaryZh: previous.summaryZh,
    keyPointsZh: previous.keyPointsZh,
    researchLensZh: previous.researchLensZh,
    keywordsZh: previous.keywordsZh,
    highlightTermsZh: previous.highlightTermsZh || [],
    sourceHash: previous.sourceHash,
  }]];
}));
const changedArticleIds = new Set(source.articles.flatMap((article) => {
  const previous = previousCurrentArticles.get(article.id);
  if (
    previous?.sourceHash &&
    previous.sourceHash !== articleSourceHash(article)
  ) return [article.id];
  return [];
}));

const articlesToProcess = source.articles;
const manualSummaries = readCheckpoint(manualSummariesPath);
const summaryCheckpoint = readCheckpoint(summaryCheckpointPath);
const humanizedCheckpoint = readCheckpoint(humanizedCheckpointPath);
for (const id of changedArticleIds) {
  delete summaryCheckpoint[id];
  delete humanizedCheckpoint[id];
  delete manualSummaries[id];
}

const summaries = {
  ...summaryCheckpoint,
  ...reusableBriefs,
  ...manualSummaries,
};
await processWithWorkers({
  items: articlesToProcess,
  values: summaries,
  label: "初稿",
  processItem: summarize,
  checkpointPath: summaryCheckpointPath,
});

const humanizedSummaries = {
  ...humanizedCheckpoint,
  ...reusableBriefs,
  ...manualSummaries,
};
await processWithWorkers({
  items: articlesToProcess,
  values: humanizedSummaries,
  label: "自然化",
  processItem: (article) => humanize(article, summaries[article.id]),
  checkpointPath: humanizedCheckpointPath,
});

const currentIssueArticles = source.articles.map((article) => {
  const storedSummary = humanizedSummaries[article.id];
  const summary = storedSummary ? normalizeTaiwanUsage(storedSummary) : null;
  return {
    id: article.id,
    issueKey: source.issueKey,
    issueDate: source.issueDate,
    section: article.section,
    categoryZh: sectionCategories[article.section] || "其他",
    titleEn: article.titleEn,
    rubricEn: article.rubricEn,
    publishedEn: publishedDateFromUrl(article.sourceUrl, article.publishedEn),
    sourceUrl: article.sourceUrl,
    sourceHash: articleSourceHash(article),
    featured: Boolean(summary),
    summaryZh: summary?.summaryZh || null,
    keyPointsZh: summary?.keyPointsZh || [],
    researchLensZh: summary?.researchLensZh || null,
    keywordsZh: summary?.keywordsZh || [],
    highlightTermsZh: summary?.highlightTermsZh || [],
    highlightTermsVersion: "important-content-v1",
  };
});

const previousArticles = (previousOutput?.articles || [])
  .filter((article) => (article.issueKey || previousOutput.issueKey) !== source.issueKey)
  .map((article) => ({
    ...article,
    issueKey: article.issueKey || previousOutput.issueKey,
    issueDate: article.issueDate || previousOutput.issueDate,
    categoryZh: article.categoryZh || sectionCategories[article.section] || "其他",
    publishedEn: publishedDateFromUrl(article.sourceUrl, article.publishedEn),
  }));
const articles = [...currentIssueArticles, ...previousArticles];

const output = {
  publication: source.publication,
  issueKey: source.issueKey,
  issueFolder: source.issueFolder,
  issueDate: source.issueDate,
  sourceFolderSha: source.sourceFolderSha || previousOutput?.sourceFolderSha || null,
  sourceUpdatedAt: source.sourceModifiedAt || source.parsedAt,
  generatedAt: new Date().toISOString(),
  updateCadenceZh: "每週一期；本站於週五下午至深夜偵測新一期",
  sectionCount: source.sectionCount,
  articleCount: source.articleCount,
  summaryCount: currentIssueArticles.filter((article) => article.summaryZh).length,
  featuredCount: currentIssueArticles.filter((article) => article.summaryZh).length,
  totalArticleCount: articles.length,
  issueCount: new Set(articles.map((article) => article.issueKey)).size,
  highlightPolicyVersion: "important-content-v1",
  articles,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`完成本期 ${output.summaryCount} 篇繁中研究摘要與自然化校修。`);
