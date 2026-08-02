'use strict';

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
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ],
    webServer: {
        command: 'npm start',
        url: `${baseURL}/auth-status`,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            DISABLE_PERIODIC_CLEANUP: '1',
            MOLLIE_API_KEY: process.env.MOLLIE_API_KEY || testMollieApiKey
        }
    }
});
