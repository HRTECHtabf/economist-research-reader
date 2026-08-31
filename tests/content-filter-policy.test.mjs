import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_UNAVAILABLE_REASONS,
  describeAzureContentFilter,
  isContentFilterError,
  translationCoverage,
} from "../scripts/lib/content-filter-policy.mjs";

test("內容安全拒絕會被辨識為隔離條件，其他錯誤不會", () => {
  assert.equal(isContentFilterError(new Error("response filtered due to content management policy")), true);
  assert.equal(isContentFilterError(new Error("content_filter")), true);
  assert.equal(isContentFilterError(new Error("Azure 內容安全篩選拒絕；偵測分類：暴力（medium）。")), true);
  assert.equal(isContentFilterError(new Error("HTTP 429")), false);
  assert.equal(isContentFilterError(new Error("段落長度不足")), false);
});

test("健康檢查把合格譯文與明確隔離文章合併計算覆蓋率", () => {
  assert.equal(translationCoverage({ articleCount: 443, unavailableCount: 1 }), 444);
  assert.equal(translationCoverage({ articleCount: 373 }), 373);
});

test("稽核只接受安全篩選或三次失敗兩種明確隔離原因", () => {
  assert.equal(ALLOWED_UNAVAILABLE_REASONS.has("azure_content_filter"), true);
  assert.equal(ALLOWED_UNAVAILABLE_REASONS.has("retry_exhausted_after_3_attempts"), true);
  assert.equal(ALLOWED_UNAVAILABLE_REASONS.has("unknown"), false);
});

test("Azure 安全回應只公開被攔截的分類與嚴重度，不公開輸入內容", () => {
  const message = describeAzureContentFilter({
    error: {
      message: "generic",
      innererror: {
        content_filter_result: {
          hate: { filtered: false, severity: "safe" },
          violence: { filtered: true, severity: "medium" },
          protected_material_text: { detected: true, filtered: true },
        },
      },
    },
  });
  assert.equal(message, "Azure 內容安全篩選拒絕；偵測分類：暴力（medium）、受保護文字。");
  assert.equal(describeAzureContentFilter({ error: { message: "沒有分類" } }), null);
});
