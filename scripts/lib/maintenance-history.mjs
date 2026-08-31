export const MAX_MAINTENANCE_HISTORY = 30;

export function mergeMaintenanceHistory(...collections) {
  const byRun = new Map();
  for (const item of collections.flat()) {
    if (!item?.runId) continue;
    const key = `${item.runId}:${item.runAttempt || 1}`;
    if (!byRun.has(key)) byRun.set(key, item);
  }
  return [...byRun.values()]
    .sort((a, b) => String(b.recordedAt || "").localeCompare(String(a.recordedAt || "")))
    .slice(0, MAX_MAINTENANCE_HISTORY);
}

export function workflowRunIdentity(env = process.env) {
  if (!env.GITHUB_RUN_ID) return null;
  return {
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT) || 1,
    runUrl: `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    commitSha: env.GITHUB_SHA || null,
  };
}
