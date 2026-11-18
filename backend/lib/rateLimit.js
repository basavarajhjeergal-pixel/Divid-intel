// Minimal per-IP rate limiter (no extra package). Protects paid AI endpoints.
// Defaults: 20 requests per IP per 10 minutes. Override with env vars.

function rateLimit({
    windowMs = Number(process.env.AI_RATE_WINDOW_MS) || 10 * 60 * 1000,
    max = Number(process.env.AI_RATE_MAX) || 20,
} = {}) {
    const hits = new Map(); // ip -> { count, reset }

    return (req, res, next) => {
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
        const now = Date.now();
        let h = hits.get(ip);
        if (!h || h.reset <= now) {
            h = { count: 0, reset: now + windowMs };
            hits.set(ip, h);
        }
        h.count++;

        if (hits.size > 5000) { // housekeeping
            for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
        }

        res.setHeader('RateLimit-Remaining', Math.max(0, max - h.count));
        if (h.count > max) {
            res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
            return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
        }
        next();
    };
}

module.exports = rateLimit;
