'use strict';

function missingMailConfiguration() {
    return ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'GRAPH_MAIL_USER']
        .filter(name => !String(process.env[name] || '').trim());
}

function mailMustWaitForConfiguration() {
    return process.env.DISABLE_EMAILS !== '1' && missingMailConfiguration().length > 0;
}

module.exports = { missingMailConfiguration, mailMustWaitForConfiguration };
