'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertReleaseRun } = require('./release-gate');

async function main() {
    const repository = process.env.GITHUB_REPOSITORY;
    const runId = process.env.RELEASE_RUN_ID;
    if (repository !== 'pllanaio/segnitz-rental' || !/^[1-9][0-9]*$/.test(runId || '')) throw new Error('Invalid release repository or run');
    async function api(suffix) {
        const response = await fetch(`https://api.github.com/repos/${repository}/${suffix}`, {
            headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
            signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) throw new Error(`GitHub evidence unavailable (${response.status})`);
        return response;
    }
    const run = await (await api(`actions/runs/${runId}`)).json();
    const jobs = [];
    for (let page = 1; page <= 20; page++) {
        const data = await (await api(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`)).json();
        jobs.push(...data.jobs);
        if (data.jobs.length < 100) break;
        if (page === 20) throw new Error('Too many workflow jobs');
    }
    assertReleaseRun(run, jobs, { sha: process.env.RELEASE_SHA, repository });
    const artifacts = [];
    for (let page = 1; page <= 20; page++) {
        const data = await (await api(`actions/runs/${runId}/artifacts?per_page=100&page=${page}`)).json();
        artifacts.push(...data.artifacts);
        if (data.artifacts.length < 100) break;
        if (page === 20) throw new Error('Too many workflow artifacts');
    }
    const matching = artifacts.filter(item => item.name === `release-image-${process.env.RELEASE_SHA}` && !item.expired);
    if (matching.length !== 1) throw new Error('Exactly one non-expired release artifact required; rerun complete CI if expired');
    const artifact = matching[0];
    if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')) throw new Error('GitHub artifact digest missing');
    const response = await api(`actions/artifacts/${artifact.id}/zip`);
    const directory = 'release-evidence';
    fs.mkdirSync(directory, { recursive: false });
    const output = fs.createWriteStream(path.join(directory, 'artifact.zip'), { flags: 'wx' });
    const hash = crypto.createHash('sha256');
    try {
        for await (const chunk of response.body) {
            hash.update(chunk);
            if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
        }
        await new Promise((resolve, reject) => { output.end(resolve); output.on('error', reject); });
    } catch (error) { output.destroy(); throw error; }
    if (`sha256:${hash.digest('hex')}` !== artifact.digest) throw new Error('GitHub artifact checksum mismatch');
    fs.writeFileSync(path.join(directory, 'gate-evidence.json'), JSON.stringify({ run, jobs, artifact }, null, 2));
    console.log(JSON.stringify({ ciRunId: run.id, commit: run.head_sha, artifactId: artifact.id, artifactDigest: artifact.digest }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
