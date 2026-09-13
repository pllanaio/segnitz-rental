'use strict';

// One process-wide budget covers HTTP, workers, probes and the session store.
// Keeping the existing per-operation connection lifecycle avoids returning a
// connection with user variables, locks or an unfinished transaction to a pool.
function databaseError(code) {
    const error = new Error('Datenbank vorübergehend ausgelastet oder nicht erreichbar.');
    error.code = code;
    error.status = 503;
    return error;
}

class ConnectionBudget {
    constructor({ limit = 12, queueLimit = 50, acquireTimeoutMs = 2000 } = {}) {
        this.limit = limit;
        this.queueLimit = queueLimit;
        this.acquireTimeoutMs = acquireTimeoutMs;
        this.active = 0;
        this.queue = [];
        this.closed = false;
        this.connections = new Set();
        this.counters = { acquired: 0, rejected: 0, acquireTimeouts: 0, queryTimeouts: 0, transactionTimeouts: 0, cancellationFailures: 0, quarantined: 0 };
    }

    acquire(signal) {
        if (this.closed || signal?.aborted) return Promise.reject(databaseError('DB_UNAVAILABLE'));
        if (this.active < this.limit) return Promise.resolve(this.reserve());
        if (this.queue.length >= this.queueLimit) {
            this.counters.rejected += 1;
            return Promise.reject(databaseError('DB_QUEUE_FULL'));
        }
        return new Promise((resolve, reject) => {
            const entry = { resolve, reject };
            const remove = error => {
                const index = this.queue.indexOf(entry);
                if (index === -1) return;
                this.queue.splice(index, 1);
                entry.clean();
                reject(error);
            };
            const abort = () => remove(databaseError('DB_UNAVAILABLE'));
            const timer = setTimeout(() => {
                this.counters.acquireTimeouts += 1;
                remove(databaseError('DB_ACQUIRE_TIMEOUT'));
            }, this.acquireTimeoutMs);
            entry.clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
            signal?.addEventListener('abort', abort, { once: true });
            this.queue.push(entry);
        });
    }

    reserve() {
        this.active += 1;
        this.counters.acquired += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active -= 1;
            if (!this.closed && this.queue.length) {
                const entry = this.queue.shift();
                entry.clean();
                entry.resolve(this.reserve());
            }
        };
    }

    snapshot() {
        return { ...this.counters, active: this.active, queued: this.queue.length, limit: this.limit, queueLimit: this.queueLimit };
    }

    close() {
        this.closed = true;
        for (const entry of this.queue.splice(0)) { entry.clean(); entry.reject(databaseError('DB_UNAVAILABLE')); }
        for (const connection of [...this.connections]) connection.destroy();
    }
}

function boundConnection(connection, release, { budget, queryTimeoutMs = 5000, transactionTimeoutMs = 15000, signal, cancelServer } = {}) {
    let closed = false;
    let transactionTimer = null;
    let fatalError = null;
    const pending = new Set();
    Object.defineProperty(connection, Symbol.for('segnitz.mysql.transaction-active'), {
        configurable: false,
        enumerable: false,
        get: () => Boolean(transactionTimer && !closed)
    });
    const original = Object.fromEntries(['execute', 'query', 'ping', 'beginTransaction', 'commit', 'rollback', 'end', 'destroy']
        .filter(name => typeof connection[name] === 'function').map(name => [name, connection[name].bind(connection)]));
    // mysql2 calls its end() callback when COM_QUIT is queued, before the
    // socket closes. Waiting for close keeps the real transport in the budget.
    const transport = connection.connection?.stream;
    if (transport) {
        const queueQuit = original.end;
        original.end = async () => {
            let removeClose = () => {};
            const transportClosed = new Promise(resolve => {
                if (transport.destroyed) return resolve();
                transport.once('close', resolve);
                removeClose = () => transport.removeListener('close', resolve);
            });
            try { await queueQuit(); await transportClosed; }
            finally { removeClose(); }
        };
    }
    const finish = (releaseSlot = true) => {
        clearTimeout(transactionTimer);
        signal?.removeEventListener('abort', onAbort);
        budget?.connections.delete(connection);
        if (releaseSlot) release();
    };
    const destroy = (error = databaseError('DB_CONNECTION_CLOSED')) => {
        if (closed) return;
        closed = true;
        fatalError = error;
        // Stop the client immediately. Socket closure alone does not prove that
        // MySQL stopped executing: reserve capacity until control confirms it.
        clearTimeout(transactionTimer);
        try { original.destroy?.(); } finally {
            for (const reject of [...pending]) reject(error);
            if (cancelServer) {
                Promise.resolve().then(cancelServer).then(() => finish(), () => {
                    if (budget) { budget.counters.cancellationFailures += 1; budget.counters.quarantined += 1; }
                    finish(false);
                });
            } else finish();
        }
    };
    const onAbort = () => destroy(databaseError('DB_UNAVAILABLE'));
    const timed = async (name, args) => {
        if (closed) throw fatalError || databaseError('DB_CONNECTION_CLOSED');
        let timer;
        let rejectPending;
        try {
            return await Promise.race([
                Promise.resolve().then(() => original[name](...args)),
                new Promise((resolve, reject) => {
                    rejectPending = reject;
                    pending.add(reject);
                    timer = setTimeout(() => {
                        if (budget) budget.counters.queryTimeouts += 1;
                        destroy(databaseError('DB_QUERY_TIMEOUT'));
                    }, queryTimeoutMs);
                })
            ]);
        } catch (error) {
            if (['ER_QUERY_TIMEOUT', 'ER_QUERY_INTERRUPTED', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes(error.code)) destroy(error);
            throw error;
        } finally {
            clearTimeout(timer);
            pending.delete(rejectPending);
        }
    };
    for (const name of ['execute', 'query', 'ping']) if (original[name]) connection[name] = (...args) => timed(name, args);
    connection.beginTransaction = async (...args) => {
        if (transactionTimer) throw databaseError('DB_TRANSACTION_ALREADY_ACTIVE');
        const result = await timed('beginTransaction', args);
        transactionTimer = setTimeout(() => {
            if (budget) budget.counters.transactionTimeouts += 1;
            destroy(databaseError('DB_TRANSACTION_TIMEOUT'));
        }, transactionTimeoutMs);
        return result;
    };
    for (const name of ['commit', 'rollback']) connection[name] = async (...args) => {
        const result = await timed(name, args);
        clearTimeout(transactionTimer);
        transactionTimer = null;
        return result;
    };
    connection.end = async () => {
        if (closed) return;
        try {
            if (transactionTimer) await connection.rollback();
            await timed('end', []);
        } catch (error) { destroy(error); throw error; } finally {
            // Fatal SQL/transaction deadline may already have destroyed it.
            if (!closed) { closed = true; finish(); }
        }
    };
    connection.destroy = () => destroy();
    budget?.connections.add(connection);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return connection;
}

module.exports = { ConnectionBudget, boundConnection, databaseError };
