import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { lowContentReason } from "../scripts/lib/low-content-policy.mjs";

const words = (count) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

test("每週漫畫與照片圖說會被排除", () => {
  assert.equal(lowContentReason({ titleEn: "Cartoon: Russia’s war fatigue grows", textEn: words(49) }), "cartoon");
  assert.equal(lowContentReason({ titleEn: "The weekly cartoon", textEn: `Dig deeper ${words(37)}` }), "cartoon");
  assert.equal(
    lowContentReason({ titleEn: "x", sourceUrl: "https://www.economist.com/the-world-this-week/2026/08/27/cartoon-a-b", textEn: words(100) }),
    "cartoon",
  );
  assert.equal(lowContentReason({ titleEn: "Nepal flash floods", textEn: words(46) }), "photo_caption");
});

test("一般短訊與談論卡通的正式文章不會被誤刪", () => {
  assert.equal(lowContentReason({ titleEn: "Two powerful earthquakes hit Venezuela", textEn: words(102) }), null);
  assert.equal(
    lowContentReason({
      titleEn: "China’s latest cash cow is a clunky cartoon bull",
      sourceUrl: "https://www.economist.com/china/2026/08/27/chinas-latest-cash-cow-is-a-clunky-cartoon-bull",
      textEn: words(520),
    }),
    null,
  );
  assert.equal(lowContentReason({ titleEn: "Cartoon: a long essay", textEn: words(400) }), null);
});

test("公開文章庫不含圖片型低內容頁面", async () => {
  const source = JSON.parse(await readFile(new URL("../docs/data/articles.json", import.meta.url), "utf8"));
  const remaining = source.articles.filter((article) => lowContentReason(article));
  assert.deepEqual(remaining.map((article) => article.titleEn), []);
});
