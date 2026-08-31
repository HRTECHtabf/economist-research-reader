import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  GENERAL_KEYWORD_POLICY,
  GENERAL_KEYWORD_TAXONOMY,
} from "./general-keyword-taxonomy.mjs";
import {
  retryAfterMilliseconds,
  withTransientRetries,
} from "./lib/transient-retry.mjs";
import { briefLengthProfile } from "./lib/brief-length-profile.mjs";
import { chooseNaturalizationResult } from "./lib/naturalization-fallback.mjs";
import {
  CONTENT_FILTER_REASON,
  describeAzureContentFilter,
  isContentFilterError,
} from "./lib/content-filter-policy.mjs";
import {
  MAX_ARTICLE_ATTEMPTS,
  MAX_SKIPPED_ARTICLES,
  RETRY_EXHAUSTED_REASON,
  isSystemicFailureCount,
  sanitizePublicFailureMessage,
} from "./lib/article-failure-policy.mjs";

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
const generationReportPath = resolve(projectRoot, ".cache/summary-generation.report.json");
const SUMMARY_VERSION = "research-brief-v4";
const HUMANIZER_VERSION = "economist-humanizer-v4";
const MAX_BRIEF_ATTEMPTS = MAX_ARTICLE_ATTEMPTS;
// Article-level attempts are the single source of truth: one API attempt per round,
// three rounds total, then quarantine or systemic-failure handling.
const DEFAULT_TRANSIENT_API_ATTEMPTS = 1;

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
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

const env = {
  ...readEnv(resolve(projectRoot, ".env.local")),
  ...process.env,
};
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const transientApiAttempts = DEFAULT_TRANSIENT_API_ATTEMPTS;
const generationReport = {
  version: 1,
  issueKey: source.issueKey,
  startedAt: new Date().toISOString(),
  stages: {},
};
saveCheckpoint(generationReportPath, generationReport);
const humanizerGuide = readFileSync(humanizerGuidePath, "utf8");
const naturalStyleRules = [
  "直接從具體事件、主張或數據開場，不要固定以『本文指出』『文章聚焦』『作者認為』起句。",
  "採台灣研究員寫給同事的專業語氣；能用短句與動詞說清楚，就不要堆抽象名詞或轉折詞。",
  "避免宣傳式形容、職場黑話、否定對仗、三段排比、戲劇化金句與『總之』『未來可期』等昇華式結尾。",
  "論述重點依內容使用三至五點，每點只寫一個可核對的主張或事件，嚴格控制在 35–65 個中文字並以完整標點收尾。每點必須能獨立閱讀，開頭直接交代主詞、事件或判斷；不要用短標題加冒號，也不要用分號把不同事件塞在一起。",
  "中文摘要、論述重點與研究角度都要自然化；避免『文章同時指出』『原因與風險』『其他變化』等依賴前文的起句。",
  "研究角度要指出可檢查的假設、資料、傳導機制或政策取捨，不要寫『值得深入閱讀』『可供參考』。",
  "使用台灣常用譯名、用語與數字寫法，例如川普、輝達、日圓、資訊、軟體、線上；把 1.5 million 寫成 150萬，不要寫成 1.5百萬。",
].join("\n");
const aiStylePattern = /綜上所述|總體而言|一言以蔽之|未來可期|值得深入閱讀|可供參考|值得注意的是|由此可見|賦能|助力|底層邏輯|深遠影響|重要里程碑|不只是.{0,35}而是|不僅.{0,35}更/u;
const contextlessPointOpening = /^(?:文章|本文|文中)(?:同時|另|也|還|進一步)|^(?:原因與風險|其他變化|也有|另一個|此外|另一方面|至於|這些|此舉|上述)/u;
const labelStylePointOpening = /^(?:[^，。！？；：]{0,12}(?:背景|原因|風險|影響|展望|機制|變化|挑戰|意義|啟示|重點|面向|因素|條件|問題))：/u;

function standaloneKeyPointFailures(point) {
  if (typeof point !== "string") return ["不是文字"];
  const failures = [];
  if (contextlessPointOpening.test(point)) failures.push("以依賴前文的語句開頭");
  if (labelStylePointOpening.test(point)) failures.push("以名詞式短標題加冒號開頭");
  if ((point.match(/；/g) || []).length > 1) failures.push("使用超過一個分號");
  if (aiStylePattern.test(point)) failures.push("含公式化 AI 句型");
  return failures;
}

function isStandaloneKeyPoint(point) {
  return standaloneKeyPointFailures(point).length === 0;
}

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
  "By Invitation": "其他",
  Letters: "其他",
  Culture: "文化與人物",
  Obituary: "文化與人物",
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
      maxItems: 5,
      items: { type: "string", maxLength: 86 },
    },
    researchLensZh: { type: "string", maxLength: 220 },
    keywordsZh: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", enum: GENERAL_KEYWORD_TAXONOMY },
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

function isCompleteBrief(value, article) {
  const lengthProfile = briefLengthProfile(article);
  const keywordsAreGeneral =
    Array.isArray(value?.keywordsZh) &&
    value.keywordsZh.every((keyword) => GENERAL_KEYWORD_TAXONOMY.includes(keyword));
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
    value.summaryZh.length >= lengthProfile.summaryMin &&
    value.summaryZh.length <= lengthProfile.summaryMax &&
    !/^(?:本文指出|文章聚焦|作者認為)/u.test(value.summaryZh) &&
    !aiStylePattern.test(value.summaryZh) &&
    endsAsCompleteSentence(value.researchLensZh) &&
    value.researchLensZh.length >= lengthProfile.researchLensMin &&
    value.researchLensZh.length <= lengthProfile.researchLensMax &&
    !aiStylePattern.test(value.researchLensZh) &&
    Array.isArray(value.keyPointsZh) &&
    value.keyPointsZh.length >= 3 &&
    value.keyPointsZh.length <= 5 &&
    value.keyPointsZh.every(
      (point) => endsAsCompleteSentence(point) &&
        point.length >= lengthProfile.pointMin &&
        point.length <= lengthProfile.pointMax &&
        isStandaloneKeyPoint(point),
    ) &&
    Array.isArray(value.keywordsZh) &&
    value.keywordsZh.length >= 3 &&
    keywordsAreGeneral &&
    highlightTermsAreValid
  );
}

function briefValidationFailures(value, article) {
  const lengthProfile = briefLengthProfile(article);
  const failures = [];
  if (!value || typeof value !== "object") return ["不是物件"];
  if (!endsAsCompleteSentence(value.summaryZh)) failures.push("摘要句尾不完整");
  if (
    typeof value.summaryZh !== "string" ||
    value.summaryZh.length < lengthProfile.summaryMin ||
    value.summaryZh.length > lengthProfile.summaryMax
  ) {
    failures.push(`摘要長度 ${value.summaryZh?.length ?? 0}`);
  }
  if (/^(?:本文指出|文章聚焦|作者認為)/u.test(value.summaryZh || "")) failures.push("摘要以公式化來源提示開場");
  if (aiStylePattern.test(value.summaryZh || "")) failures.push("摘要含公式化 AI 語句");
  if (!endsAsCompleteSentence(value.researchLensZh)) failures.push("研究角度句尾不完整");
  if (
    typeof value.researchLensZh !== "string" ||
    value.researchLensZh.length < 50 ||
    value.researchLensZh.length > 135
  ) failures.push(`研究角度長度 ${value.researchLensZh?.length ?? 0}`);
  if (aiStylePattern.test(value.researchLensZh || "")) failures.push("研究角度含公式化 AI 語句");
  if (!Array.isArray(value.keyPointsZh) || value.keyPointsZh.length < 3 || value.keyPointsZh.length > 5) {
    failures.push(`重點數量 ${value.keyPointsZh?.length ?? 0}`);
  } else {
    value.keyPointsZh.forEach((point, index) => {
      if (!endsAsCompleteSentence(point)) failures.push(`重點 ${index + 1} 句尾不完整`);
      if (
        typeof point !== "string" ||
        point.length < lengthProfile.pointMin ||
        point.length > lengthProfile.pointMax
      ) {
        failures.push(`重點 ${index + 1} 長度 ${point?.length ?? 0}`);
      }
      for (const failure of standaloneKeyPointFailures(point)) {
        failures.push(`重點 ${index + 1} ${failure}：${JSON.stringify(point)}`);
      }
    });
  }
  if (!Array.isArray(value.keywordsZh) || value.keywordsZh.length < 3 || value.keywordsZh.length > 5) {
    failures.push(`關鍵字數量 ${value.keywordsZh?.length ?? 0}`);
  } else if (value.keywordsZh.some((keyword) => !GENERAL_KEYWORD_TAXONOMY.includes(keyword))) {
    failures.push("關鍵字不在廣義標籤詞彙表");
  }
  if (!Array.isArray(value.highlightTermsZh) || value.highlightTermsZh.length > 3) {
    failures.push(`標示數量 ${value.highlightTermsZh?.length ?? 0}`);
  } else if (value.highlightTermsZh.some((term) => !value.summaryZh?.includes(term))) {
    failures.push("摘要中找不到標示短語");
  }
  return failures;
}

function normalizeGeneratedBrief(value) {
  if (!value || typeof value !== "object") return value;
  const normalizeText = (text) => typeof text === "string"
    ? text.trim()
      .replace(/(\d+(?:\.\d+)?)百萬/gu, (_, number) => `${Number(number) * 100}萬`)
      .replace(/(\d+(?:\.\d+)?)十億/gu, (_, number) => `${Number(number) * 10}億`)
    : text;
  const normalizeSentence = (text) => {
    const normalized = normalizeText(text);
    if (typeof normalized !== "string" || !normalized || endsAsCompleteSentence(normalized)) {
      return normalized;
    }
    return `${normalized.replace(/[，、；：,;:.]+$/u, "")}。`;
  };
  const summaryZh = normalizeSentence(value.summaryZh);
  const highlightTermsZh = Array.isArray(value.highlightTermsZh)
    ? [...new Set(value.highlightTermsZh.map(normalizeText))]
      .filter((term) => typeof term === "string" && summaryZh?.includes(term))
      .slice(0, 3)
    : value.highlightTermsZh;
  return {
    ...value,
    summaryZh,
    keyPointsZh: Array.isArray(value.keyPointsZh)
      ? value.keyPointsZh.map(normalizeSentence)
      : value.keyPointsZh,
    researchLensZh: normalizeSentence(value.researchLensZh),
    keywordsZh: Array.isArray(value.keywordsZh)
      ? value.keywordsZh.map(normalizeText)
      : value.keywordsZh,
    highlightTermsZh,
  };
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
    max_output_tokens: 2600,
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

  return withTransientRetries(async () => {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.AZURE_OPENAI_API_KEY,
      },
      body: JSON.stringify(body),
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(responseText);
    } catch {
      if (response.ok) throw new Error("Azure 回應的 JSON 不完整");
    }

    if (!response.ok) {
      const error = new Error(
        describeAzureContentFilter(payload) || payload?.error?.message || `HTTP ${response.status}`,
      );
      error.status = response.status;
      error.retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
      throw error;
    }

    const outputText = extractOutputText(payload);
    if (!outputText) {
      const reason = payload?.incomplete_details?.reason || payload?.status || "沒有文字輸出";
      throw new Error(`Azure 回應沒有完整文字（${reason}）`);
    }
    return parseJsonText(outputText);
  }, {
    maxAttempts: transientApiAttempts,
    onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
      console.warn(
        `[Azure 暫時性錯誤 ${attempt}/${maxAttempts - 1}] ${error.message}；${Math.ceil(delayMs / 1000)} 秒後重試。`,
      );
    },
  });
}

async function callWithFallback(request) {
  try {
    return await callAzureJson(request, true);
  } catch (error) {
    if (isContentFilterError(error)) throw error;
    if (error.status !== 400 && error.message !== "Azure 回應的 JSON 不完整") {
      throw error;
    }
    return callAzureJson(request, false);
  }
}

function retryFeedback({ attempt = 1, previousResult, validationFailures = [] } = {}) {
  if (attempt <= 1 || !previousResult || validationFailures.length === 0) return "";

  return [
    `這是第 ${attempt} 次嘗試。請修訂上一版，不要從頭產生一份無關的新版本。`,
    `上一版未通過項目：${validationFailures.join("、")}。`,
    "只針對上述項目做必要修正，並重新核對英文原文；重點必須改由具體主詞、政策、市場或事件開頭，不得原句照抄。",
    "保留正確的人物、數字、因果關係與不確定程度，不得為了通過格式檢查而新增事實。",
    `上一版 JSON：\n${JSON.stringify(previousResult)}`,
  ].join("\n");
}

function summarize(article, retryContext) {
  const lengthProfile = briefLengthProfile(article);
  return callWithFallback({
    schemaName: "research_brief",
    instructions: [
      "你是台灣金融與經濟研究機構的資深研究助理。",
      "根據英文文章，以繁體中文（台灣用語）製作第一版研究導讀。",
      "不得補造原文沒有的事實、數字、來源或因果關係。",
      lengthProfile.instruction,
      "highlightTermsZh 通常選 1–3 個在 summaryZh 中逐字出現的短語，只能選關鍵結論、因果機制或重要證據；不要只選國名、地名、人名、機構名或普通名詞。若沒有適合的短語，回傳空陣列，不要硬湊。",
      GENERAL_KEYWORD_POLICY,
      naturalStyleRules,
      "輸出 JSON，不要使用 Markdown。",
    ].join("\n"),
    input: [
      `欄目：${article.section}`,
      `標題：${article.titleEn}`,
      article.rubricEn ? `副標：${article.rubricEn}` : "",
      `文章內容：\n${article.textEn}`,
      retryFeedback(retryContext),
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

async function humanize(article, draft, retryContext) {
  const lengthProfile = briefLengthProfile(article);
  const candidate = normalizeGeneratedBrief(await callWithFallback({
    schemaName: "humanized_research_brief",
    instructions: [
      "你是繁體中文研究摘要編輯。請校修第一版摘要，降低公式化 AI 腔。",
      "必須鎖定英文原文的事實、數字、因果關係與不確定程度，不得新增內容。",
      naturalStyleRules,
      lengthProfile.instruction,
      GENERAL_KEYWORD_POLICY,
      "保留 JSON 欄位；keyPointsZh 可依內容調整為三至五點。highlightTermsZh 必須重新檢查，只保留 summaryZh 中逐字出現的關鍵結論、因果機制或重要證據；不得只選國名、地名、人名、機構名或普通名詞。若沒有適合的短語，回傳空陣列，不要硬湊。輸出 JSON，不要使用 Markdown。",
      humanizerGuide,
    ].join("\n\n"),
    input: [
      `欄目：${article.section}`,
      `英文標題：${article.titleEn}`,
      article.rubricEn ? `英文副標：${article.rubricEn}` : "",
      `英文原文核對資料：\n${article.textEn}`,
      `第一版中文摘要：\n${JSON.stringify(draft)}`,
      retryFeedback(retryContext),
    ]
      .filter(Boolean)
      .join("\n\n"),
  }));
  const decision = chooseNaturalizationResult({
    draft,
    candidate,
    attempt: retryContext?.attempt || 1,
    attemptsPerRound: MAX_BRIEF_ATTEMPTS,
    isComplete: (value) => isCompleteBrief(value, article),
  });
  if (decision.fellBack) {
    console.warn(
      `[自然化安全回退] ${article.titleEn} 連續 ${MAX_BRIEF_ATTEMPTS} 次未能改善合格初稿，保留初稿並繼續。`,
    );
  }
  return decision.value;
}

async function processWithWorkers({ items, values, label, processItem, checkpointPath, processingVersion }) {
  const itemIds = new Set(items.map((article) => article.id));
  const articlesById = new Map(items.map((article) => [article.id, article]));
  const retryContexts = new Map();
  for (const id of Object.keys(values)) {
    if (!itemIds.has(id)) delete values[id];
  }
  for (const article of items) {
    const storedHash = values[article.id]?.sourceHash;
    if (
      values[article.id] &&
      (!isCompleteBrief(values[article.id], article) ||
        (storedHash && storedHash !== articleSourceHash(article)) ||
        values[article.id]?.processingVersion !== processingVersion)
    ) {
      console.log(`[檢查] 移除不完整暫存：${article.titleEn}`);
      delete values[article.id];
    }
  }
  saveCheckpoint(checkpointPath, values);

  const stageReport = {
    label,
    processingVersion,
    totalArticles: items.length,
    completedArticles: Object.keys(values).length,
    maximumAttemptsPerArticle: MAX_BRIEF_ATTEMPTS,
    startedAt: new Date().toISOString(),
    failures: [],
  };
  generationReport.stages[label] = stageReport;
  saveCheckpoint(generationReportPath, generationReport);

  async function processArticle(article, index = items.indexOf(article)) {
    console.log(`[${label} ${index + 1}/${items.length}] 正在處理：${article.titleEn}`);
    const storedRetryContext = retryContexts.get(article.id) || {};
    let previousResult = storedRetryContext.previousResult || null;
    let validationFailures = storedRetryContext.validationFailures || [];
    const previousAttempts = storedRetryContext.attempts || 0;
    let lastFailure = "未完成";
    for (let attempt = 1; attempt <= MAX_BRIEF_ATTEMPTS; attempt += 1) {
      const totalAttempt = previousAttempts + attempt;
      try {
        const result = normalizeGeneratedBrief(await processItem(article, {
          attempt: totalAttempt,
          previousResult,
          validationFailures,
        }));
        if (isCompleteBrief(result, article)) {
          values[article.id] = {
            ...result,
            sourceHash: articleSourceHash(article),
            processingVersion,
          };
          retryContexts.delete(article.id);
          saveCheckpoint(checkpointPath, values);
          return { key: article.id, titleEn: article.titleEn };
        }
        previousResult = result;
        validationFailures = briefValidationFailures(result, article);
        lastFailure = validationFailures.join("、");
        retryContexts.set(article.id, {
          attempts: totalAttempt,
          previousResult,
          validationFailures,
        });
        if (attempt < MAX_BRIEF_ATTEMPTS) {
          console.log(`[${label}] ${lastFailure}，第 ${totalAttempt + 1} 次嘗試。`);
        }
      } catch (error) {
        lastFailure = error.message;
        if (isContentFilterError(error)) {
          error.attempts = 1;
          error.reason = CONTENT_FILTER_REASON;
          throw error;
        }
        retryContexts.set(article.id, {
          attempts: totalAttempt,
          previousResult,
          validationFailures,
        });
        if (attempt < MAX_BRIEF_ATTEMPTS) {
          console.log(`[${label}] 單篇處理失敗，第 ${totalAttempt + 1} 次嘗試：${article.titleEn}（${lastFailure}）`);
        }
      }
    }
    throw new Error(lastFailure);
  }

  let nextIndex = 0;
  const initialFailures = [];
  async function worker() {
    while (true) {
      if (isSystemicFailureCount(initialFailures.length)) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      const article = items[index];
      if (values[article.id]) {
        console.log(`[${label} ${index + 1}/${items.length}] 已有暫存：${article.titleEn}`);
        continue;
      }
      try {
        await processArticle(article, index);
      } catch (error) {
        initialFailures.push({
          key: article.id,
          titleEn: article.titleEn,
          message: error.message,
          attempts: error.attempts || MAX_ARTICLE_ATTEMPTS,
          reason: error.reason || RETRY_EXHAUSTED_REASON,
        });
      }
    }
  }
  await Promise.all([worker(), worker()]);

  const remainingFailures = initialFailures;

  stageReport.completedArticles = items.filter((article) => values[article.id]).length;
  const classifiedFailures = remainingFailures.map((failure) => ({
    ...failure,
    titleEn: articlesById.get(failure.key)?.titleEn || failure.titleEn || failure.key,
    message: sanitizePublicFailureMessage(failure.message),
    attempts: failure.attempts || MAX_ARTICLE_ATTEMPTS,
    reason: failure.reason || RETRY_EXHAUSTED_REASON,
  }));
  stageReport.systemicFailure = isSystemicFailureCount(classifiedFailures.length);
  stageReport.failures = stageReport.systemicFailure ? classifiedFailures : [];
  stageReport.skipped = stageReport.systemicFailure ? [] : classifiedFailures;
  stageReport.finishedAt = new Date().toISOString();
  saveCheckpoint(generationReportPath, generationReport);

  if (stageReport.systemicFailure) {
    const details = stageReport.failures.map(
      (failure) => `${failure.titleEn}：${failure.message}`,
    );
    generationReport.systemicFailure = {
      stage: label,
      failedArticles: details.length,
      threshold: MAX_SKIPPED_ARTICLES,
    };
    saveCheckpoint(generationReportPath, generationReport);
    throw new Error(`${label}有 ${details.length} 篇失敗，超過可隔離上限 ${MAX_SKIPPED_ARTICLES} 篇，判定為系統性故障：\n${details.join("\n")}`);
  }
  if (stageReport.skipped.length) {
    console.warn(`[${label}] ${stageReport.skipped.length} 篇連續 ${MAX_ARTICLE_ATTEMPTS} 次失敗，已隔離並繼續。`);
  }
  return stageReport.skipped;
}

const previousOutput = existsSync(outputPath)
  ? JSON.parse(readFileSync(outputPath, "utf8"))
  : null;
const previousCurrentArticles = new Map(
  (previousOutput?.articles || [])
    .filter((article) => (article.issueKey || previousOutput.issueKey) === source.issueKey)
    .map((article) => [article.id, article]),
);
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
  ...manualSummaries,
};
const skippedDrafts = await processWithWorkers({
  items: articlesToProcess,
  values: summaries,
  label: "初稿",
  processItem: summarize,
  checkpointPath: summaryCheckpointPath,
  processingVersion: SUMMARY_VERSION,
});

const humanizedSummaries = {
  ...humanizedCheckpoint,
};
const skippedDraftIds = new Set(skippedDrafts.map((failure) => failure.key));
const articlesWithDrafts = articlesToProcess.filter((article) => !skippedDraftIds.has(article.id));
const skippedHumanizations = await processWithWorkers({
  items: articlesWithDrafts,
  values: humanizedSummaries,
  label: "自然化",
  processItem: (article, retryContext) => humanize(article, summaries[article.id], retryContext),
  checkpointPath: humanizedCheckpointPath,
  processingVersion: HUMANIZER_VERSION,
});
for (const failure of skippedHumanizations) {
  const draft = summaries[failure.key];
  const article = articlesWithDrafts.find((item) => item.id === failure.key);
  if (!draft || !article) continue;
  humanizedSummaries[failure.key] = {
    ...draft,
    sourceHash: articleSourceHash(article),
    processingVersion: HUMANIZER_VERSION,
  };
  saveCheckpoint(humanizedCheckpointPath, humanizedSummaries);
}

const skippedDraftById = new Map(skippedDrafts.map((failure) => [failure.key, failure]));
const draftFallbackIds = new Set(skippedHumanizations.map((failure) => failure.key));

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
    textEn: article.textEn,
    sourceHash: articleSourceHash(article),
    featured: Boolean(summary),
    summaryStatus: skippedDraftById.has(article.id)
      ? "unavailable"
      : draftFallbackIds.has(article.id)
        ? "draft_fallback"
        : "complete",
    summaryUnavailable: skippedDraftById.has(article.id)
      ? {
          reason: skippedDraftById.get(article.id).reason || RETRY_EXHAUSTED_REASON,
          attempts: skippedDraftById.get(article.id).attempts || MAX_ARTICLE_ATTEMPTS,
          message: skippedDraftById.get(article.id).message,
        }
      : null,
    summaryZh: summary?.summaryZh || null,
    keyPointsZh: summary?.keyPointsZh || [],
    researchLensZh: summary?.researchLensZh || null,
    keywordsZh: summary?.keywordsZh || [],
    keywordPolicyVersion: "general-keywords-v1",
    highlightTermsZh: summary?.highlightTermsZh || [],
    highlightTermsVersion: "important-content-v1",
    humanizerVersion: HUMANIZER_VERSION,
  };
});

const previousArticles = (previousOutput?.articles || [])
  .filter((article) => (article.issueKey || previousOutput.issueKey) !== source.issueKey)
  .map((article) => ({
    ...article,
    issueKey: article.issueKey || previousOutput.issueKey,
    issueDate: article.issueDate || previousOutput.issueDate,
    categoryZh: sectionCategories[article.section] || article.categoryZh || "其他",
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
  summaryUnavailableCount: currentIssueArticles.filter((article) => article.summaryStatus === "unavailable").length,
  summaryDraftFallbackCount: currentIssueArticles.filter((article) => article.summaryStatus === "draft_fallback").length,
  featuredCount: currentIssueArticles.filter((article) => article.summaryZh).length,
  totalArticleCount: articles.length,
  issueCount: new Set(articles.map((article) => article.issueKey)).size,
  highlightPolicyVersion: "important-content-v1",
  keywordPolicyVersion: "general-keywords-v1",
  articles,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
generationReport.finishedAt = new Date().toISOString();
generationReport.summaryCount = output.summaryCount;
saveCheckpoint(generationReportPath, generationReport);
console.log(`完成本期 ${output.summaryCount} 篇繁中研究摘要與自然化校修。`);
