/** Error with a stable machine code and a message safe to show to end users. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message)
  }
}

const hits = new Map<string, number[]>()

/** Tiny in-memory sliding-window limiter. Enough to blunt brute force on auth and pairing. */
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    throw new AppError('rate_limited', 'Too many attempts. Wait a moment and try again.', 429)
  }
  recent.push(now)
  hits.set(key, recent)
}
