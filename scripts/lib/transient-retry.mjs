const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isTransientError(error) {
  if (TRANSIENT_STATUS_CODES.has(Number(error?.status))) return true;
  if (error instanceof TypeError) return true;
  return ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT"].includes(error?.code);
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

export function retryDelayMilliseconds({
  attempt,
  retryAfterMs = 0,
  baseDelayMs = 1500,
  maximumDelayMs = 30000,
  random = Math.random,
}) {
  const exponentialDelay = baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.round(exponentialDelay * 0.2 * random());
  return Math.min(maximumDelayMs, Math.max(retryAfterMs, exponentialDelay + jitter));
}

export async function withTransientRetries(operation, {
  maxAttempts = 3,
  sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  onRetry = () => {},
  random = Math.random,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation({ attempt });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientError(error)) throw error;
      const delayMs = retryDelayMilliseconds({
        attempt,
        retryAfterMs: error.retryAfterMs,
        random,
      });
      await onRetry({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
