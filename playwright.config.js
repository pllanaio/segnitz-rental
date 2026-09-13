'use strict';

const TEST_LEGAL_ENV = require('./test/support/legal-fixture');
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
        url: `${baseURL}/auth-status`,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            MOLLIE_TEST_MODE: '1',
            MAIL_DELIVERY_PAUSED: '1',
            DISABLE_EMAILS: '1',
            ...TEST_LEGAL_ENV,
            DISABLE_PERIODIC_CLEANUP: '1',
            MOLLIE_API_KEY: process.env.MOLLIE_API_KEY || testMollieApiKey
        }
    }
});
