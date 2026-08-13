'use strict';

function normalizeSequenceYear(value = new Date().getFullYear()) {
    const year = Number(value);

    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
        throw new Error('Ungültiges Jahr für die Kundennummern-Sequenz.');
    }

    return year;
}

async function allocateCustomerNumber(connection, yearValue) {
    const year = normalizeSequenceYear(yearValue);

    await connection.execute(
        `INSERT INTO customer_number_sequences (sequence_year, sequence_value)
         VALUES (?, 0)
         ON DUPLICATE KEY UPDATE sequence_year = VALUES(sequence_year)`,
        [year]
    );

    await connection.execute(
        `UPDATE customer_number_sequences
         SET sequence_value = LAST_INSERT_ID(sequence_value + 1)
         WHERE sequence_year = ?`,
        [year]
    );

    const [rows] = await connection.execute(
        'SELECT LAST_INSERT_ID() AS sequenceValue'
    );
    const sequenceValue = Number(rows[0]?.sequenceValue);

    if (!Number.isInteger(sequenceValue) || sequenceValue < 1 || sequenceValue > 99999) {
        throw new Error('Kundennummern-Sequenz ist erschöpft oder ungültig.');
    }

    return `K${year}${String(sequenceValue).padStart(5, '0')}`;
}

module.exports = {
    allocateCustomerNumber,
    normalizeSequenceYear
};
