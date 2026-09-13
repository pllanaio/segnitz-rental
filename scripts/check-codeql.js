'use strict';
const fs = require('node:fs');
const path = require('node:path');

function securityFailures(sarif) {
    if (sarif.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) throw new Error('Incomplete CodeQL SARIF');
    return sarif.runs.flatMap(run => {
        const rules = run.tool?.driver?.rules;
        if (run.tool?.driver?.name !== 'CodeQL' || !Array.isArray(rules) || !rules.length || !Array.isArray(run.results) ||
            run.invocations?.some(invocation => invocation.executionSuccessful === false)) throw new Error('Incomplete or failed CodeQL run');
        for (const rule of rules) {
            const severity = rule.properties?.['security-severity'];
            if (typeof rule.id !== 'string' || !rule.id || (severity !== undefined &&
                (!/^(?:[0-9](?:\.[0-9]+)?|10(?:\.0+)?)$/.test(String(severity))))) throw new Error('Invalid CodeQL rule metadata');
        }
        return run.results.filter(result => {
            const rule = typeof result.ruleId === 'string' ? rules.find(candidate => candidate.id === result.ruleId) : rules[result.ruleIndex];
            if (!rule || (result.level !== undefined && !['none', 'note', 'warning', 'error'].includes(result.level))) throw new Error('Unknown CodeQL result rule or level');
            if (result.kind === 'pass' || result.kind === 'notApplicable') return false;
            const severity = Number(rule.properties?.['security-severity'] || 0);
            return severity >= 7 || result.level === 'error' || rule.defaultConfiguration?.level === 'error';
        }).map(result => result.ruleId || rules[result.ruleIndex].id);
    });
}

if (require.main === module) {
    const directory = process.argv[2];
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.sarif'));
    if (!files.length) throw new Error('CodeQL emitted no SARIF: release blocked');
    const failures = files.flatMap(file => securityFailures(JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))));
    console.log(JSON.stringify({ codeql_files: files.length, blocking_findings: failures.length, rules: [...new Set(failures)] }));
    if (failures.length) process.exitCode = 1;
}
module.exports = { securityFailures };
