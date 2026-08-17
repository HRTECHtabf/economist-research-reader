import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const publicRoot = resolve(projectRoot, "docs");
const rawArticlesPath = resolve(projectRoot, ".cache/articles.raw.json");
const port = Number(process.env.INTERNAL_PREVIEW_PORT || 4173);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");

  if (url.pathname === "/internal/articles.json") {
    if (!existsSync(rawArticlesPath)) {
      send(response, 404, "找不到本機文章暫存；請先執行單期解析。\n");
      return;
    }
    const raw = JSON.parse(readFileSync(rawArticlesPath, "utf8"));
    const internalPayload = {
      issueKey: raw.issueKey,
      articles: (raw.articles || []).map(({ id, textEn }) => ({ id, textEn })),
    };
    send(response, 200, `${JSON.stringify(internalPayload)}\n`, "application/json; charset=utf-8");
    return;
  }

  const requestedPath = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  const relativePath = decodeURIComponent(requestedPath);
  const filePath = resolve(publicRoot, `.${relativePath}`);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    send(response, 403, "Forbidden\n");
    return;
  }
  if (!existsSync(filePath)) {
    send(response, 404, "Not found\n");
    return;
  }
  send(response, 200, readFileSync(filePath), mimeTypes[extname(filePath)] || "application/octet-stream");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`內部預覽已啟動：http://127.0.0.1:${port}`);
  console.log("此服務只綁定本機；頁面內容與公開網站資料格式相同。");
});
