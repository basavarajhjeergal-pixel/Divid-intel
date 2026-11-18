// Small in-memory TTL cache with in-flight de-duplication.
// No extra packages needed. On Vercel each warm function instance keeps its own
// cache; for a shared cache later, swap this for Upstash Redis / Vercel KV.

const MAX_ENTRIES = 500;
const store = new Map();   // key -> { value, expires }
const inflight = new Map(); // key -> Promise

async function cached(key, ttlMs, fn) {
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
        try {
            const value = await fn();
            if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // drop oldest
            store.set(key, { value, expires: Date.now() + ttlMs });
            return value;
        } finally {
            inflight.delete(key); // errors are never cached
        }
    })();
    inflight.set(key, p);
    return p;
}

function clearCache() { store.clear(); inflight.clear(); }

module.exports = { cached, clearCache };
