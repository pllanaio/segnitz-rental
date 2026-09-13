'use strict';
const UNAVAILABLE_CODES = new Set([
    'DB_UNAVAILABLE', 'DB_QUEUE_FULL', 'DB_ACQUIRE_TIMEOUT', 'DB_QUERY_TIMEOUT',
    'DB_TRANSACTION_TIMEOUT', 'DB_CONNECTION_CLOSED', 'DB_READINESS_TIMEOUT',
    'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST',
    'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS', 'ER_USER_LIMIT_REACHED',
    'ER_QUERY_TIMEOUT', 'ER_QUERY_INTERRUPTED', 'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK'
]);

function errorStatus(error, fallback = 500) {
    if (UNAVAILABLE_CODES.has(error?.code)) return 503;
    if ([400, 409, 413, 415, 429, 503].includes(error?.status)) return error.status;
    return fallback;
}

module.exports = { errorStatus };
