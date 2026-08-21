export function resolveRetryRounds(value, fallback = 2) {
  if (value === undefined || value === null || value === "") return fallback;
  return Math.max(0, Math.floor(Number(value) || 0));
}

export async function retryFailedArticles({
  initialFailures,
  maxRounds,
  findArticle,
  retryArticle,
  onRoundStart = () => {},
  onSuccess = () => {},
  onFailure = () => {},
  onRoundComplete = () => {},
}) {
  let pending = initialFailures.map((failure) => ({ ...failure }));

  for (let round = 1; round <= maxRounds && pending.length; round += 1) {
    await onRoundStart({ round, maxRounds, pending: [...pending] });
    const nextPending = [];

    for (const previousFailure of pending) {
      const article = findArticle(previousFailure.key);
      if (!article) {
        const failure = {
          key: previousFailure.key,
          message: `自動補跑找不到文章：${previousFailure.key}`,
        };
        nextPending.push(failure);
        await onFailure({ round, failure, article: null });
        continue;
      }

      try {
        const result = await retryArticle(article);
        await onSuccess({ round, result, article });
      } catch (error) {
        const failure = {
          key: previousFailure.key,
          message: error?.message || String(error),
        };
        nextPending.push(failure);
        await onFailure({ round, failure, article });
      }
    }

    pending = nextPending;
    await onRoundComplete({ round, maxRounds, pending: [...pending] });
  }

  return pending;
}
