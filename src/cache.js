// Small in-memory cache with expiry, so repeat requests for the same token
// within a minute don't hit the RPC node again.
export class TtlCache {
  constructor({ ttlMs, maxEntries = 500 }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

// Simple per-IP limiter (fixed one-minute windows).
export function rateLimit({ max, windowMs = 60_000 }) {
  const hits = new Map();
  let windowStart = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      hits.clear();
      windowStart = now;
    }
    const key = req.ip || "unknown";
    const count = (hits.get(key) ?? 0) + 1;
    hits.set(key, count);
    if (count > max) {
      res.setHeader("Retry-After", Math.ceil((windowMs - (now - windowStart)) / 1000));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests; slow down and retry shortly." });
    }
    next();
  };
}
