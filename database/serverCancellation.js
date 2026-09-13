'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { databaseError } = require('./connectionBudget');

// A single reserved control socket belongs to the configured process budget.
// MySQL allows users to kill their own threads without CONNECTION_ADMIN/PROCESS.
class ServerCancellation {
    constructor({ connect, timeoutMs = 5000 }) {
        this.connect = connect;
        this.timeoutMs = timeoutMs;
        this.tail = Promise.resolve();
        this.closed = false;
        this.abort = null;
        this.connection = null;
    }

    cancel(config, threadId) {
        const id = Number(threadId);
        if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(databaseError('DB_CANCEL_INVALID_THREAD'));
        const deadline = Date.now() + this.timeoutMs;
        const task = this.tail.then(() => this.run(config, id, deadline));
        this.tail = task.catch(() => {});
        return task;
    }

    async run(config, id, deadline) {
        if (this.closed || Date.now() >= deadline) throw databaseError('DB_CANCEL_UNCONFIRMED');
        const abort = new AbortController();
        this.abort = abort;
        let timer;
        try {
            await Promise.race([
                (async () => {
                    const connection = await this.connect(config, abort.signal);
                    this.connection = connection;
                    if (abort.signal.aborted) { connection.destroy(); throw databaseError('DB_CANCEL_UNCONFIRMED'); }
                    try {
                        await connection.query(`KILL CONNECTION ${id}`);
                    } catch (error) {
                        if (error.code !== 'ER_NO_SUCH_THREAD') throw error;
                    }
                    // KILL only sets a flag. Keep capacity charged until MySQL
                    // confirms that execution and connection cleanup have ended.
                    while (true) {
                        const [rows] = await connection.execute('SELECT ID FROM information_schema.PROCESSLIST WHERE ID = ?', [id]);
                        if (rows.length === 0) return;
                        await delay(20, undefined, { signal: abort.signal });
                    }
                })(),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        abort.abort();
                        this.connection?.destroy();
                        reject(databaseError('DB_CANCEL_UNCONFIRMED'));
                    }, Math.max(1, deadline - Date.now()));
                })
            ]);
        } finally {
            clearTimeout(timer);
            abort.abort();
            this.connection?.destroy();
            this.connection = null;
            this.abort = null;
        }
    }

    async drainAndClose() {
        await this.tail;
        this.close();
    }

    close() {
        this.closed = true;
        this.abort?.abort();
        this.connection?.destroy();
    }
}

module.exports = { ServerCancellation };
