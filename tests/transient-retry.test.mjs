import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientError,
  retryAfterMilliseconds,
  retryDelayMilliseconds,
  withTransientRetries,
} from "../scripts/lib/transient-retry.mjs";

test("只把限流、伺服器與短暫網路錯誤列為可重試", () => {
  assert.equal(isTransientError(Object.assign(new Error("rate limited"), { status: 429 })), true);
  assert.equal(isTransientError(Object.assign(new Error("bad gateway"), { status: 502 })), true);
  assert.equal(isTransientError(new TypeError("fetch failed")), true);
  assert.equal(isTransientError(Object.assign(new Error("bad request"), { status: 400 })), false);
});

test("Retry-After 支援秒數與 HTTP 日期", () => {
  assert.equal(retryAfterMilliseconds("3"), 3000);
  assert.equal(
    retryAfterMilliseconds("Mon, 31 Aug 2026 00:00:05 GMT", Date.parse("2026-08-31T00:00:00Z")),
    5000,
  );
});

test("退避時間會尊重 Retry-After 並限制上限", () => {
  assert.equal(retryDelayMilliseconds({ attempt: 1, random: () => 0 }), 1500);
  assert.equal(retryDelayMilliseconds({ attempt: 2, retryAfterMs: 7000, random: () => 0 }), 7000);
  assert.equal(retryDelayMilliseconds({ attempt: 9, random: () => 1 }), 30000);
});

test("短暫錯誤會重試，永久錯誤會立即停止", async () => {
  let attempts = 0;
  const waits = [];
  const result = await withTransientRetries(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("busy"), { status: 503 });
    return "ok";
  }, {
    sleep: async (milliseconds) => waits.push(milliseconds),
    random: () => 0,
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1500, 3000]);

  attempts = 0;
  await assert.rejects(
    withTransientRetries(async () => {
      attempts += 1;
      throw Object.assign(new Error("invalid"), { status: 400 });
    }, { sleep: async () => {} }),
    /invalid/,
  );
  assert.equal(attempts, 1);
});
