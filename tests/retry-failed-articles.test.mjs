import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveRetryRounds,
  retryFailedArticles,
} from "../scripts/lib/retry-failed-articles.mjs";

test("未設定補跑次數時預設啟用兩輪，仍可明確關閉", () => {
  assert.equal(resolveRetryRounds("", 2), 2);
  assert.equal(resolveRetryRounds(undefined, 2), 2);
  assert.equal(resolveRetryRounds("0", 2), 0);
  assert.equal(resolveRetryRounds("3", 2), 3);
});

test("同次工作會只補跑失敗文章，成功後不再重做", async () => {
  const articles = new Map([
    ["issue:a", { key: "issue:a" }],
    ["issue:b", { key: "issue:b" }],
  ]);
  const attempts = new Map();
  const completed = [];
  const remainingByRound = [];

  const remaining = await retryFailedArticles({
    initialFailures: [
      { key: "issue:a", message: "第一次失敗" },
      { key: "issue:b", message: "第一次失敗" },
    ],
    maxRounds: 2,
    findArticle: (key) => articles.get(key),
    retryArticle: async (article) => {
      const attempt = (attempts.get(article.key) || 0) + 1;
      attempts.set(article.key, attempt);
      if (article.key === "issue:b" && attempt === 1) throw new Error("仍漏數字");
      return { key: article.key };
    },
    onSuccess: ({ result }) => completed.push(result.key),
    onRoundComplete: ({ pending }) => remainingByRound.push(pending.map(({ key }) => key)),
  });

  assert.deepEqual(remaining, []);
  assert.deepEqual(completed, ["issue:a", "issue:b"]);
  assert.equal(attempts.get("issue:a"), 1);
  assert.equal(attempts.get("issue:b"), 2);
  assert.deepEqual(remainingByRound, [["issue:b"], []]);
});

test("補跑用盡後仍保留最後錯誤，不會把不合格內容當成功", async () => {
  const failures = [];
  const remaining = await retryFailedArticles({
    initialFailures: [{ key: "issue:a", message: "第一次失敗" }],
    maxRounds: 2,
    findArticle: () => ({ key: "issue:a" }),
    retryArticle: async () => {
      throw new Error("第 1 段遺失阿拉伯數字（原文含：2026）");
    },
    onFailure: ({ failure }) => failures.push(failure.message),
  });

  assert.deepEqual(remaining, [{
    key: "issue:a",
    message: "第 1 段遺失阿拉伯數字（原文含：2026）",
  }]);
  assert.equal(failures.length, 2);
});
