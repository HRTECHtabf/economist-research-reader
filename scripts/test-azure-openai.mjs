import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const envPath = resolve(projectRoot, ".env.local");

function readEnv(path) {
  const values = {};

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

const env = readEnv(envPath);
const required = [
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
];
const missing = required.filter((name) => !env[name]);

if (missing.length) {
  console.error(`尚未填寫：${missing.join(", ")}`);
  process.exit(1);
}

const endpoint = env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "");
const apiPath = (env.AZURE_OPENAI_API_PATH || "/openai/v1/")
  .replace(/^\/*/, "/")
  .replace(/\/*$/, "/");
const url = `${endpoint}${apiPath}responses`;

try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.AZURE_OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      input: "Reply with exactly: OK",
      max_output_tokens: 64,
      store: false,
    }),
  });

  const bodyText = await response.text();
  let body;

  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const rawMessage =
      body?.error?.message || body?.message || `HTTP ${response.status}`;
    const safeMessage = String(rawMessage)
      .replaceAll(env.AZURE_OPENAI_API_KEY, "[已隱藏金鑰]")
      .replaceAll(env.AZURE_OPENAI_ENDPOINT, "[已隱藏 Endpoint]");

    console.error(`Azure OpenAI 連線失敗（HTTP ${response.status}）：${safeMessage}`);
    process.exit(1);
  }

  console.log("Azure OpenAI 連線成功，Key、Endpoint 與部署名稱皆可使用。");
} catch (error) {
  const safeMessage = String(error?.message || error)
    .replaceAll(env.AZURE_OPENAI_API_KEY, "[已隱藏金鑰]")
    .replaceAll(env.AZURE_OPENAI_ENDPOINT, "[已隱藏 Endpoint]");

  console.error(`無法連線至 Azure OpenAI：${safeMessage}`);
  process.exit(1);
}
