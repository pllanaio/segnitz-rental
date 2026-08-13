'use strict';

const RETRYABLE_TRANSACTION_CODES = new Set([
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT'
]);

function isRetryableTransactionError(error) {
    return RETRYABLE_TRANSACTION_CODES.has(error?.code) ||
        [1205, 1213].includes(Number(error?.errno));
}

function retryDelay(attempt) {
    return new Promise(resolve => setTimeout(resolve, 10 * attempt));
}

async function runInTransactionWithRetry(createConnection, work, options = {}) {
    const maxAttempts = Number.isInteger(options.maxAttempts)
        ? Math.min(Math.max(options.maxAttempts, 1), 5)
        : 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let connection;

        try {
            connection = await createConnection();
            await connection.beginTransaction();

            const result = await work(connection, attempt);
            await connection.commit();
            return result;
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    error.rollbackError = rollbackError;
                }
            }

            if (!isRetryableTransactionError(error) || attempt === maxAttempts) {
                throw error;
            }

            await retryDelay(attempt);
        } finally {
            if (connection) await connection.end();
        }
    }

    throw new Error('Transaktion konnte nicht ausgeführt werden.');
}

module.exports = {
    isRetryableTransactionError,
    runInTransactionWithRetry
};
