export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|net::|Target closed|Navigation failed|429|RATE_LIMIT|quota|RESOURCE_EXHAUSTED|AbortError/i.test(
    message
  );
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    attempts: number;
    baseDelayMs: number;
    label: string;
    onRetry?: (error: unknown, attempt: number) => void;
  }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt === options.attempts) {
        throw error;
      }
      const delay = options.baseDelayMs * 2 ** (attempt - 1);
      options.onRetry?.(error, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}
