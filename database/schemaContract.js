'use strict';

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { readSqlStatements } = require('./sql');

const schemaPath = path.join(__dirname, 'schema.sql');
const definitionKeywords = new Set(['CHECK', 'CONSTRAINT', 'FOREIGN', 'KEY', 'PRIMARY', 'UNIQUE']);

class SchemaVerificationError extends Error {
    constructor(issues, mismatches = []) {
        super(`Kanonisches Datenbankschema verletzt: ${issues.join('; ')}`);
        this.name = 'SchemaVerificationError';
        this.issues = issues;
        this.mismatches = mismatches;
        this.mismatchDetails = mismatches.map(mismatch =>
            `${mismatch.kind} ${mismatch.identifier}: ` +
            `expected=${JSON.stringify(mismatch.expected)} actual=${JSON.stringify(mismatch.actual)}`
        );
    }
}

function recordSchemaMismatch(issues, mismatches, {
    actual,
    expected,
    identifier,
    kind,
    message
}) {
    issues.push(message);
    mismatches.push({ identifier, kind, expected: expected ?? null, actual: actual ?? null });
}

function splitDefinitions(definitions) {
    const parts = [];
    let current = '';
    let depth = 0;
    let quote = null;

    for (let index = 0; index < definitions.length; index += 1) {
        const character = definitions[index];
        if (quote) {
            current += character;
            if (character === quote && definitions[index - 1] !== '\\') quote = null;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            current += character;
        } else if (character === '(') {
            depth += 1;
            current += character;
        } else if (character === ')') {
            depth -= 1;
            current += character;
        } else if (character === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += character;
        }
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
}

function normalizeColumnType(type) {
    return String(type).toLowerCase().replace(/\s+/gu, ' ').trim();
}

function normalizeDefault(value) {
    if (value === null || value === undefined || /^NULL$/iu.test(String(value))) return null;
    const normalized = String(value).replace(/^'(.*)'$/su, '$1').trim().toLowerCase();
    return normalized.replace(/^current_timestamp\(\)$/u, 'current_timestamp');
}

function normalizeReferentialRule(rule) {
    const normalized = String(rule || 'RESTRICT').toUpperCase().replace(/\s+/gu, ' ').trim();

    // MySQL enforces NO ACTION and RESTRICT identically and reports an
    // omitted rule as NO ACTION in REFERENTIAL_CONSTRAINTS. schema.sql uses
    // RESTRICT explicitly where that is useful documentation, so compare the
    // two spellings as the same effective rule.
    return normalized === 'NO ACTION' ? 'RESTRICT' : normalized;
}

function normalizeCheckClause(clause) {
    let normalized = String(clause || '')
        .replace(/`/gu, '')
        // MySQL 8.4 can serialize an introduced string literal together with
        // the table's default collation. Remove only that literal annotation;
        // explicit column/expression collations remain part of the contract.
        .replace(
            /(_utf8mb4'(?:''|[^'])*')\s+collate\s+utf8mb4_0900_ai_ci\b/giu,
            '$1'
        )
        .replace(
            /(^|[\s,(=])_(?:utf8mb4|utf8mb3|utf8|latin1|binary)(?=')/giu,
            '$1'
        )
        .toLowerCase()
        .replace(/\s+/gu, ' ')
        .replace(/\s*([(),=<>])\s*/gu, '$1')
        .trim();

    normalized = removeRedundantExpressionParentheses(normalized);

    return normalized;
}

function removeRedundantExpressionParentheses(expression) {
    let normalized = String(expression || '');
    let previous;

    do {
        previous = normalized;

        // MySQL wraps individual predicates in CHECK_CLAUSE and
        // GENERATION_EXPRESSION. Only unwrap an innermost expression when it is
        // neither a list nor a function argument nor an AND/OR group; this keeps
        // precedence-bearing parentheses intact.
        normalized = normalized.replace(/\(([^()]*)\)/gu, (match, content, offset, source) => {
            if (!content.trim() || content.includes(',')) return match;
            if (/\b(?:and|or)\b/iu.test(content)) return match;

            const prefix = source.slice(0, offset).trimEnd();
            const previousWord = /([a-z_][a-z0-9_]*)$/iu.exec(prefix)?.[1]?.toLowerCase();
            if (previousWord && !['and', 'or', 'not', 'when', 'then', 'else'].includes(previousWord)) {
                return match;
            }

            const before = source[offset - 1] || '';
            const after = source[offset + match.length] || '';
            const leadingSpace = /[A-Za-z0-9_'`]/u.test(before) && /[A-Za-z0-9_'`]/u.test(content[0] || '');
            const trailingSpace = /[A-Za-z0-9_'`]/u.test(after) && /[A-Za-z0-9_'`]/u.test(content.at(-1) || '');
            return `${leadingSpace ? ' ' : ''}${content.trim()}${trailingSpace ? ' ' : ''}`;
        });

        // A second outer wrapper never changes grouping semantics.
        normalized = normalized.replace(/\(\(([^()]*)\)\)/gu, '($1)');

        // Within CASE, WHEN/THEN already delimit the condition; an additional
        // wrapper around its boolean expression is syntactic noise.
        normalized = normalized.replace(/\bwhen\s*\(([^()]*)\)\s*then\b/giu, 'when $1 then');

        while (normalized.startsWith('(') && normalized.endsWith(')')) {
            let depth = 0;
            let wrapsWholeExpression = true;

            for (let index = 0; index < normalized.length; index += 1) {
                if (normalized[index] === '(') depth += 1;
                if (normalized[index] === ')') depth -= 1;
                if (depth === 0 && index < normalized.length - 1) {
                    wrapsWholeExpression = false;
                    break;
                }
            }
            if (!wrapsWholeExpression) break;
            normalized = normalized.slice(1, -1).trim();
        }
    } while (normalized !== previous);

    return normalized;
}

function normalizeGenerationExpression(expression) {
    const normalized = normalizeCheckClause(expression);
    return normalized || null;
}

function parseIdentifierList(list) {
    return list.split(',').map(identifier =>
        identifier.trim().replace(/`/gu, '').replace(/\s+(?:ASC|DESC)$/iu, '')
    );
}

function parseConstraint(definition) {
    const match = /^CONSTRAINT\s+`?([A-Za-z0-9_]+)`?\s+([\s\S]+)$/iu.exec(definition);
    if (!match) return null;
    const [, name, body] = match;
    const checkMatch = /^CHECK\s*\(([\s\S]*)\)$/iu.exec(body);
    if (checkMatch) return [name, { type: 'CHECK', clause: normalizeCheckClause(checkMatch[1]) }];

    const foreignKeyMatch = /^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?([A-Za-z0-9_]+)`?\s*\(([^)]+)\)([\s\S]*)$/iu.exec(body);
    if (!foreignKeyMatch) return [name, { type: 'UNKNOWN' }];
    const options = foreignKeyMatch[4];
    const deleteMatch = /\bON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|NO\s+ACTION)/iu.exec(options);
    const updateMatch = /\bON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|NO\s+ACTION)/iu.exec(options);
    return [name, {
        columns: parseIdentifierList(foreignKeyMatch[1]),
        deleteRule: normalizeReferentialRule(deleteMatch?.[1]),
        referencedColumns: parseIdentifierList(foreignKeyMatch[3]),
        referencedTable: foreignKeyMatch[2],
        type: 'FOREIGN KEY',
        updateRule: normalizeReferentialRule(updateMatch?.[1])
    }];
}

function columnDefinitionWithoutGenerationExpression(definition) {
    const generationStart = definition.search(/\bGENERATED\s+ALWAYS\s+AS\b/iu);
    return generationStart === -1 ? definition : definition.slice(0, generationStart);
}

function parseCanonicalSchema(statements = readSqlStatements(schemaPath)) {
    const tables = new Map();
    for (const statement of statements) {
        const match = /^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]*)\)\s*ENGINE\s*=/iu.exec(statement.trim());
        if (!match) continue;
        const [, tableName, body] = match;
        const table = { columns: new Map(), constraints: new Map(), indexes: new Map() };

        for (const definition of splitDefinitions(body)) {
            const constraint = parseConstraint(definition);
            if (constraint) {
                table.constraints.set(...constraint);
                continue;
            }
            const primaryMatch = /^PRIMARY\s+KEY\s*\(([^)]+)\)/iu.exec(definition);
            if (primaryMatch) {
                table.indexes.set('PRIMARY', { columns: parseIdentifierList(primaryMatch[1]), unique: true });
                continue;
            }
            const indexMatch = /^(UNIQUE\s+)?KEY\s+`?([A-Za-z0-9_]+)`?\s*\(([^)]+)\)/iu.exec(definition);
            if (indexMatch) {
                table.indexes.set(indexMatch[2], {
                    columns: parseIdentifierList(indexMatch[3]),
                    unique: Boolean(indexMatch[1])
                });
                continue;
            }
            const columnMatch = /^`?([A-Za-z0-9_]+)`?\s+(.+)$/isu.exec(definition);
            if (!columnMatch || definitionKeywords.has(columnMatch[1].toUpperCase())) continue;
            const typeMatch = /^([A-Za-z]+(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?)/iu.exec(columnMatch[2]);
            if (!typeMatch) continue;
            const defaultMatch = /\bDEFAULT\s+(NULL|'(?:[^']|'')*'|-?\d+(?:\.\d+)?|CURRENT_TIMESTAMP(?:\(\))?)/iu.exec(columnMatch[2]);
            const generationMatch = /\bGENERATED\s+ALWAYS\s+AS\s*\(([\s\S]*)\)\s+(STORED|VIRTUAL)\b/iu.exec(columnMatch[2]);
            const columnAttributes = columnDefinitionWithoutGenerationExpression(columnMatch[2]);
            table.columns.set(columnMatch[1], {
                columnType: normalizeColumnType(typeMatch[1]),
                defaultValue: normalizeDefault(defaultMatch?.[1]),
                generationExpression: normalizeGenerationExpression(generationMatch?.[1]),
                generationStorage: generationMatch?.[2].toLowerCase() || null,
                nullable: !/\bNOT\s+NULL\b/iu.test(columnAttributes)
            });
        }
        tables.set(tableName, table);
    }
    return tables;
}

function buildActualForeignKeys(rows) {
    const foreignKeys = new Map();
    for (const row of rows) {
        const key = `${row.tableName}.${row.constraintName}`;
        if (!foreignKeys.has(key)) {
            foreignKeys.set(key, {
                columns: [], deleteRule: normalizeReferentialRule(row.deleteRule), referencedColumns: [],
                referencedTable: row.referencedTable, type: 'FOREIGN KEY',
                updateRule: normalizeReferentialRule(row.updateRule)
            });
        }
        foreignKeys.get(key).columns.push(row.columnName);
        foreignKeys.get(key).referencedColumns.push(row.referencedColumn);
    }
    return foreignKeys;
}

function normalizeActualColumn(row) {
    return {
        columnType: normalizeColumnType(row.columnType),
        defaultValue: normalizeDefault(row.defaultValue),
        generationExpression: normalizeGenerationExpression(row.generationExpression),
        generationStorage: /STORED\s+GENERATED/iu.test(row.extra) ? 'stored' :
            /VIRTUAL\s+GENERATED/iu.test(row.extra) ? 'virtual' : null,
        nullable: String(row.isNullable).toUpperCase() === 'YES'
    };
}

function schemaPartsEqual(actual, expected) {
    return isDeepStrictEqual(actual, expected);
}

async function verifyCanonicalSchema(connection, contract = parseCanonicalSchema()) {
    const [tableRows] = await connection.execute(
        `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    );
    const [columnRows] = await connection.execute(
        `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
                COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS defaultValue,
                EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
    );
    const [indexRows] = await connection.execute(
        `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
                COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
    );
    const [foreignKeyRows] = await connection.execute(
        `SELECT kcu.TABLE_NAME AS tableName, kcu.CONSTRAINT_NAME AS constraintName,
                kcu.COLUMN_NAME AS columnName, kcu.REFERENCED_TABLE_NAME AS referencedTable,
                kcu.REFERENCED_COLUMN_NAME AS referencedColumn,
                rc.DELETE_RULE AS deleteRule, rc.UPDATE_RULE AS updateRule
         FROM information_schema.KEY_COLUMN_USAGE kcu
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
           ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND rc.TABLE_NAME = kcu.TABLE_NAME AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
         ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`
    );
    const [checkRows] = await connection.execute(
        `SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS constraintName,
                cc.CHECK_CLAUSE AS checkClause
         FROM information_schema.TABLE_CONSTRAINTS tc
         JOIN information_schema.CHECK_CONSTRAINTS cc
           ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.CONSTRAINT_TYPE = 'CHECK'`
    );
    const [openingHourRows] = await connection.execute('SELECT weekday FROM opening_hours ORDER BY weekday');

    const actualTables = new Set(tableRows.map(row => row.tableName));
    const actualColumns = new Map(columnRows.map(row => [
        `${row.tableName}.${row.columnName}`,
        normalizeActualColumn(row)
    ]));
    const actualIndexes = new Map();
    for (const row of indexRows) {
        const key = `${row.tableName}.${row.indexName}`;
        if (!actualIndexes.has(key)) actualIndexes.set(key, { columns: [], unique: Number(row.nonUnique) === 0 });
        actualIndexes.get(key).columns.push(row.columnName);
    }
    const actualConstraints = buildActualForeignKeys(foreignKeyRows);
    for (const row of checkRows) {
        actualConstraints.set(`${row.tableName}.${row.constraintName}`, {
            clause: normalizeCheckClause(row.checkClause), type: 'CHECK'
        });
    }

    const issues = [];
    const mismatches = [];
    for (const [tableName, table] of contract) {
        if (!actualTables.has(tableName)) {
            recordSchemaMismatch(issues, mismatches, {
                actual: null,
                expected: { present: true },
                identifier: tableName,
                kind: 'table',
                message: `Tabelle ${tableName} fehlt`
            });
            continue;
        }
        for (const [columnName, expected] of table.columns) {
            const key = `${tableName}.${columnName}`;
            const actual = actualColumns.get(key);
            if (!actual) {
                recordSchemaMismatch(issues, mismatches, {
                    actual: null,
                    expected,
                    identifier: key,
                    kind: 'column',
                    message: `Spalte ${key} fehlt`
                });
            }
            else if (!schemaPartsEqual(actual, expected)) {
                recordSchemaMismatch(issues, mismatches, {
                    actual,
                    expected,
                    identifier: key,
                    kind: 'column',
                    message: `Spalte ${key} weicht in Typ, NULL-Regel oder Default ab`
                });
            }
        }
        for (const [indexName, expected] of table.indexes) {
            const key = `${tableName}.${indexName}`;
            const actual = actualIndexes.get(key);
            if (!actual || !schemaPartsEqual(actual, expected)) {
                recordSchemaMismatch(issues, mismatches, {
                    actual,
                    expected,
                    identifier: key,
                    kind: 'index',
                    message: `Index ${key} fehlt oder weicht ab`
                });
            }
        }
        for (const [constraintName, expected] of table.constraints) {
            const key = `${tableName}.${constraintName}`;
            const actual = actualConstraints.get(key);
            if (!actual || !schemaPartsEqual(actual, expected)) {
                recordSchemaMismatch(issues, mismatches, {
                    actual,
                    expected,
                    identifier: key,
                    kind: 'constraint',
                    message: `Constraint ${key} fehlt oder weicht ab`
                });
            }
        }
    }

    const weekdays = openingHourRows.map(row => Number(row.weekday));
    if (weekdays.length !== 7 || weekdays.some((weekday, index) => weekday !== index)) {
        issues.push('opening_hours muss genau die Wochentage 0 bis 6 enthalten');
    }
    if (issues.length > 0) throw new SchemaVerificationError(issues, mismatches);
    return {
        columns: [...contract.values()].reduce((sum, table) => sum + table.columns.size, 0),
        constraints: [...contract.values()].reduce((sum, table) => sum + table.constraints.size, 0),
        indexes: [...contract.values()].reduce((sum, table) => sum + table.indexes.size, 0),
        tables: contract.size
    };
}

module.exports = {
    SchemaVerificationError, buildActualForeignKeys, normalizeActualColumn,
    normalizeCheckClause, normalizeColumnType, normalizeDefault,
    normalizeGenerationExpression,
    normalizeReferentialRule,
    removeRedundantExpressionParentheses,
    parseCanonicalSchema, recordSchemaMismatch, schemaPartsEqual, splitDefinitions,
    verifyCanonicalSchema
};
