#!/usr/bin/env node

/**
 * Account Management CLI
 *
 * Interactive CLI for adding and managing accounts
 * for CommonsProxy. Supports multiple providers.
 *
 * Usage:
 *   node src/cli/accounts.js          # Interactive mode
 *   node src/cli/accounts.js add      # Add new account(s)
 *   node src/cli/accounts.js add --provider=copilot  # Add Copilot account
 *   node src/cli/accounts.js list     # List all accounts
 *   node src/cli/accounts.js clear    # Remove all accounts
 */

import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { spawn } from 'child_process';
import net from 'net';
import { ACCOUNT_CONFIG_PATH, DEFAULT_PORT, MAX_ACCOUNTS } from '../constants.js';
import {
    getAuthorizationUrl,
    startCallbackServer,
    completeOAuthFlow,
    refreshAccessToken,
    getUserEmail,
    extractCodeFromInput
} from '../auth/oauth.js';

const SERVER_PORT = process.env.PORT || DEFAULT_PORT;

/**
 * Check if the Antigravity Proxy server is running
 * Returns true if port is occupied
 */
function isServerRunning() {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);

        socket.on('connect', () => {
            socket.destroy();
            resolve(true); // Server is running
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', (err) => {
            socket.destroy();
            resolve(false); // Port free
        });

        socket.connect(SERVER_PORT, 'localhost');
    });
}

/**
 * Enforce that server is stopped before proceeding
 */
async function ensureServerStopped() {
    const isRunning = await isServerRunning();
    if (isRunning) {
        console.error(`
\x1b[31mError: Antigravity Proxy server is currently running on port ${SERVER_PORT}.\x1b[0m

Please stop the server (Ctrl+C) before adding or managing accounts.
This ensures that your account changes are loaded correctly when you restart the server.
`);
        process.exit(1);
    }
}

/**
 * Create readline interface
 */
function createRL() {
    return createInterface({ input: stdin, output: stdout });
}

/**
 * Open URL in default browser
 */
function openBrowser(url) {
    const platform = process.platform;
    let command;
    let args;

    if (platform === 'darwin') {
        command = 'open';
        args = [url];
    } else if (platform === 'win32') {
        command = 'cmd';
        args = ['/c', 'start', '', url.replace(/&/g, '^&')];
    } else {
        command = 'xdg-open';
        args = [url];
    }

    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
        console.log('\n⚠ Could not open browser automatically.');
        console.log('Please open this URL manually:', url);
    });
    child.unref();
}

/**
 * Load existing accounts from config
 */
function loadAccounts() {
    try {
        if (existsSync(ACCOUNT_CONFIG_PATH)) {
            const data = readFileSync(ACCOUNT_CONFIG_PATH, 'utf-8');
            const config = JSON.parse(data);
            return config.accounts || [];
        }
    } catch (error) {
        console.error('Error loading accounts:', error.message);
    }
    return [];
}

/**
 * Save accounts to config
 */
function saveAccounts(accounts, settings = {}) {
    try {
        const dir = dirname(ACCOUNT_CONFIG_PATH);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        const config = {
            accounts: accounts.map(acc => ({
                email: acc.email,
                source: acc.source || 'oauth',
                refreshToken: acc.refreshToken || undefined,
                apiKey: acc.apiKey || undefined,
                projectId: acc.projectId || undefined,
                provider: acc.provider || 'google',
                addedAt: acc.addedAt || new Date().toISOString(),
                lastUsed: acc.lastUsed || null,
                modelRateLimits: acc.modelRateLimits || {}
            })),
            settings: {
                maxRetries: 5,
                ...settings
            },
            activeIndex: 0
        };

        writeFileSync(ACCOUNT_CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`\n✓ Saved ${accounts.length} account(s) to ${ACCOUNT_CONFIG_PATH}`);
    } catch (error) {
        console.error('Error saving accounts:', error.message);
        throw error;
    }
}

/**
 * Display current accounts
 */
function displayAccounts(accounts) {
    if (accounts.length === 0) {
        console.log('\nNo accounts configured.');
        return;
    }

    const providerLabels = {
        google: '🔵 Google',
        anthropic: '🟠 Anthropic',
        openai: '🟢 OpenAI',
        github: '🟣 GitHub',
        copilot: '🟧 Copilot',
        openrouter: '🟪 OpenRouter'
    };

    console.log(`\n${accounts.length} account(s) saved:`);
    accounts.forEach((acc, i) => {
        const hasActiveLimit = Object.values(acc.modelRateLimits || {}).some(
            limit => limit.isRateLimited && limit.resetTime > Date.now()
        );
        const status = hasActiveLimit ? ' (rate-limited)' : '';
        const provider = providerLabels[acc.provider || 'google'] || acc.provider || 'google';
        console.log(`  ${i + 1}. ${acc.email} [${provider}]${status}`);
    });
}

/**
 * Add a new account via OAuth with automatic callback
 */
async function addAccount(existingAccounts) {
    console.log('\n=== Add Google Account ===\n');

    // Generate authorization URL
    const { url, verifier, state } = getAuthorizationUrl();

    console.log('Opening browser for Google sign-in...');
    console.log('(If browser does not open, copy this URL manually)\n');
    console.log(`   ${url}\n`);

    // Open browser
    openBrowser(url);

    // Start callback server and wait for code
    console.log('Waiting for authentication (timeout: 2 minutes)...\n');

    try {
        // startCallbackServer now returns { promise, abort }
        const { promise } = startCallbackServer(state);
        const code = await promise;

        console.log('Received authorization code. Exchanging for tokens...');
        const result = await completeOAuthFlow(code, verifier);

        // Check if account already exists
        const existing = existingAccounts.find(a => a.email === result.email);
        if (existing) {
            console.log(`\n⚠ Account ${result.email} already exists. Updating tokens.`);
            existing.refreshToken = result.refreshToken;
            // Note: projectId will be discovered and stored in refresh token on first use
            existing.addedAt = new Date().toISOString();
            return null; // Don't add duplicate
        }

        console.log(`\n✓ Successfully authenticated: ${result.email}`);
        console.log('  Project will be discovered on first API request.');

        return {
            email: result.email,
            refreshToken: result.refreshToken,
            // Note: projectId stored in refresh token, not as separate field
            addedAt: new Date().toISOString(),
            modelRateLimits: {}
        };
    } catch (error) {
        console.error(`\n✗ Authentication failed: ${error.message}`);
        return null;
    }
}

/**
 * Add a new account via OAuth with manual code input (no-browser mode)
 * For headless servers without a desktop environment
 */
async function addAccountNoBrowser(existingAccounts, rl) {
    console.log('\n=== Add Google Account (No-Browser Mode) ===\n');

    // Generate authorization URL
    const { url, verifier, state } = getAuthorizationUrl();

    console.log('Copy the following URL and open it in a browser on another device:\n');
    console.log(`   ${url}\n`);
    console.log('After signing in, you will be redirected to a localhost URL.');
    console.log('Copy the ENTIRE redirect URL or just the authorization code.\n');

    const input = await rl.question('Paste the callback URL or authorization code: ');

    try {
        const { code, state: extractedState } = extractCodeFromInput(input);

        // Validate state if present
        if (extractedState && extractedState !== state) {
            console.log('\n⚠ State mismatch detected. This could indicate a security issue.');
            console.log('Proceeding anyway as this is manual mode...');
        }

        console.log('\nExchanging authorization code for tokens...');
        const result = await completeOAuthFlow(code, verifier);

        // Check if account already exists
        const existing = existingAccounts.find(a => a.email === result.email);
        if (existing) {
            console.log(`\n⚠ Account ${result.email} already exists. Updating tokens.`);
            existing.refreshToken = result.refreshToken;
            // Note: projectId will be discovered and stored in refresh token on first use
            existing.addedAt = new Date().toISOString();
            return null; // Don't add duplicate
        }

        console.log(`\n✓ Successfully authenticated: ${result.email}`);
        console.log('  Project will be discovered on first API request.');

        return {
            email: result.email,
            refreshToken: result.refreshToken,
            // Note: projectId stored in refresh token, not as separate field
            addedAt: new Date().toISOString(),
            modelRateLimits: {}
        };
    } catch (error) {
        console.error(`\n✗ Authentication failed: ${error.message}`);
        return null;
    }
}

/**
 * Interactive remove accounts flow
 */
async function interactiveRemove(rl) {
    while (true) {
        const accounts = loadAccounts();
        if (accounts.length === 0) {
            console.log('\nNo accounts to remove.');
            return;
        }

        displayAccounts(accounts);
        console.log('\nEnter account number to remove (or 0 to cancel)');

        const answer = await rl.question('> ');
        const index = parseInt(answer, 10);

        if (isNaN(index) || index < 0 || index > accounts.length) {
            console.log('\n❌ Invalid selection.');
            continue;
        }

        if (index === 0) {
            return; // Exit
        }

        const removed = accounts[index - 1]; // 1-based to 0-based
        const confirm = await rl.question(`\nAre you sure you want to remove ${removed.email}? [y/N]: `);

        if (confirm.toLowerCase() === 'y') {
            accounts.splice(index - 1, 1);
            saveAccounts(accounts);
            console.log(`\n✓ Removed ${removed.email}`);
        } else {
            console.log('\nCancelled.');
        }

        const removeMore = await rl.question('\nRemove another account? [y/N]: ');
        if (removeMore.toLowerCase() !== 'y') {
            break;
        }
    }
}

/**
 * Interactive add accounts flow (Main Menu)
 * @param {Object} rl - readline interface
 * @param {boolean} noBrowser - if true, use manual code input mode
 */
async function interactiveAdd(rl, noBrowser = false) {
    if (noBrowser) {
        console.log('\n📋 No-browser mode: You will manually paste the authorization code.\n');
    }

    const accounts = loadAccounts();

    if (accounts.length > 0) {
        displayAccounts(accounts);

        const choice = await rl.question('\n(a)dd new, (r)emove existing, (f)resh start, or (e)xit? [a/r/f/e]: ');
        const c = choice.toLowerCase();

        if (c === 'r') {
            await interactiveRemove(rl);
            return; // Return to main or exit? Given this is "add", we probably exit after sub-task.
        } else if (c === 'f') {
            console.log('\nStarting fresh - existing accounts will be replaced.');
            accounts.length = 0;
        } else if (c === 'a') {
            console.log('\nAdding to existing accounts.');
        } else if (c === 'e') {
            console.log('\nExiting...');
            return; // Exit cleanly
        } else {
            console.log('\nInvalid choice, defaulting to add.');
        }
    }

    // Add single account
    if (accounts.length >= MAX_ACCOUNTS) {
        console.log(`\nMaximum of ${MAX_ACCOUNTS} accounts reached.`);
        return;
    }

    // Use appropriate add function based on mode
    const newAccount = noBrowser
        ? await addAccountNoBrowser(accounts, rl)
        : await addAccount(accounts);

    if (newAccount) {
        accounts.push(newAccount);
        saveAccounts(accounts);
    } else if (accounts.length > 0) {
        // Even if newAccount is null (duplicate update), save the updated accounts
        saveAccounts(accounts);
    }

    if (accounts.length > 0) {
        displayAccounts(accounts);
        console.log('\nTo add more accounts, run this command again.');
    } else {
        console.log('\nNo accounts to save.');
    }
}

/**
 * List accounts
 */
async function listAccounts() {
    const accounts = loadAccounts();
    displayAccounts(accounts);

    if (accounts.length > 0) {
        console.log(`\nConfig file: ${ACCOUNT_CONFIG_PATH}`);
    }
}

/**
 * Clear all accounts
 */
async function clearAccounts(rl) {
    const accounts = loadAccounts();

    if (accounts.length === 0) {
        console.log('No accounts to clear.');
        return;
    }

    displayAccounts(accounts);

    const confirm = await rl.question('\nAre you sure you want to remove all accounts? [y/N]: ');
    if (confirm.toLowerCase() === 'y') {
        saveAccounts([]);
        console.log('All accounts removed.');
    } else {
        console.log('Cancelled.');
    }
}

/**
 * Verify accounts (test refresh tokens)
 */
async function verifyAccounts() {
    const accounts = loadAccounts();

    if (accounts.length === 0) {
        console.log('No accounts to verify.');
        return;
    }

    console.log('\nVerifying accounts...\n');

    for (const account of accounts) {
        try {
            const tokens = await refreshAccessToken(account.refreshToken);
            const email = await getUserEmail(tokens.accessToken);
            console.log(`  ✓ ${email} - OK`);
        } catch (error) {
            console.log(`  ✗ ${account.email} - ${error.message}`);
        }
    }
}

/**
 * Add a GitHub Copilot account via device authorization flow
 */
async function addCopilotAccount(rl) {
    console.log('\n=== Add GitHub Copilot Account ===\n');
    console.log('This will use GitHub\'s device authorization flow.');
    console.log('You need an active GitHub Copilot subscription.\n');

    const accounts = loadAccounts();

    if (accounts.length >= MAX_ACCOUNTS) {
        console.log(`\nMaximum of ${MAX_ACCOUNTS} accounts reached.`);
        return;
    }

    try {
        const { CopilotProvider } = await import('../providers/copilot.js');

        // Step 1: Initiate device auth
        console.log('Requesting device code from GitHub...');
        const deviceData = await CopilotProvider.initiateDeviceAuth();

        console.log(`\n\x1b[1m\x1b[33m  Your code: ${deviceData.user_code}\x1b[0m\n`);
        console.log(`  Open this URL: ${deviceData.verification_uri}`);
        console.log('  Enter the code above and authorize the application.\n');

        // Try to open browser
        openBrowser(deviceData.verification_uri);

        console.log('Waiting for authorization...');
        console.log('(Press Ctrl+C to cancel)\n');

        // Step 2: Poll for token
        const interval = (deviceData.interval || 5) * 1000;
        const expiresAt = Date.now() + (deviceData.expires_in || 900) * 1000;

        while (Date.now() < expiresAt) {
            await new Promise(resolve => setTimeout(resolve, interval));

            try {
                const response = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'User-Agent': 'commons-proxy/2.0.0'
                    },
                    body: JSON.stringify({
                        client_id: 'Iv1.b507a08c87ecfe98',
                        device_code: deviceData.device_code,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                    })
                });

                const data = await response.json();

                if (data.access_token) {
                    // Success! Get user info
                    console.log('Authorization received! Fetching user info...');
                    const userInfo = await CopilotProvider.getUserInfo(data.access_token);

                    // Check for duplicate
                    const existing = accounts.find(a => a.email === userInfo.email && a.provider === 'copilot');
                    if (existing) {
                        console.log(`\n⚠ Account ${userInfo.email} already exists. Updating token.`);
                        existing.apiKey = data.access_token;
                        existing.addedAt = new Date().toISOString();
                    } else {
                        accounts.push({
                            email: userInfo.email,
                            source: 'manual',
                            provider: 'copilot',
                            apiKey: data.access_token,
                            addedAt: new Date().toISOString(),
                            modelRateLimits: {}
                        });
                        console.log(`\n✓ Successfully added: ${userInfo.email} [🟧 Copilot]`);
                    }

                    saveAccounts(accounts);
                    displayAccounts(accounts);
                    return;
                }

                if (data.error === 'authorization_pending') {
                    process.stdout.write('.');
                    continue;
                }

                if (data.error === 'slow_down') {
                    process.stdout.write('.');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }

                if (data.error === 'expired_token') {
                    console.log('\n\n✗ Device code expired. Please try again.');
                    return;
                }

                if (data.error) {
                    console.log(`\n\n✗ Authorization failed: ${data.error_description || data.error}`);
                    return;
                }
            } catch (pollError) {
                console.error(`\n\n✗ Polling error: ${pollError.message}`);
                return;
            }
        }

        console.log('\n\n✗ Authorization timed out. Please try again.');
    } catch (error) {
        console.error(`\n✗ Copilot device auth failed: ${error.message}`);
    }
}

/**
 * Main CLI
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'add';
    const noBrowser = args.includes('--no-browser');

    console.log('╔════════════════════════════════════════╗');
    console.log('║   CommonsProxy Account Manager         ║');
    console.log('║   Use --provider=copilot for Copilot   ║');
    console.log('║   Use --no-browser for headless mode   ║');
    console.log('╚════════════════════════════════════════╝');

    const rl = createRL();

    // Parse --provider flag
    const providerArg = args.find(a => a.startsWith('--provider='));
    const provider = providerArg ? providerArg.split('=')[1] : null;

    try {
        switch (command) {
            case 'add':
                await ensureServerStopped();
                if (provider === 'copilot') {
                    await addCopilotAccount(rl);
                } else {
                    await interactiveAdd(rl, noBrowser);
                }
                break;
            case 'list':
                await listAccounts();
                break;
            case 'clear':
                await ensureServerStopped();
                await clearAccounts(rl);
                break;
            case 'verify':
                await verifyAccounts();
                break;
            case 'help':
                console.log('\nUsage:');
                console.log('  node src/cli/accounts.js add     Add new account(s)');
                console.log('  node src/cli/accounts.js list    List all accounts');
                console.log('  node src/cli/accounts.js verify  Verify account tokens');
                console.log('  node src/cli/accounts.js clear   Remove all accounts');
                console.log('  node src/cli/accounts.js help    Show this help');
                console.log('\nOptions:');
                console.log('  --provider=copilot  Add a GitHub Copilot account via device auth');
                console.log('  --no-browser        Manual authorization code input (for headless servers)');
                break;
            case 'remove':
                await ensureServerStopped();
                await interactiveRemove(rl);
                break;
            default:
                console.log(`Unknown command: ${command}`);
                console.log('Run with "help" for usage information.');
        }
    } finally {
        rl.close();
        // Force exit to prevent hanging
        process.exit(0);
    }
}

main().catch(console.error);
