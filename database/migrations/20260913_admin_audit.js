'use strict';

// Immutable migration: its complete bytes are part of the recorded checksum.
const fs = require('node:fs');

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS admin_mutation_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id INT NOT NULL,
    actor_ref CHAR(64) NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    request_id CHAR(36) NOT NULL,
    action VARCHAR(128) NOT NULL,
    order_id INT NOT NULL,
    order_item_id INT NULL,
    payment_id INT NULL,
    snapshot_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_admin_mutation_order (order_id, id),
    KEY idx_admin_mutation_actor (actor_user_id, id),
    KEY idx_admin_mutation_request (request_id),
    CONSTRAINT chk_admin_mutation_identity CHECK (
        actor_user_id > 0 AND order_id > 0
        AND (order_item_id IS NULL OR order_item_id > 0)
        AND (payment_id IS NULL OR payment_id > 0)
        AND actor_role IN ('global_admin', 'bearbeiter')
    ),
    CONSTRAINT chk_admin_mutation_snapshot CHECK (
        JSON_TYPE(snapshot_json) = 'OBJECT'
        AND JSON_CONTAINS_PATH(snapshot_json, 'one', '$.schemaVersion') = 1
        AND JSON_EXTRACT(snapshot_json, '$.schemaVersion') = 1
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const TRIGGERS = Object.freeze([
    { name: 'admin_mutation_events_no_update', event: 'UPDATE' },
    { name: 'admin_mutation_events_no_delete', event: 'DELETE' }
]);
const SIGNAL_SQL = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'admin_mutation_events is append only'";

function normalizedStatement(value) {
    return String(value || '').replace(/`/g, '').replace(/_utf8mb4(?=')/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function assertAuditTriggers(rows) {
    if (!Array.isArray(rows) || rows.length !== TRIGGERS.length) {
        const error = new Error('Append-only audit trigger contract violated');
        error.code = 'ADMIN_AUDIT_TRIGGER_DRIFT';
        throw error;
    }
    for (const expected of TRIGGERS) {
        const row = rows.find(candidate => candidate.triggerName === expected.name);
        if (!row || row.event !== expected.event || row.timing !== 'BEFORE' ||
            normalizedStatement(row.statement) !== normalizedStatement(SIGNAL_SQL)) {
            const error = new Error('Append-only audit trigger contract violated');
            error.code = 'ADMIN_AUDIT_TRIGGER_DRIFT';
            throw error;
        }
    }
}

async function readTriggers(connection) {
    const [rows] = await connection.execute(`SELECT TRIGGER_NAME AS triggerName, EVENT_MANIPULATION AS event,
        ACTION_TIMING AS timing, ACTION_STATEMENT AS statement
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'admin_mutation_events'`);
    return rows;
}

async function up(connection) {
    await connection.query(TABLE_SQL);
    const existing = await readTriggers(connection);
    for (const trigger of TRIGGERS) {
        if (!existing.some(row => row.triggerName === trigger.name)) {
            await connection.query(`CREATE TRIGGER ${trigger.name} BEFORE ${trigger.event}
                ON admin_mutation_events FOR EACH ROW ${SIGNAL_SQL}`);
        }
    }
    // A retry may complete missing DDL, but never replaces a different existing trigger.
    assertAuditTriggers(await readTriggers(connection));
}

module.exports = {
    TABLE_SQL, TRIGGERS, SIGNAL_SQL, up, readTriggers, assertAuditTriggers,
    migration: { version: '20260913_03_admin_audit', checksumVersion: 2,
        checksumSource: fs.readFileSync(__filename, 'utf8'), up }
};
