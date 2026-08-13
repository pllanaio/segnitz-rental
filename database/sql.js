'use strict';

const fs = require('node:fs');

function readSqlStatements(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .split(/;\s*(?:\r?\n|$)/)
        .map(statement => statement.trim())
        .filter(Boolean);
}

function removeSqlComments(statement) {
    return statement
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
}

module.exports = {
    readSqlStatements,
    removeSqlComments
};
