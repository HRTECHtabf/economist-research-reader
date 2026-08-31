import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  resolveRetryRounds,
  retryFailedArticles,
} from "./lib/retry-failed-articles.mjs";
import {
  CONTENT_FILTER_REASON,
  isContentFilterError,
} from "./lib/content-filter-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const dataPath = resolve(projectRoot, "docs/data/articles.json");
const outputRoot = resolve(projectRoot, "docs/data/fulltext");
const checkpointPath = resolve(projectRoot, ".cache/fulltext-zh-v2.checkpoint.json");
const reportPath = resolve(projectRoot, ".cache/fulltext-zh-v2.report.json");
const TRANSLATION_VERSION = "fulltext-zh-tw-v2";
const DEFAULT_WORKERS = 3;
const DEFAULT_CHUNK_CHARACTERS = 6200;
const DEFAULT_ARTICLE_RETRY_ROUNDS = 2;

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
    ) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

function readJson(path, fallback = {}) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
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
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));
}

function sourceHash(article) {
  return article.sourceHash || createHash("sha256").update(article.textEn).digest("hex");
}

function articleKey(article) {
  return `${article.issueKey}:${article.id}`;
}

function outputPath(article) {
  return resolve(outputRoot, article.issueKey, `${article.id}.json`);
}

function splitParagraphs(text) {
  return text.split(/\n+/).map((value) => value.trim()).filter(Boolean);
}

function chunkParagraphs(paragraphs, maximumCharacters) {
  const chunks = [];
  let current = [];
  let currentLength = 0;
  for (const [index, textEn] of paragraphs.entries()) {
    if (current.length && currentLength + textEn.length > maximumCharacters) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push({ index, textEn });
    currentLength += textEn.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const replacements = [
  [/特朗普/g, "川普"],
  [/英偉達/g, "輝達"],
  [/日元/g, "日圓"],
  [/信息/g, "資訊"],
  [/軟件/g, "軟體"],
  [/在線/g, "線上"],
  [/數據/g, "資料"],
  [/視頻/g, "影片"],
  [/質量/g, "品質"],
  [/渠道/g, "管道"],
  [/遏制/g, "遏止"],
  [/別弄錯了[：，。]?/g, "必須說清楚："],
];

function normalizeTranslation(text) {
  return replacements.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    String(text || "").trim(),
  );
}

const simplifiedOrMainlandPattern = /特朗普|英偉達|日元|信息|軟件|在線|視頻|質量|渠道/u;
const metaLanguagePattern = /^(?:以下是|翻譯如下|中文翻譯|這段文字|本文提到)/u;

function validateChunk(chunk, translations) {
  const failures = [];
  if (!Array.isArray(translations) || translations.length !== chunk.length) {
    return [`段落數 ${translations?.length ?? 0}，應為 ${chunk.length}`];
  }
  const byIndex = new Map(translations.map((item) => [item?.index, item]));
  for (const source of chunk) {
    const translated = byIndex.get(source.index);
    const textZh = translated?.textZh?.trim() || "";
    if (!translated) {
      failures.push(`缺少第 ${source.index + 1} 段`);
      continue;
    }
    const minimumLength = Math.min(40, Math.max(2, Math.round(source.textEn.length * 0.18)));
    const maximumLength = Math.max(80, Math.round(source.textEn.length * 2.1));
    if (textZh.length < minimumLength || textZh.length > maximumLength) {
      failures.push(`第 ${source.index + 1} 段長度 ${textZh.length}，合理範圍 ${minimumLength}–${maximumLength}`);
    }
    if (simplifiedOrMainlandPattern.test(textZh)) failures.push(`第 ${source.index + 1} 段含非台灣慣用詞`);
    if (metaLanguagePattern.test(textZh)) failures.push(`第 ${source.index + 1} 段出現翻譯說明`);
    if (/\d/u.test(source.textEn) && !/\d/u.test(textZh)) {
      const sourceNumbers = [...new Set(source.textEn.match(/\d[\d,.:%/–—-]*/gu) || [])]
        .slice(0, 8)
        .join("、");
      failures.push(`第 ${source.index + 1} 段遺失阿拉伯數字（原文含：${sourceNumbers}）`);
    }
    if (/\b(?:I cannot|I can't|as an AI)\b/i.test(textZh)) failures.push(`第 ${source.index + 1} 段不是譯文`);
  }
  if (byIndex.size !== translations.length) failures.push("段落索引重複");
  return failures;
}

function chunkSchema(chunk) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["translations"],
    properties: {
      translations: {
        type: "array",
        minItems: chunk.length,
        maxItems: chunk.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "textZh"],
          properties: {
            index: { type: "integer" },
            textZh: { type: "string" },
          },
        },
      },
    },
  };
}

const env = {
  ...readEnv(resolve(projectRoot, ".env.local")),
  ...process.env,
};
for (const name of ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]) {
  if (!env[name]) throw new Error(`尚未填寫 ${name}`);
}

const responseUrl = buildResponsesUrl(env.AZURE_OPENAI_ENDPOINT, env.AZURE_OPENAI_API_PATH);

async function callAzure(chunk, article, feedback = "", structured = true) {
  const schema = chunkSchema(chunk);
  const body = {
    model: env.AZURE_OPENAI_DEPLOYMENT,
    store: false,
    max_output_tokens: 12000,
    instructions: [
      "你是台灣雜誌出版業的資深中英翻譯與文字編輯。請把每一段英文完整翻成自然、成熟的繁體中文。",
      "這是全文翻譯，不是摘要。原文中的主張、限定條件、例子、數字、引述、因果關係與不確定程度都必須保留，不得刪減、合併或自行補充。",
      "逐段對應輸入 index，每個 index 只能回傳一段 textZh，順序與段落邊界不得改變。不要加標題、導讀、括號說明或『翻譯如下』。",
      "先理解整句再用台灣讀者自然的語序重寫，避免逐字直譯、歐化長句與生硬連接詞。可以拆句，但不可漏意；保留原文的新聞、評論、諷刺或敘事語氣，不要自行改成公文或 AI 摘要腔。",
      "慣用語與修辭要翻出實際意思，不要硬搬英文意象；例如 make no mistake 應依上下文寫成『必須說清楚』或『毫無疑問』，不要直譯成『別弄錯了』。",
      "機構、公司與人名只能使用台灣已有的通行譯名。若不確定中文名稱，保留英文並在上下文說明性質；不要自行把 Tata Sons 一類名稱逐字拼成不存在的中文公司名。",
      "Houthi 一律譯為『胡塞武裝』或依句意稱『胡塞叛軍』，不得譯為『青年運動』。政治組織、武裝團體與公司名稱不可依字面自行創造中文名稱。",
      "輸入中的 approvedTerminology 來自同篇已審閱的中文導讀，只用來統一人名、組織、地名、政策與專業詞彙；全文事實仍以英文 paragraphs 為唯一依據。",
      "使用台灣慣用譯名與詞彙，例如川普、輝達、日圓、資訊、軟體、線上。專有名詞若沒有穩定中譯，可保留英文；人名首次出現可用中文譯名並保留英文。",
      "所有數字、日期、百分比、幣別與計量關係要準確。數字使用阿拉伯數字；million、billion 可換成自然的萬／億寫法，但不得改變數值。",
      "不得出現簡體字、陸用詞、宣傳腔、空泛總結或模型自述。",
      feedback ? `上次未通過檢查，請完整重譯這一批並修正：${feedback}` : "",
      "只輸出符合 schema 的 JSON。",
    ].filter(Boolean).join("\n\n"),
    input: JSON.stringify({
      issue: article.issueKey,
      section: article.section,
      titleEn: article.titleEn,
      approvedTerminology: {
        summaryZh: article.summaryZh,
        keywordsZh: article.keywordsZh,
      },
      paragraphs: chunk,
    }),
  };
  if (structured) {
    body.text = {
      format: {
        type: "json_schema",
        name: "economist_fulltext_zh_tw_v1",
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
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error(`Azure 回應沒有完整文字（${payload?.status || "unknown"}）`);
  return parseJsonText(outputText);
}

async function callAzurePolish(chunk, draftTranslations, article, feedback = "", structured = true) {
  const schema = chunkSchema(chunk);
  const body = {
    model: env.AZURE_OPENAI_DEPLOYMENT,
    store: false,
    max_output_tokens: 12000,
    instructions: [
      "你是台灣雜誌出版業的資深繁體中文主編，負責全文翻譯的第二階段定稿。請逐段對照英文原文，修訂 draftTranslations。",
      "先守住準確：原文中的主張、限定條件、例子、數字、引述、因果與不確定程度不得遺失、弱化、加強或自行補充。每個 index 必須與英文原段落一一對應。",
      "再處理中文：刪除逐字直譯、歐化句構、重複動詞與贅語，補足台灣讀者理解所需的自然主詞與銜接。長句可拆開，但不能摘要、合併段落或改變語氣。",
      "逐句朗讀檢查，避免『推升……飆漲』『迫使……必須』『進行……的進行』這類語意重複，也不要用公式化結尾、宣傳形容、三段排比或 AI 式總結。",
      "人名、機構、政治組織與公司名稱沿用 approvedTerminology 的通行譯名；不確定時保留英文，不可依字面創造中文名稱。Houthi 一律譯為胡塞武裝或胡塞叛軍。",
      "英文慣用語要改寫成自然中文；make no mistake 應寫『必須說清楚』或『毫無疑問』，不可直譯成『別弄錯了』。",
      "使用台灣慣用繁體中文與阿拉伯數字。這是編修定稿，不要加入翻譯說明、標題、註解或模型自述。",
      feedback ? `上次定稿未通過檢查，請修正：${feedback}` : "",
      "只輸出符合 schema 的 JSON。",
    ].filter(Boolean).join("\n\n"),
    input: JSON.stringify({
      issue: article.issueKey,
      section: article.section,
      titleEn: article.titleEn,
      approvedTerminology: {
        summaryZh: article.summaryZh,
        keywordsZh: article.keywordsZh,
      },
      sourceParagraphs: chunk,
      draftTranslations,
    }),
  };
  if (structured) {
    body.text = {
      format: {
        type: "json_schema",
        name: "economist_fulltext_zh_tw_final_v2",
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
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error(`Azure 定稿回應沒有完整文字（${payload?.status || "unknown"}）`);
  return parseJsonText(outputText);
}

async function polishChunk(chunk, draftTranslations, article) {
  let feedback = "";
  let lastFailure = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      let value;
      try {
        value = await callAzurePolish(chunk, draftTranslations, article, feedback, true);
      } catch (error) {
        if (error.status !== 400 && !(error instanceof SyntaxError)) throw error;
        value = await callAzurePolish(chunk, draftTranslations, article, feedback, false);
      }
      value.translations = (value.translations || []).map((item) => ({
        index: item.index,
        textZh: normalizeTranslation(item.textZh),
      }));
      const failures = validateChunk(chunk, value.translations);
      if (!failures.length) return { translations: value.translations, attempts: attempt };
      lastFailure = failures.join("；");
      feedback = lastFailure;
    } catch (error) {
      if (isContentFilterError(error)) throw error;
      lastFailure = error.message;
      feedback = `API 或格式錯誤：${error.message}`;
      if (error.status === 429 || error.status >= 500) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 3500));
      }
    }
  }
  throw new Error(lastFailure || "四次定稿均未通過檢查");
}

async function translateChunk(chunk, article) {
  let feedback = "";
  let lastFailure = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      let value;
      try {
        value = await callAzure(chunk, article, feedback, true);
      } catch (error) {
        if (error.status !== 400 && !(error instanceof SyntaxError)) throw error;
        value = await callAzure(chunk, article, feedback, false);
      }
      value.translations = (value.translations || []).map((item) => ({
        index: item.index,
        textZh: normalizeTranslation(item.textZh),
      }));
      const failures = validateChunk(chunk, value.translations);
      if (!failures.length) {
        const polished = await polishChunk(chunk, value.translations, article);
        return { translations: polished.translations, attempts: attempt + polished.attempts };
      }
      lastFailure = failures.join("；");
      feedback = lastFailure;
    } catch (error) {
      if (isContentFilterError(error)) throw error;
      lastFailure = error.message;
      feedback = `API 或格式錯誤：${error.message}`;
      if (error.status === 429 || error.status >= 500) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 3500));
      }
    }
  }
  throw new Error(lastFailure || "五次輸出均未通過檢查");
}

const data = readJson(dataPath);
if (!Array.isArray(data.articles) || !data.articles.length) throw new Error("文章資料庫是空的");
const checkpoint = readJson(checkpointPath, { version: TRANSLATION_VERSION, chunks: {} });
if (checkpoint.version !== TRANSLATION_VERSION) {
  checkpoint.version = TRANSLATION_VERSION;
  checkpoint.chunks = {};
}

const maximumCharacters = Math.max(2500, Number(option("chunk-chars", env.TRANSLATION_CHUNK_CHARACTERS)) || DEFAULT_CHUNK_CHARACTERS);
const force = process.argv.includes("--force");
const auditOnly = process.argv.includes("--audit-only");
const selectedArticle = option("article");
const limit = Math.max(0, Number(option("limit")) || 0);
const workerCount = Math.max(1, Number(option("workers", env.TRANSLATION_WORKERS)) || DEFAULT_WORKERS);
const articleRetryRoundsValue = option("article-retries", env.FULLTEXT_ARTICLE_RETRIES || "");
const articleRetryRounds = resolveRetryRounds(articleRetryRoundsValue, DEFAULT_ARTICLE_RETRY_ROUNDS);

function existingOutputValid(article) {
  const value = readJson(outputPath(article), null);
  if (
    value?.unavailable === true &&
    value?.unavailableReason === CONTENT_FILTER_REASON &&
    value?.translationVersion === TRANSLATION_VERSION &&
    value?.sourceHash === sourceHash(article)
  ) return true;
  return (
    value?.translationVersion === TRANSLATION_VERSION &&
    value?.sourceHash === sourceHash(article) &&
    Array.isArray(value?.paragraphsZh) &&
    value.paragraphsZh.length === splitParagraphs(article.textEn).length &&
    !value.paragraphsZh.some((text) => !String(text).trim())
  );
}

let candidates = data.articles.filter((article) => {
  if (!article.textEn || article.textEn.length < 100) return false;
  if (selectedArticle && article.id !== selectedArticle && articleKey(article) !== selectedArticle) return false;
  return force || !existingOutputValid(article);
});
if (limit) candidates = candidates.slice(0, limit);

const report = {
  translationVersion: TRANSLATION_VERSION,
  startedAt: new Date().toISOString(),
  totalDatabaseArticles: data.articles.length,
  selectedArticles: candidates.length,
  completed: [],
  quarantined: [],
  failed: [],
};

function quarantineFilteredArticle(article, error) {
  const value = {
    id: article.id,
    issueKey: article.issueKey,
    sourceHash: sourceHash(article),
    translationVersion: TRANSLATION_VERSION,
    unavailable: true,
    unavailableReason: CONTENT_FILTER_REASON,
    unavailableMessageZh: "Azure 內容安全篩選未允許產生這篇繁中全文，請先閱讀英文原文。",
    recordedAt: new Date().toISOString(),
  };
  writeJsonAtomic(outputPath(article), value);
  return { key: articleKey(article), reason: CONTENT_FILTER_REASON, message: error.message };
}

async function translateArticle(article) {
  const paragraphs = splitParagraphs(article.textEn);
  const chunks = chunkParagraphs(paragraphs, maximumCharacters);
  const translatedByIndex = new Map();
  let apiAttempts = 0;
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const cacheKey = `${articleKey(article)}:${sourceHash(article)}:${chunkIndex}:${createHash("sha256").update(JSON.stringify(chunk)).digest("hex")}`;
    let cached = checkpoint.chunks[cacheKey];
    if (force || validateChunk(chunk, cached?.translations).length) cached = null;
    if (!cached) {
      const translated = await translateChunk(chunk, article);
      cached = {
        translations: translated.translations,
        attempts: translated.attempts,
        completedAt: new Date().toISOString(),
      };
      checkpoint.chunks[cacheKey] = cached;
      writeJsonAtomic(checkpointPath, checkpoint);
    }
    apiAttempts += cached.attempts || 0;
    for (const item of cached.translations) translatedByIndex.set(item.index, item.textZh);
  }
  const paragraphsZh = paragraphs.map((_, index) => translatedByIndex.get(index));
  if (paragraphsZh.some((text) => !text)) throw new Error("合併後缺少中文段落");
  const value = {
    id: article.id,
    issueKey: article.issueKey,
    sourceHash: sourceHash(article),
    translationVersion: TRANSLATION_VERSION,
    translatedAt: new Date().toISOString(),
    paragraphCount: paragraphsZh.length,
    paragraphsZh,
  };
  writeJsonAtomic(outputPath(article), value);
  return { key: articleKey(article), paragraphs: paragraphsZh.length, chunks: chunks.length, apiAttempts };
}

if (auditOnly) {
  const invalid = data.articles.filter((article) => !existingOutputValid(article));
  console.log(`全文翻譯檢查：${data.articles.length - invalid.length}/${data.articles.length} 篇有效。`);
  if (invalid.length) {
    console.error(`尚缺或失效：${invalid.length} 篇`);
    process.exitCode = 1;
  }
} else if (!candidates.length) {
  console.log("所有文章的中文全文皆已完成，無需重跑 Azure OpenAI。");
} else {
  console.log(`準備翻譯 ${candidates.length} 篇；${workerCount} 個工作序列；每批約 ${maximumCharacters} 個英文字元。`);
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      const article = candidates[index];
      try {
        const result = await translateArticle(article);
        report.completed.push(result);
        console.log(`[${report.completed.length + report.failed.length}/${candidates.length}] 完成 ${result.key}（${result.paragraphs} 段）`);
      } catch (error) {
        if (isContentFilterError(error)) {
          const quarantined = quarantineFilteredArticle(article, error);
          report.quarantined.push(quarantined);
          console.warn(`[內容安全隔離] ${quarantined.key}：保留摘要與英文原文，繁中全文標記為不可用。`);
        } else {
          report.failed.push({ key: articleKey(article), message: error.message });
          console.error(`[${report.completed.length + report.quarantined.length + report.failed.length}/${candidates.length}] 失敗 ${articleKey(article)}：${error.message}`);
        }
      }
      writeJsonAtomic(reportPath, { ...report, updatedAt: new Date().toISOString() });
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerCount, candidates.length) }, worker));
  if (report.failed.length && articleRetryRounds > 0) {
    const articleByKey = new Map(candidates.map((article) => [articleKey(article), article]));
    report.retryRounds = [];
    report.failed = await retryFailedArticles({
      initialFailures: report.failed,
      maxRounds: articleRetryRounds,
      findArticle: (key) => articleByKey.get(key),
      retryArticle: translateArticle,
      onRoundStart: ({ round, maxRounds, pending }) => {
        console.warn(`[自動補跑 ${round}/${maxRounds}] 重新處理 ${pending.length} 篇失敗文章。`);
      },
      onSuccess: ({ round, result }) => {
        report.completed.push(result);
        console.log(`[自動補跑 ${round}] 完成 ${result.key}（${result.paragraphs} 段）`);
      },
      onFailure: ({ round, failure }) => {
        console.error(`[自動補跑 ${round}] 仍失敗 ${failure.key}：${failure.message}`);
      },
      onRoundComplete: ({ round, pending }) => {
        report.retryRounds.push({
          round,
          remainingFailures: pending.map(({ key, message }) => ({ key, message })),
        });
        report.failed = pending;
        writeJsonAtomic(reportPath, { ...report, updatedAt: new Date().toISOString() });
      },
    });
  }
  report.finishedAt = new Date().toISOString();
  writeJsonAtomic(reportPath, report);
  if (report.failed.length) {
    throw new Error(`${report.failed.length} 篇翻譯失敗；已完成內容與斷點均已保留。`);
  }
  console.log(`中文全文翻譯完成：${report.completed.length} 篇；內容安全隔離 ${report.quarantined.length} 篇。`);
}
