export function logInfo(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[migralens] ${message}${suffix}`);
}

export function logWarn(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.warn(`[migralens] ${message}${suffix}`);
}

export function logError(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.error(`[migralens] ${message}${suffix}`);
}
