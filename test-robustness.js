
import AccountManager from './src/account-manager.js';
import { logger } from './src/utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

// Mock logger
logger.info = () => {};
logger.warn = console.log;
logger.error = console.error;
logger.success = () => {};

// Mock isNetworkError if needed, but we imported the real one in implementation
// mocking refreshAccessToken via simple override if possible, or we rely on the fact 
// that we can't easily mock imports in ESM without a loader. 
// Instead, we'll subclass AccountManager to override getTokenForAccount behavior partially? 
// No, simpler to just mock the error thrown by refreshAccessToken if we could.
// But since we can't mock module exports easily in this setup, let's just inspect the logic validity 
// by reading the file or trusting the unit test if we can construct one that throws the right error.

// We will simulate the error by overriding the method on the instance temporarily.

const TEST_CONFIG_PATH = path.resolve('./test-robustness-config.json');

async function runTest() {
    console.log('Starting Robustness Test...');

    const testConfig = {
        accounts: [
            { email: 'test@robustness.com', source: 'oauth', refreshToken: 'dummy', isInvalid: false }
        ],
        settings: { cooldownDurationMs: 1000 }
    };
    await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(testConfig, null, 2));

    const manager = new AccountManager(TEST_CONFIG_PATH);
    await manager.initialize();

    // Mock refreshAccessToken behavior by monkey-patching the internal flow? 
    // Actually, AccountManager calls `refreshAccessToken` from `oauth.js`.
    // We can't mock that easily. 
    // However, we CAN verify that valid accounts are NOT marked invalid if we somehow trigger the network error path.
    // Let's create a derived class to inject the failure?
    
    // Actually, the `isNetworkError` check happens inside `getTokenForAccount`.
    // We can verify `getTokenForAccount` logic by overriding `refreshAccessToken` IF it was a method of class.
    // It's an import. 
    
    // Instead, let's verify `cloudcode-client` logic.
    // We can mock `fetch` globally?
    global.fetch = async () => {
        throw new Error('fetch failed');
    };
    
    // Import sendMessage from cloudcode-client
    const { sendMessage } = await import('./src/cloudcode-client.js');
    
    // We expect sendMessage to catch 'fetch failed', log a warning, and try next account
    // It should NOT throw "fetched failed" immediately up.
    // It should eventually throw "No accounts available" or "Max retries" if all fail.
    
    console.log('Testing sendMessage with simulated network failure...');
    try {
        await sendMessage({ model: 'claude-3-opus-20240229', messages: [] }, manager);
    } catch (e) {
        console.log(`Caught expected error: ${e.message}`);
        if (e.message.includes('No accounts available') || e.message.includes('Max retries')) {
             console.log('PASS: sendMessage handled network error appropriately (retried until exhaustion)');
        } else {
             console.error('FAIL: sendMessage threw unexpected error');
        }
    }
    
    // Cleanup
    await fs.unlink(TEST_CONFIG_PATH);
    console.log('Test Completed.');
}

runTest().catch(console.error);
