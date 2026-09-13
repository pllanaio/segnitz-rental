'use strict';
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = new Set(['none', 'note', 'warning', 'error']);
const KINDS = new Set(['notApplicable', 'pass', 'fail', 'review', 'open', 'informational']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const index = value => Number.isSafeInteger(value) && value >= 0;
const guid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const sameGuid = (left, right) => guid(left) && guid(right) && left.toLowerCase() === right.toLowerCase();
function requireContract(condition, code) {
    if (!condition) {
        const error = new Error(`CodeQL gate blocked: ${code}`);
        error.gateCode = code;
        throw error;
    }
}

function validateComponent(component) {
    requireContract(object(component) && nonempty(component.name), 'INVALID_COMPONENT');
    requireContract(component.guid === undefined || guid(component.guid), 'INVALID_COMPONENT_GUID');
    requireContract(component.rules === undefined || Array.isArray(component.rules), 'INVALID_RULES');
    for (const rule of component.rules || []) {
        requireContract(object(rule) && nonempty(rule.id), 'INVALID_RULE_METADATA');
        requireContract(rule.guid === undefined || guid(rule.guid), 'INVALID_RULE_GUID');
        requireContract(rule.properties === undefined || object(rule.properties), 'INVALID_RULE_PROPERTIES');
        const severity = rule.properties?.['security-severity'];
        requireContract(severity === undefined || ((typeof severity === 'string' || typeof severity === 'number') &&
            /^(?:[0-9](?:\.[0-9]+)?|10(?:\.0+)?)$/.test(String(severity))), 'INVALID_SECURITY_SEVERITY');
        requireContract(rule.defaultConfiguration === undefined || (object(rule.defaultConfiguration) &&
            (rule.defaultConfiguration.level === undefined || LEVELS.has(rule.defaultConfiguration.level))), 'INVALID_RULE_LEVEL');
    }
}

// SARIF 2.1.0 §§3.52/3.54: indices are local to a component. Neither a rule ID
// nor a component name permits a global first-match search across query packs.
function resolveComponent(tool, reference) {
    if (reference === undefined) return tool.driver;
    requireContract(object(reference), 'INVALID_COMPONENT_REFERENCE');
    requireContract(reference.index === undefined || index(reference.index), 'INVALID_COMPONENT_INDEX');
    requireContract(reference.guid === undefined || guid(reference.guid), 'INVALID_COMPONENT_GUID');
    requireContract(reference.name === undefined || nonempty(reference.name), 'INVALID_COMPONENT_NAME');
    let component = tool.driver;
    if (reference.index !== undefined) component = tool.extensions?.[reference.index];
    else if (reference.guid !== undefined) {
        const matches = [tool.driver, ...(tool.extensions || [])].filter(candidate => sameGuid(candidate.guid, reference.guid));
        requireContract(matches.length === 1, 'UNKNOWN_OR_AMBIGUOUS_COMPONENT');
        component = matches[0];
    }
    requireContract(component !== undefined, 'UNKNOWN_COMPONENT');
    requireContract(reference.guid === undefined || sameGuid(component.guid, reference.guid), 'COMPONENT_GUID_MISMATCH');
    requireContract(reference.guid === undefined || [tool.driver, ...(tool.extensions || [])]
        .filter(candidate => sameGuid(candidate.guid, reference.guid)).length === 1, 'UNKNOWN_OR_AMBIGUOUS_COMPONENT');
    requireContract(reference.name === undefined || component.name === reference.name, 'COMPONENT_NAME_MISMATCH');
    return component;
}

function resolveRule(tool, result) {
    requireContract(object(result), 'INVALID_RESULT');
    requireContract(result.rule === undefined || object(result.rule), 'INVALID_RULE_REFERENCE');
    const reference = result.rule || {};
    for (const value of [result.ruleId, reference.id]) requireContract(value === undefined || nonempty(value), 'INVALID_RULE_ID');
    for (const value of [result.ruleIndex, reference.index]) requireContract(value === undefined || index(value), 'INVALID_RULE_INDEX');
    requireContract(reference.guid === undefined || guid(reference.guid), 'INVALID_RULE_GUID');
    requireContract(result.ruleId === undefined || reference.id === undefined || result.ruleId === reference.id, 'RULE_ID_MISMATCH');
    requireContract(result.ruleIndex === undefined || reference.index === undefined || result.ruleIndex === reference.index, 'RULE_INDEX_MISMATCH');
    const rules = resolveComponent(tool, reference.toolComponent).rules || [];
    const ruleIndex = reference.index ?? result.ruleIndex;
    const ruleId = reference.id ?? result.ruleId;
    let rule;
    if (ruleIndex !== undefined) rule = rules[ruleIndex];
    else if (reference.guid !== undefined) {
        const matches = rules.filter(candidate => sameGuid(candidate.guid, reference.guid));
        requireContract(matches.length === 1, 'UNKNOWN_OR_AMBIGUOUS_RULE');
        rule = matches[0];
    } else {
        // Retain the older GitHub-supported ID-only driver format, but only if
        // metadata is unique within the selected component. Never guess a pack.
        const matches = rules.filter(candidate => candidate.id === ruleId);
        requireContract(matches.length === 1, 'UNKNOWN_OR_AMBIGUOUS_RULE');
        rule = matches[0];
    }
    requireContract(rule !== undefined, 'UNKNOWN_RULE');
    requireContract(reference.guid === undefined || sameGuid(rule.guid, reference.guid), 'RULE_GUID_MISMATCH');
    requireContract(reference.guid === undefined || rules.filter(candidate => sameGuid(candidate.guid, reference.guid)).length === 1, 'UNKNOWN_OR_AMBIGUOUS_RULE');
    // A SARIF result ID may append one subtype component to the descriptor ID.
    const subtype = ruleId?.startsWith(`${rule.id}/`) ? ruleId.slice(rule.id.length + 1) : '';
    requireContract(ruleId === undefined || ruleId === rule.id || (subtype.length > 0 && !subtype.includes('/')), 'RULE_METADATA_ID_MISMATCH');
    return rule;
}

function validateInvocations(run) {
    requireContract(run.invocations === undefined || Array.isArray(run.invocations), 'INVALID_INVOCATIONS');
    for (const invocation of run.invocations || []) {
        requireContract(object(invocation) && invocation.executionSuccessful === true, 'FAILED_OR_INCOMPLETE_INVOCATION');
        for (const key of ['toolExecutionNotifications', 'toolConfigurationNotifications']) {
            requireContract(invocation[key] === undefined || Array.isArray(invocation[key]), 'INVALID_NOTIFICATIONS');
            for (const notification of invocation[key] || []) {
                requireContract(object(notification) && (notification.level === undefined || LEVELS.has(notification.level)), 'INVALID_NOTIFICATION');
                requireContract(notification.level !== 'error', 'ERROR_NOTIFICATION');
            }
        }
    }
}

function securityFailures(sarif) {
    requireContract(object(sarif) && sarif.version === '2.1.0' && Array.isArray(sarif.runs) && sarif.runs.length > 0, 'INCOMPLETE_SARIF');
    return sarif.runs.flatMap((run, runIndex) => {
        try {
            requireContract(object(run) && run.tool?.driver?.name === 'CodeQL' && Array.isArray(run.results), 'INCOMPLETE_RUN');
            requireContract(run.tool.extensions === undefined || Array.isArray(run.tool.extensions), 'INVALID_EXTENSIONS');
            const components = [run.tool.driver, ...(run.tool.extensions || [])];
            components.forEach(validateComponent);
            requireContract(components.some(component => component.rules?.length > 0), 'NO_RULE_METADATA');
            validateInvocations(run);
            return run.results.flatMap((result, resultIndex) => {
                try {
                    const rule = resolveRule(run.tool, result);
                    requireContract(result.level === undefined || LEVELS.has(result.level), 'INVALID_RESULT_LEVEL');
                    requireContract(result.kind === undefined || KINDS.has(result.kind), 'INVALID_RESULT_KIND');
                    requireContract(result.kind === undefined || result.kind === 'fail' || result.level === undefined || result.level === 'none', 'KIND_LEVEL_MISMATCH');
                    if (result.kind === 'pass' || result.kind === 'notApplicable') return [];
                    const severity = Number(rule.properties?.['security-severity'] || 0);
                    // Preserve the existing gate: high security severity or any
                    // explicit/default error blocks, including suppressed results.
                    return severity >= 7 || result.level === 'error' || rule.defaultConfiguration?.level === 'error' ? [rule.id] : [];
                } catch (error) { error.resultIndex = resultIndex; throw error; }
            });
        } catch (error) { error.runIndex = runIndex; throw error; }
    });
}

// Structural counts only: no arbitrary object keys, source, paths, messages,
// command lines, environment values or raw JSON parse errors reach CI logs.
function summarizeSarif(sarif) {
    return { sarif_2_1_0: sarif?.version === '2.1.0', runs: Array.isArray(sarif?.runs) ? sarif.runs.map(run => ({
        codeql_driver: run?.tool?.driver?.name === 'CodeQL',
        driver_rules: Array.isArray(run?.tool?.driver?.rules) ? run.tool.driver.rules.length : null,
        extension_rules: Array.isArray(run?.tool?.extensions) ? run.tool.extensions.map(component => Array.isArray(component?.rules) ? component.rules.length : null) : null,
        results: Array.isArray(run?.results) ? run.results.length : null,
        invocations: Array.isArray(run?.invocations) ? run.invocations.length : null
    })) : null };
}

function main(directory) {
    let sarif;
    let fileIndex;
    try {
        const files = fs.readdirSync(directory).filter(name => name.endsWith('.sarif')).sort();
        requireContract(files.length > 0, 'NO_SARIF_FILES');
        let failures = 0;
        for (fileIndex = 0; fileIndex < files.length; fileIndex++) {
            sarif = undefined;
            const contents = fs.readFileSync(path.join(directory, files[fileIndex]), 'utf8');
            try { sarif = JSON.parse(contents); } catch { requireContract(false, 'INVALID_JSON'); }
            failures += securityFailures(sarif).length;
            console.log(JSON.stringify({ codeql_file_index: fileIndex, ...summarizeSarif(sarif) }));
            // Static repository coordinates only; never emit source snippets,
            // result messages, environment or dataflow values from SARIF.
            const findings = sarif.runs.flatMap(run => run.results.flatMap(result => {
                const rule = resolveRule(run.tool, result);
                if (result.kind === 'pass' || result.kind === 'notApplicable') return [];
                const severity = Number(rule.properties?.['security-severity'] || 0);
                if (severity < 7 && result.level !== 'error' && rule.defaultConfiguration?.level !== 'error') return [];
                const location = result.locations?.[0]?.physicalLocation;
                const uri = location?.artifactLocation?.uri;
                return [{ rule: /^[A-Za-z0-9_/-]{1,200}$/.test(rule.id) ? rule.id : 'unavailable',
                    path: typeof uri === 'string' && /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./-]{1,300}$/.test(uri) ? uri : 'unavailable',
                    line: Number.isSafeInteger(location?.region?.startLine) ? location.region.startLine : null,
                    severity, level: result.level || rule.defaultConfiguration?.level || 'warning' }];
            }));
            console.log(JSON.stringify({ codeql_blocking_locations: findings.slice(0, 1000), truncated: findings.length > 1000 }));
        }
        console.log(JSON.stringify({ codeql_files: files.length, blocking_findings: failures }));
        return failures ? 1 : 0;
    } catch (error) {
        console.error(JSON.stringify({ codeql_gate_error: error.gateCode || 'SARIF_READ_FAILED', file_index: fileIndex,
            run_index: error.runIndex, result_index: error.resultIndex, ...summarizeSarif(sarif) }));
        return 1;
    }
}

if (require.main === module) process.exitCode = main(process.argv[2]);
module.exports = { securityFailures };
