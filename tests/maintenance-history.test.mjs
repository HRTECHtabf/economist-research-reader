import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MAINTENANCE_HISTORY,
  mergeMaintenanceHistory,
  workflowRunIdentity,
} from "../scripts/lib/maintenance-history.mjs";

test("事故紀錄依執行編號去重、保留新版並限制最近 30 次", () => {
  const records = Array.from({ length: 35 }, (_, index) => ({
    runId: index + 1,
    runAttempt: 1,
    recordedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const duplicate = { ...records.at(-1), outcome: "failure" };
  const merged = mergeMaintenanceHistory([duplicate], records);
  assert.equal(merged.length, MAX_MAINTENANCE_HISTORY);
  assert.equal(merged[0].runId, 35);
  assert.equal(merged[0].outcome, "failure");
});

test("GitHub 執行識別會產生可對應維運頁列項的網址", () => {
  assert.deepEqual(workflowRunIdentity({
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_SHA: "abc",
  }), {
    runId: 12345,
    runAttempt: 2,
    runUrl: "https://github.com/owner/repo/actions/runs/12345",
    commitSha: "abc",
  });
});
