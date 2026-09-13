'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { REQUIRED_JOBS, assertReleaseRun, assertDependencies } = require('../scripts/release-gate');
const { securityFailures } = require('../scripts/check-codeql');
const sha = '1'.repeat(40);
const run = { head_sha: sha, head_branch: 'main', event: 'push', path: '.github/workflows/ci.yml',
    repository: { full_name: 'pllanaio/segnitz-rental' }, status: 'completed', conclusion: 'success' };
const jobs = REQUIRED_JOBS.map(name => ({ name, status: 'completed', conclusion: 'success', head_sha: sha }));

test('release accepts only every successful required check on exact main commit', () => {
    assert.equal(assertReleaseRun(run, jobs, { sha }), true);
    for (const missing of REQUIRED_JOBS) {
        assert.throws(() => assertReleaseRun(run, jobs.filter(job => job.name !== missing), { sha }));
        for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', null]) {
            assert.throws(() => assertReleaseRun(run, jobs.map(job => job.name === missing ? { ...job, conclusion } : job), { sha }));
        }
    }
});
test('green CI cannot cover red CodeQL, a stale SHA, fork or PR result', () => {
    assert.throws(() => assertReleaseRun(run, jobs.map(job => job.name.includes('CodeQL') ? { ...job, conclusion: 'failure' } : job), { sha }));
    for (const changed of [{ head_sha: '2'.repeat(40) }, { event: 'pull_request' }, { head_branch: 'feature' },
        { path: '.github/workflows/other.yml' }, { repository: { full_name: 'fork/segnitz-rental' } }]) {
        assert.throws(() => assertReleaseRun({ ...run, ...changed }, jobs, { sha }));
    }
    assert.throws(() => assertReleaseRun(run, [...jobs, jobs[0]], { sha }));
});
test('final CI gate fails closed for absent or skipped dependencies', () => {
    const needs = Object.fromEntries(['test', 'integration-test', 'e2e-test', 'dependency-audit', 'docker-build', 'codeql'].map(name => [name, { result: 'success' }]));
    assert.equal(assertDependencies(needs), true);
    assert.throws(() => assertDependencies({ ...needs, codeql: { result: 'failure' } }));
    assert.throws(() => assertDependencies({ ...needs, 'docker-build': { result: 'skipped' } }));
    assert.throws(() => assertDependencies({}));
});
test('CodeQL completed analysis blocks high findings despite normal SARIF warning level', () => {
    const sarif = { version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', rules: [{ id: 'security-test', properties: { 'security-severity': '8.1' } }] } },
        results: [{ ruleId: 'security-test', level: 'warning' }] }] };
    assert.deepEqual(securityFailures(sarif), ['security-test']);
    sarif.runs[0].results = [];
    assert.deepEqual(securityFailures(sarif), []);
});

test('malformed or partial CodeQL output cannot become a passing security gate', () => {
    for (const sarif of [{}, { version: '2.1.0', runs: [] }, { version: '2.1.0', runs: [{}] }]) assert.throws(() => securityFailures(sarif));
    const run = { tool: { driver: { name: 'CodeQL', rules: [{ id: 'rule', properties: { 'security-severity': '7.1' } }] } }, results: [] };
    for (const changed of [
        { ...run, results: undefined },
        { ...run, results: [{ ruleId: 'unknown', level: 'warning' }] },
        { ...run, invocations: [{ executionSuccessful: false }] },
        { ...run, tool: { driver: { name: 'CodeQL', rules: [{ id: 'rule', properties: { 'security-severity': 'not-a-number' } }] } } }
    ]) assert.throws(() => securityFailures({ version: '2.1.0', runs: [changed] }));
});
