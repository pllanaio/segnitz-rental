(function (root) {
    'use strict';
    function normalizeQuery(value) { return String(value || '').trim().normalize('NFC').toLocaleLowerCase('de'); }
    function filter(products, category, query) {
        const term = normalizeQuery(query);
        return products.filter(product => {
            const categories = (product.categories || []).map(value => typeof value === 'string' ? value : value.name).filter(Boolean);
            const categoryMatches = category === 'all' || categories.some(value => value.toLocaleLowerCase('de') === String(category).toLocaleLowerCase('de'));
            return categoryMatches && (!term || [product.title, product.description, product.product_key, ...categories].filter(Boolean).join(' ').normalize('NFC').toLocaleLowerCase('de').includes(term));
        });
    }
    function requestCache({ ttlMs = 10000, maxEntries = 200, now = Date.now } = {}) {
        const cache = new Map();
        return async (key, fetcher) => {
            const existing = cache.get(key);
            if (existing && (existing.pending || existing.expires > now())) return existing.promise;
            if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
            const entry = { pending: true, expires: 0 };
            entry.promise = Promise.resolve().then(fetcher).then(value => {
                entry.pending = false;
                entry.expires = now() + ttlMs;
                return value;
            }).catch(error => {
                if (cache.get(key) === entry) cache.delete(key);
                throw error;
            });
            cache.set(key, entry);
            return entry.promise;
        };
    }
    function latestRequest() {
        let generation = 0;
        let controller = null;
        function cancel() { generation++; controller?.abort(); controller = null; }
        async function run(fetcher) {
            cancel();
            const active = generation;
            controller = new AbortController();
            try {
                const result = await fetcher(controller.signal);
                return active === generation ? result : null;
            } catch (error) {
                if (active !== generation) return null;
                throw error;
            } finally { if (active === generation) controller = null; }
        }
        return { run, cancel };
    }
    const api = Object.freeze({ filter, requestCache, normalizeQuery, latestRequest });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CatalogState = api;
})(typeof window === 'object' ? window : globalThis);
