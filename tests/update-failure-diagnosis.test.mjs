import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseUpdateFailure } from "../scripts/lib/update-failure-diagnosis.mjs";

test("辨識來源尚未上架且避免提前呼叫 Azure", () => {
  const result = diagnoseUpdateFailure("EPUB 尚未可用（HTTP 404）");
  assert.equal(result.kind, "source_unavailable");
  assert.match(result.action, /不呼叫 Azure/);
});

test("辨識限流與摘要驗證失敗", () => {
  assert.equal(diagnoseUpdateFailure("HTTP 429: rate limit").kind, "azure_capacity");
  assert.equal(
    diagnoseUpdateFailure("初稿有 2 篇失敗：摘要長度 119").kind,
    "summary_validation",
  );
});

test("未知錯誤保留為待追查，不誤判成功", () => {
  assert.equal(diagnoseUpdateFailure("unexpected condition").kind, "unknown");
});
