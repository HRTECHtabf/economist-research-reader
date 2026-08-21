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
  GENERAL_KEYWORD_POLICY,
  GENERAL_KEYWORD_TAXONOMY,
} from "./general-keyword-taxonomy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const dataPath = resolve(projectRoot, process.argv[2] || "docs/data/articles.json");
const checkpointPath = resolve(projectRoot, ".cache/rehumanize-all-v4.checkpoint.json");
const reportPath = resolve(projectRoot, ".cache/rehumanize-all-v4.report.json");
const guidePath = resolve(
  projectRoot,
  ".agents/skills/economist-humanizer-zh-tw/references/economist-research-summary.md",
);
const HUMANIZER_VERSION = "economist-humanizer-v4";
const DEFAULT_WORKERS = 2;

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
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
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

const env = {
  ...readEnv(resolve(projectRoot, ".env.local")),
  ...process.env,
};
for (const name of ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]) {
  if (!env[name]) throw new Error(`尚未填寫 ${name}`);
}

const data = readJson(dataPath);
if (!Array.isArray(data.articles) || !data.articles.length) throw new Error("文章資料庫是空的");
const guide = readFileSync(guidePath, "utf8");
const responseUrl = buildResponsesUrl(env.AZURE_OPENAI_ENDPOINT, env.AZURE_OPENAI_API_PATH);
const workerCount = Math.max(1, Number(env.REHUMANIZE_WORKERS) || DEFAULT_WORKERS);

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summaryZh", "keyPointsZh", "researchLensZh", "keywordsZh", "highlightTermsZh"],
  properties: {
    summaryZh: { type: "string", maxLength: 280 },
    keyPointsZh: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", maxLength: 86 },
    },
    researchLensZh: { type: "string", maxLength: 150 },
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

const aiStylePattern = /綜上所述|總體而言|一言以蔽之|未來可期|值得深入閱讀|可供參考|值得注意的是|由此可見|賦能|助力|底層邏輯|深遠影響|重要里程碑|不只是.{0,35}而是|不僅.{0,35}更/u;
const contextlessPointOpening = /^(?:文章|本文|文中)(?:同時|另|也|還|進一步)|^(?:原因與風險|其他變化|也有|另一個|此外|另一方面|至於|這些|此舉|上述)/u;
const mainlandTerms = /特朗普|英偉達|日元|信息|軟件|在線/u;
const translatedNumberPattern = /\d+(?:\.\d+)?(?:百萬|十億)(?!分之)/u;

function endsAsCompleteSentence(value) {
  return typeof value === "string" && /[。！？…》〉」』”’]$/u.test(value.trim());
}

function isStandaloneKeyPoint(point) {
  return (
    typeof point === "string" &&
    !contextlessPointOpening.test(point) &&
    !/^[^，。！？；]{2,18}：/u.test(point) &&
    (point.match(/；/g) || []).length <= 1 &&
    !aiStylePattern.test(point)
  );
}

function validationFailures(value) {
  const failures = [];
  if (!value || typeof value !== "object") return ["輸出不是物件"];

  if (!endsAsCompleteSentence(value.summaryZh)) failures.push("摘要句尾不完整");
  if (typeof value.summaryZh !== "string" || value.summaryZh.length < 130 || value.summaryZh.length > 250) {
    failures.push(`摘要長度 ${value.summaryZh?.length ?? 0}，應為 130–250`);
  }
  if (/^(?:本文指出|文章聚焦|作者認為)/u.test(value.summaryZh || "")) failures.push("摘要以公式化來源提示開場");
  if (aiStylePattern.test(value.summaryZh || "")) failures.push("摘要含公式化 AI 語句");

  if (!Array.isArray(value.keyPointsZh) || value.keyPointsZh.length < 3 || value.keyPointsZh.length > 5) {
    failures.push(`重點數量 ${value.keyPointsZh?.length ?? 0}，應為 3–5`);
  } else {
    value.keyPointsZh.forEach((point, index) => {
      if (!endsAsCompleteSentence(point)) failures.push(`重點 ${index + 1} 句尾不完整`);
      if (typeof point !== "string" || point.length < 25 || point.length > 86) {
        failures.push(`重點 ${index + 1} 長度 ${point?.length ?? 0}，應為 25–86`);
      }
      if (!isStandaloneKeyPoint(point)) failures.push(`重點 ${index + 1} 不是可獨立閱讀的單一主張`);
    });
    if (new Set(value.keyPointsZh).size !== value.keyPointsZh.length) failures.push("重點內容重複");
  }

  if (!endsAsCompleteSentence(value.researchLensZh)) failures.push("研究角度句尾不完整");
  if (
    typeof value.researchLensZh !== "string" ||
    value.researchLensZh.length < 50 ||
    value.researchLensZh.length > 135
  ) failures.push(`研究角度長度 ${value.researchLensZh?.length ?? 0}，應為 50–135`);
  if (aiStylePattern.test(value.researchLensZh || "")) failures.push("研究角度含公式化 AI 語句");

  if (!Array.isArray(value.keywordsZh) || value.keywordsZh.length < 3 || value.keywordsZh.length > 5) {
    failures.push(`關鍵字數量 ${value.keywordsZh?.length ?? 0}，應為 3–5`);
  } else if (value.keywordsZh.some((keyword) => !GENERAL_KEYWORD_TAXONOMY.includes(keyword))) {
    failures.push("關鍵字不在廣義標籤詞彙表");
  }
  if (!Array.isArray(value.highlightTermsZh) || value.highlightTermsZh.length > 3) {
    failures.push(`標示數量 ${value.highlightTermsZh?.length ?? 0}，應為 0–3`);
  } else if (value.highlightTermsZh.some((term) => !value.summaryZh?.includes(term))) {
    failures.push("摘要中找不到標示短語");
  }

  const allText = [
    value.summaryZh,
    ...(Array.isArray(value.keyPointsZh) ? value.keyPointsZh : []),
    value.researchLensZh,
    ...(Array.isArray(value.keywordsZh) ? value.keywordsZh : []),
  ].filter(Boolean).join("\n");
  if (mainlandTerms.test(allText)) failures.push("含非台灣慣用詞");
  if (translatedNumberPattern.test(allText)) failures.push("含 1.5百萬一類的翻譯腔數字寫法");
  return failures;
}

function normalizeBrief(value) {
  const replacements = [
    [/特朗普/g, "川普"],
    [/英偉達/g, "輝達"],
    [/日元/g, "日圓"],
    [/信息/g, "資訊"],
    [/軟件/g, "軟體"],
    [/在線/g, "線上"],
  ];
  const normalizeTranslatedNumbers = (text) => text
    .replace(/(\d+(?:\.\d+)?)百萬/gu, (_, number) => `${Number(number) * 100}萬`)
    .replace(/(\d+(?:\.\d+)?)十億/gu, (_, number) => `${Number(number) * 10}億`);
  const normalize = (text) => normalizeTranslatedNumbers(replacements.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    String(text || "").trim(),
  ));
  const summaryZh = normalize(value.summaryZh);
  return {
    summaryZh,
    keyPointsZh: (value.keyPointsZh || []).map(normalize),
    researchLensZh: normalize(value.researchLensZh),
    keywordsZh: (value.keywordsZh || []).map(normalize),
    highlightTermsZh: [...new Set((value.highlightTermsZh || []).map(normalize))]
      .filter((term) => summaryZh.includes(term))
      .slice(0, 3),
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
  const cleaned = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  return JSON.parse(cleaned);
}

async function callAzureJson({ instructions, input }, structured = true) {
  const body = {
    model: env.AZURE_OPENAI_DEPLOYMENT,
    store: false,
    max_output_tokens: 2800,
    instructions,
    input,
  };
  if (structured) {
    body.text = {
      format: {
        type: "json_schema",
        name: "humanized_research_brief_v3",
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

async function callWithFallback(request) {
  try {
    return await callAzureJson(request, true);
  } catch (error) {
    if (error.status !== 400 && !(error instanceof SyntaxError)) throw error;
    return callAzureJson(request, false);
  }
}

function articleSourceHash(article) {
  return createHash("sha256")
    .update([article.issueKey, article.section, article.titleEn, article.rubricEn, article.sourceUrl, article.textEn].join("\n"))
    .digest("hex");
}

function articleKey(article) {
  return `${article.issueKey}:${article.id}`;
}

function buildInstructions(article, feedback = "") {
  return [
    "你是台灣金融與經濟研究機構的資深中文編輯。請依英文原文重寫整份研究導讀，完成事實核對與去 AI 化。",
    "英文原文是唯一事實依據。不得新增原文沒有的人物、數字、日期、因果關係或確定語氣；作者立場要清楚標示，不可改寫成既定事實。",
    "summaryZh 用 150–230 個中文字交代問題、核心判斷與關鍵證據。直接從具體主詞、事件或數據開場，不要逐段翻譯，也不要做空泛總結。",
    "keyPointsZh 依內容使用 3–5 點，每點嚴格控制在 35–65 個中文字，且一定要用句號等完整句尾收束。每點只能處理一個主張或事件，必須能脫離其他點獨立理解，開頭先寫清楚主詞、政策、市場或事件。不要使用短標題加冒號，不要用分號拼接不相干事件。",
    article.section === "The world this week"
      ? "這是新聞彙整欄目，優先使用 4–5 點；挑選最重要且彼此不同的事件，不要為了涵蓋全部新聞而把多件事塞進同一點。"
      : "重點數量依實際論點決定，不要為了固定格式硬湊三點或五點。",
    "researchLensZh 用 60–120 個中文字，直接指出可檢查的資料、假設、傳導機制或政策取捨。不要寫『值得深入閱讀』『可供參考』，也不要固定以『回到原文可檢查』開場。",
    GENERAL_KEYWORD_POLICY,
    "highlightTermsZh 只保留 0–3 個在 summaryZh 中逐字出現的關鍵結論、因果機制或重要證據；沒有適合短語就回傳空陣列。",
    "採台灣研究員寫給同事的自然語氣。避免宣傳形容、職場黑話、三段排比、否定對仗、戲劇化金句、教科書過場與昇華式結尾。避免『文章同時指出』『原因與風險』『其他變化』等依賴前文的起句。",
    "使用台灣常用譯名、用語與數字寫法，例如川普、輝達、日圓、資訊、軟體、線上；把 1.5 million 寫成 150萬，不要寫成 1.5百萬。",
    feedback ? `上次輸出未通過檢查，這次必須修正：${feedback}` : "",
    guide,
    "只輸出符合 schema 的 JSON，不要使用 Markdown。",
  ].filter(Boolean).join("\n\n");
}

async function rewriteArticle(article) {
  let feedback = "";
  let lastFailure = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const result = normalizeBrief(await callWithFallback({
        instructions: buildInstructions(article, feedback),
        input: [
          `期數：${article.issueKey}`,
          `欄目：${article.section}`,
          `英文標題：${article.titleEn}`,
          article.rubricEn ? `英文副標：${article.rubricEn}` : "",
          `英文原文：\n${article.textEn}`,
          `現有中文導讀（只供辨識應保留的內容，仍須依英文原文重寫）：\n${JSON.stringify({
            summaryZh: article.summaryZh,
            keyPointsZh: article.keyPointsZh,
            researchLensZh: article.researchLensZh,
            keywordsZh: article.keywordsZh,
            highlightTermsZh: article.highlightTermsZh,
          })}`,
        ].filter(Boolean).join("\n\n"),
      }));
      const failures = validationFailures(result);
      if (!failures.length) return { result, attempt };
      lastFailure = failures.join("；");
      feedback = `${lastFailure}。不要局部續寫或只刪句尾；請整組重點重新組織，每點縮到 35–65 字，並在句末加標點。`;
    } catch (error) {
      lastFailure = error.message;
      feedback = `API 或格式錯誤：${error.message}`;
      if (error.status === 429 || error.status >= 500) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 3000));
      }
    }
  }
  throw new Error(lastFailure || "五次輸出均未通過檢查");
}

const checkpoint = readJson(checkpointPath, {});
for (const article of data.articles) {
  const key = articleKey(article);
  const cached = checkpoint[key];
  if (
    cached?.humanizerVersion !== HUMANIZER_VERSION ||
    cached?.sourceHash !== articleSourceHash(article) ||
    validationFailures(cached).length
  ) delete checkpoint[key];
}
writeJsonAtomic(checkpointPath, checkpoint);

let nextIndex = 0;
let completed = Object.keys(checkpoint).length;
const failures = [];
const attemptsUsed = { 1: 0, 2: 0, 3: 0 };

console.log(`使用部署：${env.AZURE_OPENAI_DEPLOYMENT}`);
console.log(`準備重跑 ${data.articles.length} 篇；沿用合格暫存 ${completed} 篇；並行數 ${workerCount}。`);

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= data.articles.length) return;
    const article = data.articles[index];
    const key = articleKey(article);
    if (checkpoint[key]) {
      console.log(`[${index + 1}/${data.articles.length}] 已有合格暫存：${article.titleEn}`);
      continue;
    }
    try {
      const { result, attempt } = await rewriteArticle(article);
      checkpoint[key] = {
        ...result,
        sourceHash: articleSourceHash(article),
        humanizerVersion: HUMANIZER_VERSION,
      };
      attemptsUsed[attempt] += 1;
      completed += 1;
      writeJsonAtomic(checkpointPath, checkpoint);
      console.log(
        `[${index + 1}/${data.articles.length}] 完成（第 ${attempt} 次、${result.keyPointsZh.length} 點，總進度 ${completed}/${data.articles.length}）：${article.titleEn}`,
      );
    } catch (error) {
      failures.push(`${article.issueKey}｜${article.titleEn}：${error.message}`);
      console.error(`[${index + 1}/${data.articles.length}] 失敗：${article.titleEn}｜${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: workerCount }, () => worker()));
if (failures.length) {
  throw new Error(`有 ${failures.length} 篇未完成，資料庫未改寫：\n${failures.join("\n")}`);
}

const updatedArticles = data.articles.map((article) => {
  const result = checkpoint[articleKey(article)];
  return {
    ...article,
    summaryZh: result.summaryZh,
    keyPointsZh: result.keyPointsZh,
    researchLensZh: result.researchLensZh,
    keywordsZh: result.keywordsZh,
    highlightTermsZh: result.highlightTermsZh,
    humanizerVersion: HUMANIZER_VERSION,
  };
});

for (const article of updatedArticles) {
  const failuresForArticle = validationFailures(article);
  if (failuresForArticle.length) {
    throw new Error(`寫入前檢查失敗：${article.titleEn}｜${failuresForArticle.join("；")}`);
  }
}

const pointLengths = updatedArticles.flatMap((article) => article.keyPointsZh.map((point) => point.length));
const report = {
  humanizerVersion: HUMANIZER_VERSION,
  deployment: env.AZURE_OPENAI_DEPLOYMENT,
  completedAt: new Date().toISOString(),
  articleCount: updatedArticles.length,
  issueCount: new Set(updatedArticles.map((article) => article.issueKey)).size,
  pointCount: pointLengths.length,
  keyPointCountDistribution: updatedArticles.reduce((counts, article) => {
    counts[article.keyPointsZh.length] = (counts[article.keyPointsZh.length] || 0) + 1;
    return counts;
  }, {}),
  keyPointLength: {
    min: Math.min(...pointLengths),
    max: Math.max(...pointLengths),
    average: Number((pointLengths.reduce((sum, length) => sum + length, 0) / pointLengths.length).toFixed(1)),
  },
  attemptsUsed,
};

writeJsonAtomic(dataPath, {
  ...data,
  generatedAt: report.completedAt,
  humanizerVersion: HUMANIZER_VERSION,
  articles: updatedArticles,
});
writeJsonAtomic(reportPath, report);
console.log(`全部完成：${updatedArticles.length} 篇，資料庫已更新。`);
console.log(JSON.stringify(report, null, 2));
