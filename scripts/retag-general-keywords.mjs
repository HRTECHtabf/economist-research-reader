import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  GENERAL_KEYWORD_POLICY,
  GENERAL_KEYWORD_TAXONOMY,
} from "./general-keyword-taxonomy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const dataPath = resolve(projectRoot, process.argv[2] || "docs/data/articles.json");
const checkpointPath = resolve(projectRoot, ".cache/general-keywords-v1.checkpoint.json");
const DEFAULT_WORKERS = 6;

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

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
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
const checkpoint = readJson(checkpointPath);
const responseUrl = buildResponsesUrl(env.AZURE_OPENAI_ENDPOINT, env.AZURE_OPENAI_API_PATH);
const workerCount = Math.max(1, Number(env.RETAG_WORKERS) || DEFAULT_WORKERS);
const allowedTags = new Set(GENERAL_KEYWORD_TAXONOMY);
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["keywordsZh"],
  properties: {
    keywordsZh: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", enum: GENERAL_KEYWORD_TAXONOMY },
    },
  },
};

function articleKey(article) {
  return `${article.issueKey}:${article.id}`;
}

function isValidKeywords(value) {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 5 &&
    new Set(value).size === value.length &&
    value.every((tag) => allowedTags.has(tag))
  );
}

async function classifyArticle(article) {
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.AZURE_OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      store: false,
      max_output_tokens: 320,
      instructions: [
        "你是研究資料庫的標籤編輯，只負責選擇廣義標籤。",
        GENERAL_KEYWORD_POLICY,
        "先判斷文章主要地區與核心主題，再選 3–5 個最能讓使用者找到同類文章的標籤。輸出 JSON，不要解釋。",
      ].join("\n\n"),
      input: [
        `欄目：${article.section}`,
        `分類：${article.categoryZh}`,
        `英文標題：${article.titleEn}`,
        article.rubricEn ? `英文副標：${article.rubricEn}` : "",
        article.summaryZh ? `中文摘要：${article.summaryZh}` : "",
        article.keyPointsZh?.length ? `論述重點：${article.keyPointsZh.join("\n")}` : "",
        article.researchLensZh ? `研究角度：${article.researchLensZh}` : "",
        `原有關鍵字（只供理解內容，不得沿用專有標籤）：${(article.keywordsZh || []).join("、")}`,
      ].filter(Boolean).join("\n\n"),
      text: {
        format: {
          type: "json_schema",
          name: "general_article_keywords",
          strict: true,
          schema,
        },
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("Azure 回應沒有標籤資料");
  const result = JSON.parse(outputText.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));
  if (!isValidKeywords(result.keywordsZh)) throw new Error("標籤未通過詞彙表與數量檢查");
  return result.keywordsZh;
}

let nextIndex = 0;
const failures = [];
async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= data.articles.length) return;
    const article = data.articles[index];
    const key = articleKey(article);
    if (isValidKeywords(checkpoint[key])) {
      console.log(`[標籤 ${index + 1}/${data.articles.length}] 已有暫存：${article.titleEn}`);
      continue;
    }
    console.log(`[標籤 ${index + 1}/${data.articles.length}] 正在處理：${article.titleEn}`);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        checkpoint[key] = await classifyArticle(article);
        writeJsonAtomic(checkpointPath, checkpoint);
        break;
      } catch (error) {
        if (attempt === 4) {
          failures.push(`${article.titleEn}：${error.message}`);
        } else {
          if (error.status === 429 || error.status >= 500) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2000));
          }
        }
      }
    }
  }
}

await Promise.all(Array.from({ length: workerCount }, () => worker()));
if (failures.length) throw new Error(`有 ${failures.length} 篇標籤失敗：\n${failures.join("\n")}`);

for (const article of data.articles) {
  article.keywordsZh = checkpoint[articleKey(article)];
  article.keywordPolicyVersion = "general-keywords-v1";
}
data.keywordPolicyVersion = "general-keywords-v1";
data.tagsUpdatedAt = new Date().toISOString();
writeJsonAtomic(dataPath, data);
console.log(`完成 ${data.articles.length} 篇文章的廣義標籤更新。`);

