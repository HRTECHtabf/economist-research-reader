import test from "node:test";
import assert from "node:assert/strict";
import {
  isContentFilterError,
  translationCoverage,
} from "../scripts/lib/content-filter-policy.mjs";

test("內容安全拒絕會被辨識為隔離條件，其他錯誤不會", () => {
  assert.equal(isContentFilterError(new Error("response filtered due to content management policy")), true);
  assert.equal(isContentFilterError(new Error("content_filter")), true);
  assert.equal(isContentFilterError(new Error("HTTP 429")), false);
  assert.equal(isContentFilterError(new Error("段落長度不足")), false);
});

test("健康檢查把合格譯文與明確隔離文章合併計算覆蓋率", () => {
  assert.equal(translationCoverage({ articleCount: 443, unavailableCount: 1 }), 444);
  assert.equal(translationCoverage({ articleCount: 373 }), 373);
});
