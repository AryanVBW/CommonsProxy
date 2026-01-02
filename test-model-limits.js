
import AccountManager from './src/account-manager.js';
import { logger } from './src/utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

// Disable logging for test cleanly
logger.info = () => {};
logger.warn = () => {};
logger.error = console.error;
logger.success = () => {};

const TEST_CONFIG_PATH = path.resolve('./test-accounts-config.json');

async function runTest() {
    console.log('Starting Model-Specific Rate Limit Test...');

    // 1. Setup Test Config
    const testConfig = {
        accounts: [
            { email: 'acc1@test.com', source: 'manual', apiKey: 'key1' },
            { email: 'acc2@test.com', source: 'manual', apiKey: 'key2' }
        ],
        settings: { cooldownDurationMs: 1000 }
    };
    await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(testConfig, null, 2));

    // 2. Initialize Manager
    const manager = new AccountManager(TEST_CONFIG_PATH);
    await manager.initialize();
    console.log(`Initialized with ${manager.getAccountCount()} accounts.`);

    // 3. Mark acc1 rate limited for "Claude-3.5-Sonnet"
    console.log('\n--- Testing Model Rate Limit ---');
    const modelA = 'claude-3-5-sonnet-20241022';
    const modelB = 'claude-3-opus-20240229';

    manager.markRateLimited('acc1@test.com', 5000, modelA);
    console.log(`Marked acc1 rate restricted for ${modelA}`);

    // Verify acc1 status
    const acc1 = manager.getAllAccounts().find(a => a.email === 'acc1@test.com');
    
    // Check global limit (should be false)
    if (manager.isRateLimited(acc1, null)) {
        console.error('FAIL: acc1 should NOT be globally rate limited');
    } else {
        console.log('PASS: acc1 is not globally rate limited');
    }

    // Check Model A limit (should be true)
    if (manager.isRateLimited(acc1, modelA)) {
        console.log(`PASS: acc1 is rate limited for ${modelA}`);
    } else {
        console.error(`FAIL: acc1 SHOULD be rate limited for ${modelA}`);
    }

    // Check Model B limit (should be false)
    if (manager.isRateLimited(acc1, modelB)) {
        console.error(`FAIL: acc1 should NOT be rate limited for ${modelB}`);
    } else {
        console.log(`PASS: acc1 is not rate limited for ${modelB}`);
    }

    // 4. Test Selection
    console.log('\n--- Testing Account Selection ---');
    
    // Pick for Model A (Acc1 blocked -> should pick Acc2)
    // First, force current index to 0 (acc1)
    // We can't easily force index private field, but we can call pickNext repeatedly
    // Since we just initialized, index is 0.
    
    // Sticky account check for Model A
    const stickyA = manager.getCurrentStickyAccount(modelA);
    if (stickyA && stickyA.email === 'acc1@test.com') {
         console.error('FAIL: getCurrentStickyAccount returned rate-limited acc1 for Model A');
    } else {
         console.log('PASS: getCurrentStickyAccount skipped acc1 for Model A');
    }

    // Pick Next for Model A
    const nextA = manager.pickNext(modelA);
    if (nextA.email === 'acc2@test.com') {
        console.log('PASS: pickNext picked acc2 for Model A');
    } else {
        console.error(`FAIL: pickNext picked ${nextA.email} for Model A (expected acc2)`);
    }

    // Pick for Model B (Acc1 available -> should pick Acc1 if it was sticky, or just be available)
    // Current index has moved to acc2 due to pickNext above.
    // Let's reset or just check availability.
    
    const availableB = manager.getAvailableAccounts(modelB);
    if (availableB.find(a => a.email === 'acc1@test.com')) {
        console.log('PASS: acc1 is available for Model B');
    } else {
        console.error('FAIL: acc1 missing from available accounts for Model B');
    }

    // 5. Test Global Limit
    console.log('\n--- Testing Global Rate Limit ---');
    manager.markRateLimited('acc2@test.com', 5000); // Global limit
    console.log('Marked acc2 globally rate restricted');

    const acc2 = manager.getAllAccounts().find(a => a.email === 'acc2@test.com');
    if (manager.isRateLimited(acc2, modelA) && manager.isRateLimited(acc2, modelB)) {
        console.log('PASS: Globally limited account is limited for all models');
    } else {
        console.error('FAIL: Globally limited account is NOT limited for some models');
    }

    // Cleanup
    await fs.unlink(TEST_CONFIG_PATH);
    console.log('\nTest Completed.');
}

runTest().catch(console.error);
