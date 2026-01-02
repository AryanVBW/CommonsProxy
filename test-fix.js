
import AccountManager from './src/account-manager.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runTest() {
    console.log('Starting verification test...');
    
    const TEST_CONFIG = join(__dirname, 'test-accounts.json');
    
    // Create test config: 1 invalid (not rate-limited), 1 rate-limited (valid)
    // This matches the user's scenario where "isAllRateLimited" was returning false
    // because it saw the invalid account as "not rate limited".
    const config = {
        accounts: [
            { 
                email: 'invalid@example.com', 
                isInvalid: true, 
                isRateLimited: false // Important: invalid accounts usually have this as false or stale
            },
            { 
                email: 'limited@example.com', 
                isInvalid: false, 
                isRateLimited: true,
                rateLimitResetTime: Date.now() + 100000 
            }
        ],
        settings: {},
        activeIndex: 0
    };
    
    fs.writeFileSync(TEST_CONFIG, JSON.stringify(config));
    console.log('Created test config:', TEST_CONFIG);

    try {
        const am = new AccountManager(TEST_CONFIG);
        await am.initialize();

        console.log('AccountManager initialized.');
        
        const result = am.isAllRateLimited();
        console.log(`isAllRateLimited() returned: ${result}`);

        if (result === true) {
            console.log('✅ PASS: Logic correctly identifies that we are effectively rate limited (invalid ignored).');
        } else {
            console.log('❌ FAIL: Logic returned false. It thinks we have available accounts.');
        }

    } catch (err) {
        console.error('Error during test:', err);
    } finally {
        if (fs.existsSync(TEST_CONFIG)) {
            fs.unlinkSync(TEST_CONFIG);
            console.log('Cleaned up test config.');
        }
    }
}

runTest();
