import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ARTICLE_ATTEMPTS,
  MAX_SKIPPED_ARTICLES,
  isSystemicFailureCount,
  sanitizePublicFailureMessage,
} from "../scripts/lib/article-failure-policy.mjs";

test("單篇最多嘗試 3 次，前 10 篇可隔離，第 11 篇起視為系統性故障", () => {
  assert.equal(MAX_ARTICLE_ATTEMPTS, 3);
  assert.equal(MAX_SKIPPED_ARTICLES, 10);
  assert.equal(isSystemicFailureCount(10), false);
  assert.equal(isSystemicFailureCount(11), true);
});

test("公開錯誤內容會遮蔽疑似金鑰與過長敏感值", () => {
  const message = sanitizePublicFailureMessage(`api_key=secret-value token=${"a".repeat(60)} HTTP 401`);
  assert.doesNotMatch(message, /secret-value|a{40}/);
  assert.match(message, /HTTP 401/);
});
