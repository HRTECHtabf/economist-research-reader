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

test("維運頁可區分金鑰、連線與內容安全篩選並提供人工處理建議", () => {
  const auth = diagnoseUpdateFailure("HTTP 401 invalid api key");
  assert.equal(auth.kind, "azure_configuration");
  assert.match(auth.userAction, /GitHub Secrets/);

  const network = diagnoseUpdateFailure("fetch failed ECONNRESET");
  assert.equal(network.kind, "transient_service");
  assert.match(network.automaticAction, /3 次/);

  const filtered = diagnoseUpdateFailure("response filtered due to content management policy");
  assert.equal(filtered.kind, "content_filter");
  assert.match(filtered.action, /不規避安全控制/);
});

test("未知錯誤保留為待追查，不誤判成功", () => {
  assert.equal(diagnoseUpdateFailure("unexpected condition").kind, "unknown");
});
