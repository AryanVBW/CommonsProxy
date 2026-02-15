/**
 * Account Storage
 *
 * Handles loading and saving account configuration to disk.
 */

import { readFile, writeFile, mkdir, access, rename } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { dirname, join } from 'path';
import { Mutex } from 'async-mutex';
import { ACCOUNT_CONFIG_PATH } from '../constants.js';
import { getAuthStatus } from '../auth/database.js';
import { logger } from '../utils/logger.js';

/**
 * Mutex to serialize concurrent writes to accounts.json.
 * Prevents corruption from overlapping writeFile/rename operations.
 */
const writeMutex = new Mutex();

/**
 * Detect provider from legacy source field
 * @param {string} source - Account source ('oauth', 'manual', 'database')
 * @returns {string} Provider ID
 */
function detectProviderFromSource(source) {
    // Legacy accounts use 'oauth' or 'database' for Google OAuth
    if (source === 'oauth' || source === 'database') {
        return 'google';
    }
    // Manual accounts default to Google (legacy behavior)
    if (source === 'manual') {
        return 'google';
    }
    // Default to Google
    return 'google';
}

/**
 * Load accounts from the config file
 *
 * @param {string} configPath - Path to the config file
 * @returns {Promise<{accounts: Array, settings: Object, activeIndex: number}>}
 */
export async function loadAccounts(configPath = ACCOUNT_CONFIG_PATH) {
    try {
        // Check if config file exists using async access
        await access(configPath, fsConstants.F_OK);
        const configData = await readFile(configPath, 'utf-8');
        const config = JSON.parse(configData);

        const accounts = (config.accounts || []).map(acc => ({
            ...acc,
            lastUsed: acc.lastUsed || null,
            enabled: acc.enabled !== false, // Default to true if not specified
            // Reset invalid flag on startup - give accounts a fresh chance to refresh
            isInvalid: false,
            invalidReason: null,
            modelRateLimits: acc.modelRateLimits || {},
            // New fields for subscription and quota tracking
            subscription: acc.subscription || { tier: 'unknown', projectId: null, detectedAt: null },
            quota: acc.quota || { models: {}, lastChecked: null },
            // Multi-provider support
            provider: acc.provider || detectProviderFromSource(acc.source),
            customApiEndpoint: acc.customApiEndpoint || null
        }));

        const settings = config.settings || {};
        let activeIndex = config.activeIndex || 0;

        // Clamp activeIndex to valid range
        if (activeIndex >= accounts.length) {
            activeIndex = 0;
        }

        logger.info(`[AccountManager] Loaded ${accounts.length} account(s) from config`);

        return { accounts, settings, activeIndex };
    } catch (error) {
        if (error.code === 'ENOENT') {
            // No config file - return empty
            logger.info('[AccountManager] No config file found. Using Antigravity database (single account mode)');
        } else {
            logger.error('[AccountManager] Failed to load config:', error.message);
        }
        return { accounts: [], settings: {}, activeIndex: 0 };
    }
}

/**
 * Load the default account from Antigravity's database
 *
 * @param {string} dbPath - Optional path to the database
 * @returns {{accounts: Array, tokenCache: Map}}
 */
export function loadDefaultAccount(dbPath) {
    try {
        const authData = getAuthStatus(dbPath);
        if (authData?.apiKey) {
            const account = {
                email: authData.email || 'default@commons',
                source: 'database',
                lastUsed: null,
                modelRateLimits: {}
            };

            const tokenCache = new Map();
            tokenCache.set(account.email, {
                token: authData.apiKey,
                extractedAt: Date.now()
            });

            logger.info(`[AccountManager] Loaded default account: ${account.email}`);

            return { accounts: [account], tokenCache };
        }
    } catch (error) {
        logger.error('[AccountManager] Failed to load default account:', error.message);
    }

    return { accounts: [], tokenCache: new Map() };
}

/**
 * Save account configuration to disk
 *
 * @param {string} configPath - Path to the config file
 * @param {Array} accounts - Array of account objects
 * @param {Object} settings - Settings object
 * @param {number} activeIndex - Current active account index
 */
export async function saveAccounts(configPath, accounts, settings, activeIndex) {
    // Serialize concurrent writes to prevent corruption
    return writeMutex.runExclusive(async () => {
        try {
            // Ensure directory exists
            const dir = dirname(configPath);
            await mkdir(dir, { recursive: true });

            const config = {
                accounts: accounts.map(acc => ({
                    email: acc.email,
                    source: acc.source,
                    enabled: acc.enabled !== false, // Persist enabled state
                    dbPath: acc.dbPath || null,
                    refreshToken: acc.source === 'oauth' ? acc.refreshToken : undefined,
                    apiKey: (acc.source === 'manual' || acc.provider !== 'google') ? acc.apiKey : undefined,
                    projectId: acc.projectId || undefined,
                    addedAt: acc.addedAt || undefined,
                    isInvalid: acc.isInvalid || false,
                    invalidReason: acc.invalidReason || null,
                    modelRateLimits: acc.modelRateLimits || {},
                    lastUsed: acc.lastUsed,
                    // Persist subscription and quota data
                    subscription: acc.subscription || { tier: 'unknown', projectId: null, detectedAt: null },
                    quota: acc.quota || { models: {}, lastChecked: null },
                    // Multi-provider support
                    provider: acc.provider || detectProviderFromSource(acc.source),
                    customApiEndpoint: acc.customApiEndpoint || undefined
                })),
                settings: settings,
                activeIndex: activeIndex
            };

            // Atomic write: write to temp file, then rename into place.
            // rename() on the same filesystem is atomic on POSIX, preventing
            // half-written files if the process crashes mid-write.
            const tmpPath = join(dir, `.accounts.tmp.${process.pid}`);
            await writeFile(tmpPath, JSON.stringify(config, null, 2));
            await rename(tmpPath, configPath);
        } catch (error) {
            logger.error('[AccountManager] Failed to save config:', error.message);
        }
    });
}
