'use strict';

const TEST_LEGAL_ENV = require('./test/support/legal-fixture');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.env.MOLLIE_TEST_FIXTURES_DIR) process.env.MOLLIE_TEST_FIXTURES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'segnitz-e2e-provider-'));
fs.mkdirSync(process.env.MOLLIE_TEST_FIXTURES_DIR, { recursive: true });
const { defineConfig, devices } = require('@playwright/test');

const port = Number(process.env.E2E_PORT || 3102);
const baseURL = `http://127.0.0.1:${port}`;
const testMollieApiKey = 'test_abcdefghijklmnopqrstuvwxyz1234';

module.exports = defineConfig({
    testDir: './test/e2e',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
        ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
        : 'list',
    use: {
        baseURL,
        actionTimeout: 15000,
        navigationTimeout: 30000,
        trace: 'off',
        screenshot: 'off',
        video: 'off',
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: process.env.PLAYWRIGHT_LOCAL_SINGLE_PROCESS === '1' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-zygote', '--single-process'] : [] } } : {})
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ],
    webServer: {
        command: 'npm start',
        stdout: 'pipe',
        stderr: 'pipe',
        url: `${baseURL}/auth-status`,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        env: {
            ...process.env,
            PORT: String(port),
            BASE_URL: baseURL,
            NODE_ENV: 'test',
            TRUST_PROXY: '127.0.0.1/32,::1/128',
            MOLLIE_TEST_MODE: '1',
            MAIL_DELIVERY_PAUSED: '1',
            DISABLE_EMAILS: '1',
            ...TEST_LEGAL_ENV,
            DISABLE_PERIODIC_CLEANUP: '1',
            MOLLIE_API_KEY: process.env.MOLLIE_API_KEY || testMollieApiKey
        }
    }
});
