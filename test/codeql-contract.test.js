'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { securityFailures } = require('../scripts/check-codeql');

// Reduced SARIF 2.1.0 contract fixtures, not a captured production scan.
const packGuid = '11111111-1111-4111-8111-111111111111';
const ruleGuid = '22222222-2222-4222-8222-222222222222';
const low = () => ({ id: 'js/example', properties: { 'security-severity': '4.0' } });
const high = () => ({ id: 'js/example', guid: ruleGuid, properties: { 'security-severity': '8.1' } });
function document(results = []) {
    return { version: '2.1.0', runs: [{
        tool: { driver: { name: 'CodeQL', rules: [] }, extensions: [
            { name: 'codeql/javascript-queries', guid: packGuid, rules: [high()] }
        ] },
        invocations: [{ executionSuccessful: true }], results
    }] };
}
const reference = () => ({ ruleId: 'js/example', ruleIndex: 0, level: 'warning',
    rule: { id: 'js/example', index: 0, toolComponent: { index: 0 } } });

test('CodeQL pack rules with empty or absent driver rules accept a clean completed run', () => {
    const sarif = document();
    assert.deepEqual(securityFailures(sarif), []);
    delete sarif.runs[0].tool.driver.rules;
    assert.deepEqual(securityFailures(sarif), []);
});

test('extension index and component GUID resolve high findings without driver shadowing', () => {
    const sarif = document([reference()]);
    sarif.runs[0].tool.driver.rules = [low()];
    assert.deepEqual(securityFailures(sarif), ['js/example']);
    sarif.runs[0].results = [{ rule: { guid: ruleGuid, toolComponent: { guid: packGuid } }, level: 'warning' }];
    assert.deepEqual(securityFailures(sarif), ['js/example']);
});

test('duplicate rule IDs are disambiguated by index and never silently take the first rule', () => {
    const sarif = document([{ ruleId: 'js/example', ruleIndex: 1, level: 'warning' }]);
    sarif.runs[0].tool.driver.rules = [low(), high()];
    assert.deepEqual(securityFailures(sarif), ['js/example']);
    delete sarif.runs[0].results[0].ruleIndex;
    assert.throws(() => securityFailures(sarif));
});

test('legacy driver references and explicit hierarchical rule IDs retain metadata severity', () => {
    const sarif = document([{ ruleId: 'js/example', level: 'warning' }]);
    sarif.runs[0].tool.driver.rules = [high()];
    assert.deepEqual(securityFailures(sarif), ['js/example']);
    sarif.runs[0].results = [{ ruleId: 'js/example/subtype', ruleIndex: 0, level: 'warning' }];
    assert.deepEqual(securityFailures(sarif), ['js/example']);
});

test('inconsistent descriptor and component references block rather than falling back', () => {
    const changes = [
        result => { result.rule.id = 'js/other'; },
        result => { result.rule.index = 1; },
        result => { result.ruleIndex = '0'; },
        result => { result.rule.index = -1; result.ruleIndex = -1; },
        result => { result.rule.guid = packGuid; },
        result => { result.rule.toolComponent.index = 1; },
        result => { result.rule.toolComponent.index = '0'; },
        result => { result.rule.toolComponent.guid = ruleGuid; },
        result => { result.rule.toolComponent.name = 'wrong-pack'; },
        result => { result.rule.toolComponent = { name: 'codeql/javascript-queries' }; },
        result => { delete result.rule; },
        result => { result.ruleId = 'js/example/subtype/extra'; result.rule.id = result.ruleId; }
    ];
    for (const change of changes) {
        const result = reference(); change(result);
        assert.throws(() => securityFailures(document([result])));
    }
});

test('GUID ambiguity and unknown severity, level, kind or invocation metadata block', () => {
    const fixtures = [];
    const duplicateComponent = document([{ rule: { guid: ruleGuid, toolComponent: { guid: packGuid } } }]);
    duplicateComponent.runs[0].tool.extensions.push(structuredClone(duplicateComponent.runs[0].tool.extensions[0]));
    fixtures.push(duplicateComponent);
    const duplicateRule = document([{ rule: { guid: ruleGuid, toolComponent: { index: 0 } } }]);
    duplicateRule.runs[0].tool.extensions[0].rules.push(high()); fixtures.push(duplicateRule);
    for (const fixture of [duplicateComponent, duplicateRule]) {
        const indexed = structuredClone(fixture);
        indexed.runs[0].results[0].rule.index = 0;
        indexed.runs[0].results[0].rule.toolComponent.index = 0;
        fixtures.push(indexed);
    }
    for (const mutate of [
        run => { run.tool.extensions = {}; },
        run => { run.tool.extensions[0].rules[0].properties['security-severity'] = 'NaN'; },
        run => { run.tool.extensions[0].rules[0].defaultConfiguration = { level: 'bogus' }; },
        run => { run.results[0].level = 'bogus'; },
        run => { run.results[0].kind = 'bogus'; },
        run => { run.results[0].kind = 'pass'; },
        run => { run.results = null; },
        run => { run.invocations = {}; },
        run => { run.invocations[0].executionSuccessful = false; },
        run => { run.invocations[0].executionSuccessful = 'true'; },
        run => { run.invocations[0].toolExecutionNotifications = [{ level: 'error' }]; }
    ]) { const sarif = document([reference()]); mutate(sarif.runs[0]); fixtures.push(sarif); }
    for (const fixture of fixtures) assert.throws(() => securityFailures(fixture));
});

test('extension critical, explicit/default error and suppressed high findings still block', () => {
    for (const mutate of [
        run => { run.tool.extensions[0].rules[0].properties['security-severity'] = '10.0'; },
        run => { run.tool.extensions[0].rules[0].properties = {}; run.results[0].level = 'error'; },
        run => { run.tool.extensions[0].rules[0].properties = {}; run.tool.extensions[0].rules[0].defaultConfiguration = { level: 'error' }; },
        run => { run.results[0].suppressions = [{ kind: 'inSource', status: 'accepted' }]; }
    ]) {
        const sarif = document([reference()]); mutate(sarif.runs[0]);
        assert.deepEqual(securityFailures(sarif), ['js/example']);
    }
    const sarif = document([{ ...reference(), kind: 'pass', level: 'none' }]);
    assert.deepEqual(securityFailures(sarif), []);
});

test('a clean run cannot hide a high finding or failed invocation in another run', () => {
    const sarif = document(); sarif.runs.push(document([reference()]).runs[0]);
    assert.deepEqual(securityFailures(sarif), ['js/example']);
    sarif.runs[1].invocations[0].executionSuccessful = false;
    assert.throws(() => securityFailures(sarif));
});

test('actual CLI accepts pack output and blocks high, invalid and missing reports with safe diagnostics', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codeql-contract-'));
    const file = path.join(directory, 'javascript.sarif');
    const command = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/check-codeql.js'), directory], { encoding: 'utf8' });
    const sentinel = 'SYNTHETIC_PRIVATE_SOURCE_SENTINEL';
    try {
        fs.writeFileSync(file, JSON.stringify(document()));
        assert.equal(command().status, 0);
        fs.writeFileSync(file, JSON.stringify(document([reference()])));
        assert.equal(command().status, 1);
        const malformed = document([reference()]);
        malformed.runs[0].results[0].message = { text: sentinel };
        malformed.runs[0].tool.extensions[0].rules = [];
        fs.writeFileSync(file, JSON.stringify(malformed));
        const failed = command();
        assert.equal(failed.status, 1);
        assert.match(failed.stderr, /NO_RULE_METADATA/);
        assert.match(failed.stderr, /driver_rules/);
        assert.equal((failed.stdout + failed.stderr).includes(sentinel), false);
        fs.writeFileSync(file, '{"secret":"' + sentinel + '" BROKEN');
        const invalidJson = command();
        assert.equal(invalidJson.status, 1);
        assert.equal((invalidJson.stdout + invalidJson.stderr).includes(sentinel), false);
        fs.unlinkSync(file);
        assert.equal(command().status, 1);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
