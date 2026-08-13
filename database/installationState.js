'use strict';

const VALID_INSTALLATION_STATES = new Set([
    'starting',
    'setup_required',
    'ready'
]);

let installationState = 'starting';

function setInstallationState(nextState) {
    if (!VALID_INSTALLATION_STATES.has(nextState)) {
        throw new Error(`Ungültiger Installationsstatus: ${nextState}`);
    }

    installationState = nextState;
}

function getInstallationState() {
    return installationState;
}

function isSetupRequired() {
    return installationState === 'setup_required';
}

module.exports = {
    getInstallationState,
    isSetupRequired,
    setInstallationState
};
