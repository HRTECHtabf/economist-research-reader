import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("趨勢關聯頁在兩個 tag 下方列出共同文章", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("docs/trends.html", projectRoot), "utf8"),
    readFile(new URL("docs/trends.js", projectRoot), "utf8"),
    readFile(new URL("docs/trends.css", projectRoot), "utf8"),
  ]);

  assert.match(html, /id="related-articles"/);
  assert.match(html, /data-tour="related-articles"/);
  assert.match(script, /state\.selectedTags\.every\(\(tag\) => \(article\.keywordsZh \|\| \[\]\)\.includes\(tag\)\)/);
  assert.match(script, /顯示其餘/);
  assert.match(script, /直接查看共同文章/);
  assert.match(styles, /\.related-articles-list/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.related-articles-heading,.related-articles-list \{ grid-template-columns: 1fr; \}/);
});

test("全部 tag 可切換每期、每月與全部資料，並同步共同文章範圍", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("docs/trends.html", projectRoot), "utf8"),
    readFile(new URL("docs/trends.js", projectRoot), "utf8"),
  ]);

  assert.match(html, /id="overview-scope"/);
  assert.match(html, /<option value="issue" selected>每期<\/option><option value="month">每月<\/option><option value="all">全部資料<\/option>/);
  assert.match(script, /function syncRelationshipWithOverview\(\)/);
  assert.match(script, /state\.relationshipScope = state\.overviewScope/);
  assert.match(script, /state\.relationshipIssue = state\.overviewIssue/);
  assert.match(script, /els\.overviewIssue\.addEventListener\("change", \(\) => \{[\s\S]*syncRelationshipWithOverview\(\);[\s\S]*renderRelationshipPanel\(\);/);
  assert.match(script, /state\.overviewScope === "month" \? state\.months/);
  assert.match(script, /較前月升溫/);
});

test("首頁功能導覽會說明共同文章功能", async () => {
  const script = await readFile(new URL("docs/app.js", projectRoot), "utf8");
  assert.match(script, /選擇兩個 tag 後，關聯分析下方會直接列出共同文章/);
});
