const ISSUE_FOLDER_PATTERN = /^te_\d{4}\.\d{2}\.\d{2}$/;

// 更新停擺好幾週時，只抓最新一期會讓中間的期數永久漏掉。
// 改成依時間順序挑「網站目前期數之後的第一期」，每次補一期；沒有落後時就檢查最新一期本身是否異動。
export function selectTargetIssue(listing, currentFolder = "") {
  const folders = (listing || [])
    .filter((entry) => entry?.type === "dir" && ISSUE_FOLDER_PATTERN.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!folders.length) return null;
  const pending = currentFolder ? folders.filter((entry) => entry.name > currentFolder) : [];
  return {
    target: pending[0] || folders.at(-1),
    latest: folders.at(-1),
    backlogRemaining: Math.max(0, pending.length - 1),
  };
}

export function classifyUpdateState({ currentData, latestFolder, latestSha, force = false }) {
  if (force) {
    return { kind: "content", contentChanged: true, siteDataChanged: true };
  }
  if (
    currentData?.issueFolder === latestFolder &&
    currentData?.sourceFolderSha === latestSha
  ) {
    return { kind: "none", contentChanged: false, siteDataChanged: false };
  }
  if (currentData?.issueFolder === latestFolder && !currentData?.sourceFolderSha) {
    return { kind: "metadata", contentChanged: false, siteDataChanged: true };
  }
  return { kind: "content", contentChanged: true, siteDataChanged: true };
}
