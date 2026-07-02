// Dep-free fixed-window rate limiter (per client IP + route) — protects credential endpoints
// from brute force. In-memory, which is right-sized for this single-process app.
export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) for (const [k, h] of hits) if (now - h.start > windowMs) hits.delete(k);
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    if (++h.count > max) {
      res.setHeader('Retry-After', Math.ceil((h.start + windowMs - now) / 1000));
      return res.status(429).json({ error: 'too many attempts — wait a minute and try again' });
    }
    next();
  };
}
