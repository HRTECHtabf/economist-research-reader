import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("標籤管理可列出並刪除預設標籤，且在本機保存結果", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("docs/index.html", projectRoot), "utf8"),
    readFile(new URL("docs/app.js", projectRoot), "utf8"),
  ]);

  assert.match(html, /預設與自訂標籤都可刪除/);
  assert.match(script, /HIDDEN_COMMON_TAGS_STORAGE_KEY/);
  assert.match(script, /COMMON_SEARCH_TAGS[\s\S]*isDefault: true/);
  assert.match(script, /state\.hiddenCommonTags\.add\(tag\.query\)/);
  assert.match(script, /state\.selectedTags\.delete\(tag\.query\)/);
  assert.match(script, /saveHiddenCommonTags\(\)/);
});

test("重新輸入被刪除的預設標籤可將它恢復", async () => {
  const script = await readFile(new URL("docs/app.js", projectRoot), "utf8");

  assert.match(script, /COMMON_SEARCH_TAGS\.includes\(query\)[\s\S]*state\.hiddenCommonTags\.delete\(query\)/);
});
