'use strict';

class MigrationStateError extends Error {
    constructor(issues) {
        super(`Datenbank-Migrationsstand ist nicht kompatibel: ${issues.join('; ')}`);
        this.name = 'MigrationStateError';
        this.issues = issues;
    }
}

function collectUnknownMigrationIssues(appliedRows, expectedManifest) {
    const expectedVersions = new Set(expectedManifest.map(migration => migration.version));
    const unknownVersions = appliedRows
        .map(row => row.version)
        .filter(version => !expectedVersions.has(version));

    return unknownVersions.length > 0
        ? [`unbekannte oder neuere Migrationen: ${unknownVersions.join(', ')}`]
        : [];
}

function assertNoUnknownAppliedMigrations(appliedRows, expectedManifest) {
    const issues = collectUnknownMigrationIssues(appliedRows, expectedManifest);
    if (issues.length > 0) throw new MigrationStateError(issues);
}

function assertExactAppliedMigrationState(appliedRows, expectedManifest) {
    const issues = collectUnknownMigrationIssues(appliedRows, expectedManifest);
    const appliedByVersion = new Map(appliedRows.map(row => [row.version, row.checksum]));

    for (const migration of expectedManifest) {
        if (!appliedByVersion.has(migration.version)) {
            issues.push(`Migration ${migration.version} fehlt`);
        } else if (appliedByVersion.get(migration.version) !== migration.checksum) {
            issues.push(`Prüfsumme von Migration ${migration.version} weicht ab`);
        }
    }

    if (issues.length > 0) throw new MigrationStateError(issues);
}

module.exports = {
    MigrationStateError,
    assertExactAppliedMigrationState,
    assertNoUnknownAppliedMigrations
};
