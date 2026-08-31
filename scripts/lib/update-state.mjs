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
