import assert from "node:assert/strict";
import test from "node:test";
import { classifyUpdateState } from "../scripts/lib/update-state.mjs";

const latestFolder = "te_2026.08.29";
const latestSha = "abc123";

test("同一期同版本安全結束，不重跑內容", () => {
  assert.deepEqual(classifyUpdateState({
    currentData: { issueFolder: latestFolder, sourceFolderSha: latestSha },
    latestFolder,
    latestSha,
  }), { kind: "none", contentChanged: false, siteDataChanged: false });
});

test("舊資料缺來源版本時只補 metadata", () => {
  assert.deepEqual(classifyUpdateState({
    currentData: { issueFolder: latestFolder },
    latestFolder,
    latestSha,
  }), { kind: "metadata", contentChanged: false, siteDataChanged: true });
});

test("新期數、同一期來源異動與 force 都要處理內容", () => {
  for (const currentData of [
    { issueFolder: "te_2026.08.22", sourceFolderSha: "old" },
    { issueFolder: latestFolder, sourceFolderSha: "changed" },
  ]) {
    assert.equal(classifyUpdateState({ currentData, latestFolder, latestSha }).kind, "content");
  }
  assert.equal(classifyUpdateState({
    currentData: { issueFolder: latestFolder, sourceFolderSha: latestSha },
    latestFolder,
    latestSha,
    force: true,
  }).kind, "content");
});
