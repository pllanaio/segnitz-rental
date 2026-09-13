'use strict';
const { isIP } = require('node:net');
const { isProduction } = require('./security');

function parseTrustProxy(environment = process.env) {
    const raw = environment.TRUST_PROXY;
    if (raw === undefined || raw === '') {
        if (isProduction(environment)) throw new Error('TRUST_PROXY muss die geprüfte Proxy-Topologie ausdrücklich festlegen.');
        return false;
    }
    if (raw === '0' || raw === 'false') return false;
    // Hop counts are supported only as an explicit deployment choice. Operators
    // must verify every ingress has this same length; CIDRs are preferable.
    if (/^[1-8]$/u.test(raw)) return Number(raw);
    const ranges = raw.split(',').map(value => value.trim());
    for (const range of ranges) {
        if (['loopback', 'linklocal', 'uniquelocal'].includes(range)) continue;
        const [address, prefix, extra] = range.split('/');
        const version = isIP(address);
        if (!version || extra !== undefined || (prefix !== undefined &&
            (!/^\d{1,3}$/u.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
            throw new Error('TRUST_PROXY benötigt explizite IP/CIDR-Bereiche, bekannte lokale Bereiche oder 0 bis 8 Hops.');
        }
    }
    return ranges;
}

module.exports = { parseTrustProxy };
