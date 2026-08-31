import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, projectRoot), "utf8"));
}

test("公開目錄不攜帶英文全文，分片仍完整覆蓋所有文章", async () => {
  const [source, catalog, manifest] = await Promise.all([
    json("docs/data/articles.json"),
    json("docs/data/catalog.json"),
    json("docs/data/public-manifest.json"),
  ]);
  assert.equal(catalog.articles.length, source.articles.length);
  assert.equal(manifest.totalArticleCount, source.articles.length);
  assert.ok(catalog.articles.every((article) => !("textEn" in article)));

  const sourceByKey = new Map(source.articles.map((article) => [`${article.issueKey}:${article.id}`, article]));
  const shardRecords = [];
  for (const descriptor of Object.values(manifest.englishIssues)) {
    const shard = await json(`docs/data/${descriptor.path}`);
    assert.equal(shard.articleCount, shard.articles.length);
    shardRecords.push(...shard.articles.map((article) => ({ ...article, issueKey: shard.issueKey })));
  }
  assert.equal(shardRecords.length, source.articles.length);
  for (const article of shardRecords) {
    const original = sourceByKey.get(`${article.issueKey}:${article.id}`);
    assert.equal(article.sourceHash, original?.sourceHash);
    assert.equal(article.textEn, original?.textEn);
  }
});

test("前端保留舊資料回退路徑並使用版本化分片", async () => {
  const [app, trends, workflow] = await Promise.all([
    readFile(new URL("docs/app.js", projectRoot), "utf8"),
    readFile(new URL("docs/trends.js", projectRoot), "utf8"),
    readFile(new URL(".github/workflows/weekly-update.yml", projectRoot), "utf8"),
  ]);
  assert.match(app, /public-manifest\.json/);
  assert.match(app, /legacyResponse/);
  assert.match(app, /loadEnglishIssue/);
  assert.doesNotMatch(app, /loadPublicData\(\)\s*\.then\(\(response\)/);
  assert.match(trends, /loadPublicCatalog/);
  assert.doesNotMatch(trends, /loadPublicCatalog\(\)\s*\.then\(\(response\)/);
  assert.match(workflow, /build-public-data\.mjs/);
  assert.match(workflow, /check-storage-budget\.mjs/);
});
