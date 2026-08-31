import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("公開維運狀態固定揭露 3 次、10 篇與第 11 篇系統故障規則", async () => {
  const status = JSON.parse(await readFile(new URL("docs/data/maintenance-status.json", projectRoot), "utf8"));
  assert.equal(status.version, 2);
  assert.ok(Array.isArray(status.history));
  assert.deepEqual(status.policy, {
    maxAttemptsPerArticle: 3,
    maxSkippedArticles: 10,
    systemicFailureStartsAt: 11,
  });
});

test("維運頁會載入公開診斷且說明安全攔截不重試", async () => {
  const [html, script, app, workflow] = await Promise.all([
    readFile(new URL("docs/admin/index.html", projectRoot), "utf8"),
    readFile(new URL("docs/admin/admin.js", projectRoot), "utf8"),
    readFile(new URL("docs/app.js", projectRoot), "utf8"),
    readFile(new URL(".github/workflows/weekly-update.yml", projectRoot), "utf8"),
  ]);
  assert.match(html, /安全攔截則直接隔離/);
  assert.match(html, /id="maintenance-overall"/);
  assert.match(script, /maintenance-status\.json/);
  assert.match(script, /安全攔截後直接隔離/);
  assert.match(script, /失敗原因：舊版流程未保存診斷/);
  assert.match(script, /完成但有隔離/);
  assert.match(app, /中文摘要暫不可用/);
  assert.match(workflow, /Publish public maintenance diagnosis/);
});
