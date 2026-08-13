'use strict';

const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const dbConfig = require('../config/db');
const { setInstallationState } = require('../database/installationState');

function hashSetupToken(token) {
    return crypto
        .createHash('sha256')
        .update(String(token || ''), 'utf8')
        .digest('hex');
}

function setupTokenMatches(providedToken, expectedHash) {
    const providedHash = Buffer.from(hashSetupToken(providedToken), 'hex');
    const expectedHashBuffer = Buffer.from(String(expectedHash || ''), 'hex');

    return expectedHashBuffer.length === 32 &&
        providedHash.length === expectedHashBuffer.length &&
        crypto.timingSafeEqual(providedHash, expectedHashBuffer);
}

function createSetupError(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function validateAdminInput(input) {
    const firstName = String(input.firstName || '').trim();
    const lastName = String(input.lastName || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const setupToken = String(input.setupToken || '');

    if (!firstName || !lastName || !email || !password || !setupToken) {
        throw createSetupError('Bitte alle Pflichtfelder ausfüllen.', 400, 'INVALID_INPUT');
    }

    if (firstName.length > 100 || lastName.length > 100 || email.length > 254) {
        throw createSetupError('Eine Eingabe ist zu lang.', 400, 'INVALID_INPUT');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw createSetupError('Bitte eine gültige E-Mail-Adresse eingeben.', 400, 'INVALID_EMAIL');
    }

    const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,128}$/;

    if (!passwordPolicy.test(password)) {
        throw createSetupError(
            'Das Adminpasswort muss 12 bis 128 Zeichen sowie Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen enthalten.',
            400,
            'INVALID_PASSWORD'
        );
    }

    if (setupToken.length > 512) {
        throw createSetupError('Der Einrichtungs-Code ist ungültig.', 400, 'INVALID_SETUP_TOKEN');
    }

    return {
        email,
        firstName,
        lastName,
        password,
        setupToken
    };
}

async function getSetupStatus() {
    const connection = await mysql.createConnection(dbConfig);

    try {
        const [rows] = await connection.execute(
            `SELECT installation.status, EXISTS(
                SELECT 1 FROM users WHERE role = 'global_admin'
             ) AS adminExists
             FROM app_installation installation
             WHERE installation.id = 1
             LIMIT 1`
        );

        if (rows.length === 0) {
            throw new Error('Der Installationsstatus fehlt.');
        }

        const status = rows[0].status;
        const adminExists = Number(rows[0].adminExists) === 1;

        if (status === 'setup_required' && adminExists) {
            await connection.execute(
                `UPDATE app_installation
                 SET status = 'ready',
                     setup_token_hash = NULL,
                     setup_token_created_at = NULL,
                     initialized_at = COALESCE(initialized_at, NOW())
                 WHERE id = 1`
            );
            setInstallationState('ready');
            return 'ready';
        }

        if (status === 'ready' && !adminExists) {
            throw new Error(
                'Die Installation ist als abgeschlossen markiert, enthält aber kein globales Adminkonto.'
            );
        }

        setInstallationState(status);
        return status;
    } finally {
        await connection.end();
    }
}

async function createInitialAdmin(input) {
    const admin = validateAdminInput(input);
    const connection = await mysql.createConnection(dbConfig);

    try {
        await connection.beginTransaction();

        const [installationRows] = await connection.execute(
            `SELECT status, setup_token_hash
             FROM app_installation
             WHERE id = 1
             FOR UPDATE`
        );

        const installation = installationRows[0];

        if (!installation || installation.status !== 'setup_required') {
            throw createSetupError(
                'Die Ersteinrichtung wurde bereits abgeschlossen.',
                409,
                'SETUP_ALREADY_COMPLETED'
            );
        }

        if (!setupTokenMatches(admin.setupToken, installation.setup_token_hash)) {
            throw createSetupError(
                'Der Einrichtungs-Code ist ungültig.',
                403,
                'INVALID_SETUP_TOKEN'
            );
        }

        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE username = ? LIMIT 1',
            [admin.email]
        );

        if (existingUsers.length > 0) {
            throw createSetupError(
                'Für diese E-Mail-Adresse existiert bereits ein Konto.',
                409,
                'USER_ALREADY_EXISTS'
            );
        }

        const passwordHash = await bcrypt.hash(admin.password, 12);

        await connection.execute(
            `INSERT INTO users
             (username, password, role, first_name, last_name, email_verified)
             VALUES (?, ?, 'global_admin', ?, ?, 1)`,
            [admin.email, passwordHash, admin.firstName, admin.lastName]
        );

        await connection.execute(
            `UPDATE app_installation
             SET status = 'ready',
                 setup_token_hash = NULL,
                 setup_token_created_at = NULL,
                 initialized_at = NOW()
             WHERE id = 1`
        );

        await connection.commit();
        setInstallationState('ready');

        return {
            email: admin.email,
            role: 'global_admin'
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

module.exports = {
    createInitialAdmin,
    getSetupStatus,
    hashSetupToken,
    setupTokenMatches,
    validateAdminInput
};
