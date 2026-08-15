import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const siteDataPath = resolve(projectRoot, "docs/data/articles.json");
const rawArticlesPath = resolve(projectRoot, ".cache/articles.raw.json");
const checkpointPath = resolve(projectRoot, ".cache/highlight-terms.checkpoint.json");

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

function outputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function isValidReview(review, summary) {
  return (
    review &&
    Array.isArray(review.highlightTerms) &&
    review.highlightTerms.length <= 3 &&
    new Set(review.highlightTerms.map(({ term }) => term)).size === review.highlightTerms.length &&
    review.highlightTerms.every(({ term, kind, reason }) =>
      typeof term === "string" &&
      term.length >= 3 &&
      term.length <= 30 &&
      summary.includes(term) &&
      ["conclusion", "mechanism", "evidence"].includes(kind) &&
      typeof reason === "string" &&
      reason.length >= 8,
    )
  );
}

const env = {
  ...readEnv(resolve(projectRoot, ".env.local")),
  ...process.env,
};
for (const name of ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"]) {
  if (!env[name]) throw new Error(`尚未填寫 ${name}`);
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
const siteData = JSON.parse(readFileSync(siteDataPath, "utf8"));
const rawData = JSON.parse(readFileSync(rawArticlesPath, "utf8"));
const rawById = new Map(rawData.articles.map((article) => [article.id, article]));
const checkpoint = existsSync(checkpointPath)
  ? JSON.parse(readFileSync(checkpointPath, "utf8"))
  : {};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["highlightTerms"],
  properties: {
    highlightTerms: {
      type: "array",
      minItems: 0,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "kind", "reason"],
        properties: {
          term: { type: "string", minLength: 3, maxLength: 30 },
          kind: { type: "string", enum: ["conclusion", "mechanism", "evidence"] },
          reason: { type: "string", minLength: 8, maxLength: 100 },
        },
      },
    },
  },
};

async function reviewArticle(article) {
  const raw = rawById.get(article.id);
  if (!raw) throw new Error("找不到英文原文");
  const body = {
    model: env.AZURE_OPENAI_DEPLOYMENT,
    store: false,
    max_output_tokens: 600,
    instructions: [
      "你是台灣金融研究機構的摘要品質編輯。只審核中文摘要中哪些短語值得加粗，不得改寫摘要。",
      "通常選 1–3 個；若沒有合適短語，可回傳空陣列，不要硬湊。",
      "term 必須在 summaryZh 中逐字、連續出現，且單獨加粗後能幫助研究員掌握關鍵判斷。",
      "只接受三類：conclusion（核心結論）、mechanism（因果或傳導機制）、evidence（重要數據或可核對證據）。",
      "不得只標國名、地名、人名、機構名、產品名、文章主題、一般術語或普通名詞；除非短語本身包含關鍵變化、比較、數字或因果關係。",
      "避免只標摘要開頭的主詞，也不要因為某詞重複出現就選它。",
      "逐一對照英文原文、三點論述與研究角度，確認每個 term 真的是文章判斷的核心。",
      "輸出 JSON，不要使用 Markdown。",
    ].join("\n"),
    input: [
      `英文標題：${article.titleEn}`,
      `中文摘要：${article.summaryZh}`,
      `三點論述：\n${article.keyPointsZh.map((point, index) => `${index + 1}. ${point}`).join("\n")}`,
      `研究角度：${article.researchLensZh}`,
      `英文原文核對：\n${raw.textEn.slice(0, 7000)}`,
    ].join("\n\n"),
    text: {
      format: {
        type: "json_schema",
        name: "highlight_review",
        strict: true,
        schema,
      },
    },
  };
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
  const review = JSON.parse(outputText(payload));
  if (!isValidReview(review, article.summaryZh)) throw new Error("標示審核未通過格式或內容檢查");
  return review;
}

function saveCheckpoint() {
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

let nextIndex = 0;
const failures = [];
let fatalError = null;
async function worker() {
  while (true) {
    if (fatalError) return;
    const index = nextIndex++;
    if (index >= siteData.articles.length) return;
    const article = siteData.articles[index];
    if (checkpoint[article.id] && isValidReview(checkpoint[article.id], article.summaryZh)) {
      console.log(`[標示 ${index + 1}/${siteData.articles.length}] 已審核：${article.titleEn}`);
      continue;
    }
    console.log(`[標示 ${index + 1}/${siteData.articles.length}] 審核中：${article.titleEn}`);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        checkpoint[article.id] = await reviewArticle(article);
        saveCheckpoint();
        break;
      } catch (error) {
        if ([401, 403, 404].includes(error.status)) {
          fatalError = error;
          return;
        }
        if (attempt === 3) failures.push(`${article.titleEn}：${error.message}`);
        else console.log(`[標示] 第 ${attempt + 1} 次嘗試：${article.titleEn}`);
      }
    }
  }
}

await Promise.all([worker(), worker()]);
if (fatalError) throw new Error(`標示審核無法連線：${fatalError.message}`);
if (failures.length) throw new Error(`有 ${failures.length} 篇標示審核失敗：\n${failures.join("\n")}`);

for (const article of siteData.articles) {
  const review = checkpoint[article.id];
  article.highlightTermsZh = review.highlightTerms.map(({ term }) => term);
  article.highlightTermsVersion = "important-content-v1";
  const raw = rawById.get(article.id);
  if (raw) article.sourceHash = articleSourceHash(raw);
}
siteData.highlightPolicyVersion = "important-content-v1";
siteData.highlightReview = {
  reviewedAt: new Date().toISOString(),
  articleCount: siteData.articles.length,
};
writeFileSync(siteDataPath, `${JSON.stringify(siteData, null, 2)}\n`, "utf8");
console.log(`已逐篇審核 ${siteData.articles.length} 篇文章的摘要標示。`);
