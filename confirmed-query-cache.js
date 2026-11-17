// Only complete, server-confirmed query results enter this cache. UI callers
// opt into a bounded age; exports and validation reads remain fresh by default.
(function (root) {
    class ConfirmedQueryCache {
        constructor() { this.memory = new Map(); this.epochs = new Map(); this.pending = new Map(); }
        static scope(uid, path) { return JSON.stringify([uid, path]); }
        epoch(scope) {
            try { return localStorage.getItem('mmk_query_epoch:' + scope) || ''; }
            catch (_) { return this.epochs.get(scope) || ''; }
        }
        invalidate(scope) {
            const value = Date.now() + ':' + Math.random();
            this.epochs.set(scope, value);
            try { localStorage.setItem('mmk_query_epoch:' + scope, value); } catch (_) {}
            for (const [key, entry] of this.memory) if (entry.scope === scope) this.memory.delete(key);
        }
        async database() {
            if (!this.opening) this.opening = new Promise(resolve => {
                if (typeof indexedDB === 'undefined') return resolve(null);
                const request = indexedDB.open('mmk-confirmed-queries', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('queries', { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
                request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
                request.onerror = request.onblocked = () => resolve(null);
            });
            return this.opening;
        }
        async read(key) {
            if (this.memory.has(key)) return this.memory.get(key);
            try {
                const db = await this.database(); if (!db) return null;
                return await new Promise(resolve => {
                    const request = db.transaction('queries').objectStore('queries').get(key);
                    request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null);
                });
            } catch (_) { return null; }
        }
        async write(entry) {
            this.memory.set(entry.key, entry);
            while (this.memory.size > 32) this.memory.delete(this.memory.keys().next().value);
            try {
                const db = await this.database(); if (!db) return;
                await new Promise(resolve => {
                    const tx = db.transaction('queries', 'readwrite'), store = tx.objectStore('queries');
                    store.put(entry);
                    const count = store.count();
                    count.onsuccess = () => {
                        let remove = count.result - 32;
                        if (remove <= 0) return;
                        const cursor = store.index('savedAt').openCursor();
                        cursor.onsuccess = () => { if (cursor.result && remove-- > 0) { cursor.result.delete(); cursor.result.continue(); } };
                    };
                    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
                });
            } catch (_) { /* Storage-full/private mode does not block cloud reads. */ }
        }
        async load(scope, range, loader, { maxAgeMs = 0, force = false, onCache } = {}) {
            const key = JSON.stringify([scope, range]), epoch = this.epoch(scope);
            const copy = value => JSON.parse(JSON.stringify(value));
            if (maxAgeMs > 0 && !force) {
                const entry = await this.read(key);
                const age = entry && Date.now() - entry.savedAt;
                if (entry && entry.epoch === epoch && this.epoch(scope) === epoch && age >= 0 && age < maxAgeMs) {
                    onCache?.(entry.savedAt); return copy(entry.rows);
                }
            }
            const pendingKey = key + ':' + epoch;
            if (!this.pending.has(pendingKey)) {
                const request = Promise.resolve().then(loader).then(async rows => {
                    if (maxAgeMs > 0 && this.epoch(scope) === epoch) await this.write({ key, scope, epoch, rows: copy(rows), savedAt: Date.now() });
                    return rows;
                }).finally(() => this.pending.delete(pendingKey));
                this.pending.set(pendingKey, request);
            }
            return copy(await this.pending.get(pendingKey));
        }
    }
    root.ConfirmedQueryCache = ConfirmedQueryCache;
    if (typeof module !== 'undefined') module.exports = ConfirmedQueryCache;
})(typeof globalThis !== 'undefined' ? globalThis : window);
