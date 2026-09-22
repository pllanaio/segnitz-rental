'use strict';

function isMailDeliveryPaused(environment = process.env) {
    return environment.MAIL_DELIVERY_PAUSED === '1' || environment.DISABLE_EMAILS === '1';
}

function assertMailDeliveryAvailable(environment = process.env) {
    if (isMailDeliveryPaused(environment)) {
        const error = new Error('E-Mail-Versand ist pausiert; der Versandauftrag bleibt vorgemerkt.');
        error.code = 'MAIL_DELIVERY_PAUSED';
        throw error;
    }
}

module.exports = { assertMailDeliveryAvailable, isMailDeliveryPaused };
