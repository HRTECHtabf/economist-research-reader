import assert from "node:assert/strict";
import test from "node:test";
import { classifyUpdateState, selectTargetIssue } from "../scripts/lib/update-state.mjs";

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

const listing = ["te_2026.08.29", "te_2026.09.05", "te_2026.09.12", "te_2026.10.10", "README.md"].map((name) => ({
  name,
  type: name.endsWith(".md") ? "file" : "dir",
  sha: `sha-${name}`,
}));

test("落後多期時依時間順序先補最舊的一期，並回報剩餘期數", () => {
  const selection = selectTargetIssue(listing, "te_2026.08.29");
  assert.equal(selection.target.name, "te_2026.09.05");
  assert.equal(selection.latest.name, "te_2026.10.10");
  assert.equal(selection.backlogRemaining, 2);
});

test("已追上最新一期時檢查最新一期本身，不再有待補期數", () => {
  const selection = selectTargetIssue(listing, "te_2026.10.10");
  assert.equal(selection.target.name, "te_2026.10.10");
  assert.equal(selection.backlogRemaining, 0);
});

test("沒有既有資料時直接處理最新一期；來源沒有期數時回傳 null", () => {
  assert.equal(selectTargetIssue(listing, "").target.name, "te_2026.10.10");
  assert.equal(selectTargetIssue([{ name: "README.md", type: "file" }], "te_2026.08.29"), null);
});
