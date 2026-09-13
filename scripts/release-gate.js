'use strict';

const fs = require('node:fs');

const REQUIRED_JOBS = Object.freeze([
    'Unit tests (Node 22)', 'Unit tests (Node 24)', 'MySQL integration tests',
    'Playwright end-to-end tests', 'Production dependency audit',
    'Build and scan release image', 'CodeQL security gate', 'Release gate'
]);

function assertReleaseRun(run, jobs, { sha, repository = 'pllanaio/segnitz-rental' }) {
    if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid release commit');
    if (run.head_sha !== sha || run.head_branch !== 'main' || run.event !== 'push' ||
        run.path !== '.github/workflows/ci.yml' || run.repository?.full_name !== repository ||
        run.status !== 'completed' || run.conclusion !== 'success') {
        throw new Error('Release requires successful main-push CI on the exact commit');
    }
    for (const name of REQUIRED_JOBS) {
        const matches = jobs.filter(job => job.name === name);
        if (matches.length !== 1 || matches[0].status !== 'completed' ||
            matches[0].conclusion !== 'success' || matches[0].head_sha !== sha) {
            throw new Error(`Missing or unsuccessful release check: ${name}`);
        }
    }
    return true;
}

function assertDependencies(needs) {
    const required = ['test', 'integration-test', 'e2e-test', 'dependency-audit', 'docker-build', 'codeql'];
    for (const job of required) {
        if (needs[job]?.result !== 'success') throw new Error(`Release blocked by ${job}`);
    }
    return true;
}

if (require.main === module) {
    try {
        if (process.argv[2] === '--needs') {
            assertDependencies(JSON.parse(process.env.RELEASE_NEEDS));
        } else {
            const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
            assertReleaseRun(data.run, data.jobs, { sha: process.env.RELEASE_SHA });
        }
        console.log('Release gate passed for all required checks.');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { REQUIRED_JOBS, assertReleaseRun, assertDependencies };
