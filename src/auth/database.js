/**
 * SQLite Database Access Module
 * Provides cross-platform database operations for Cloud Code IDE state.
 *
 * Uses better-sqlite3 for:
 * - Windows compatibility (no CLI dependency)
 * - Native performance
 * - Synchronous API (simple error handling)
 *
 * Includes auto-rebuild capability for handling Node.js version updates
 * that cause native module incompatibility.
 */

import { createRequire } from 'module';
import { ANTIGRAVITY_DB_PATH, CLOUDCODE_DB_PATH } from '../constants.js';
import { isModuleVersionError, attemptAutoRebuild, clearRequireCache } from '../utils/native-module-helper.js';
import { logger } from '../utils/logger.js';
import { NativeModuleError } from '../errors.js';

const require = createRequire(import.meta.url);

// Lazy-loaded Database constructor
let Database = null;
let moduleLoadError = null;

/**
 * Load the better-sqlite3 module with auto-rebuild on version mismatch
 * Uses synchronous require to maintain API compatibility
 * @returns {Function} The Database constructor
 * @throws {Error} If module cannot be loaded even after rebuild
 */
function loadDatabaseModule() {
    // Return cached module if already loaded
    if (Database) return Database;

    // Re-throw cached error if previous load failed permanently
    if (moduleLoadError) throw moduleLoadError;

    try {
        Database = require('better-sqlite3');
        return Database;
    } catch (error) {
        if (isModuleVersionError(error)) {
            logger.warn('[Database] Native module version mismatch detected');

            if (attemptAutoRebuild(error)) {
                // Clear require cache and retry
                try {
                    const resolvedPath = require.resolve('better-sqlite3');
                    // Clear the module and all its dependencies from cache
                    clearRequireCache(resolvedPath, require.cache);

                    Database = require('better-sqlite3');
                    logger.success('[Database] Module reloaded successfully after rebuild');
                    return Database;
                } catch (retryError) {
                    // Rebuild succeeded but reload failed - user needs to restart
                    moduleLoadError = new NativeModuleError(
                        'Native module rebuild completed. Please restart the server to apply the fix.',
                        true,  // rebuildSucceeded
                        true   // restartRequired
                    );
                    logger.info('[Database] Rebuild succeeded - server restart required');
                    throw moduleLoadError;
                }
            } else {
                moduleLoadError = new NativeModuleError(
                    'Failed to auto-rebuild native module. Please run manually:\n' +
                    '  npm rebuild better-sqlite3\n' +
                    'Or if using npx, find the package location in the error and run:\n' +
                    '  cd /path/to/better-sqlite3 && npm rebuild',
                    false,  // rebuildSucceeded
                    false   // restartRequired
                );
                throw moduleLoadError;
            }
        }

        // Non-version-mismatch error, just throw it
        throw error;
    }
}

/**
 * Query IDE database for authentication status.
 * Tries Antigravity database (antigravityAuthStatus key) first,
 * then falls back to Windsurf/Cloud Code IDE (cloudcodeAuthStatus key).
 * @param {string} [dbPath] - Optional custom database path
 * @returns {Object} Parsed auth data with apiKey, email, name, etc.
 * @throws {Error} If database doesn't exist, query fails, or no auth status found
 */
export function getAuthStatus(dbPath) {
    // If a specific dbPath was provided, query it directly
    if (dbPath) {
        return queryAuthStatus(dbPath);
    }

    // Try Antigravity DB first (primary)
    try {
        return queryAuthStatus(ANTIGRAVITY_DB_PATH, 'antigravityAuthStatus');
    } catch (e) {
        logger.debug(`[Database] Antigravity DB not available: ${e.message}`);
    }

    // Fall back to Windsurf/Cloud Code IDE DB
    try {
        return queryAuthStatus(CLOUDCODE_DB_PATH, 'cloudcodeAuthStatus');
    } catch (e) {
        logger.debug(`[Database] Cloud Code IDE DB not available: ${e.message}`);
    }

    throw new Error(
        'No auth status found in any IDE database. ' +
        'Make sure Antigravity or a Cloud Code IDE is installed and you are logged in.'
    );
}

/**
 * Query a specific database for authentication status
 * @param {string} dbPath - Path to the database
 * @param {string} [authKey='antigravityAuthStatus'] - The key to query for auth status
 * @returns {Object} Parsed auth data with apiKey, email, name, etc.
 * @throws {Error} If database doesn't exist, query fails, or no auth status found
 */
function queryAuthStatus(dbPath, authKey = 'antigravityAuthStatus') {
    const Db = loadDatabaseModule();
    let db;
    try {
        // Open database in read-only mode
        db = new Db(dbPath, {
            readonly: true,
            fileMustExist: true
        });

        // Try the specified key first
        let stmt = db.prepare(
            `SELECT value FROM ItemTable WHERE key = '${authKey}'`
        );
        let row = stmt.get();

        // If specified key not found, try the other key as fallback
        if (!row || !row.value) {
            const fallbackKey = authKey === 'antigravityAuthStatus' ? 'cloudcodeAuthStatus' : 'antigravityAuthStatus';
            stmt = db.prepare(
                `SELECT value FROM ItemTable WHERE key = '${fallbackKey}'`
            );
            row = stmt.get();
        }

        if (!row || !row.value) {
            throw new Error('No auth status found in database');
        }

        // Parse JSON value
        const authData = JSON.parse(row.value);

        if (!authData.apiKey) {
            throw new Error('Auth data missing apiKey field');
        }

        return authData;
    } catch (error) {
        // Enhance error messages for common issues
        if (error.code === 'SQLITE_CANTOPEN') {
            throw new Error(
                `Database not found at ${dbPath}. ` +
                'Make sure the IDE is installed and you are logged in.'
            );
        }
        // Re-throw with context if not already our error
        if (error.message.includes('No auth status') || error.message.includes('missing apiKey')) {
            throw error;
        }
        // Re-throw native module errors from loadDatabaseModule without wrapping
        if (error instanceof NativeModuleError) {
            throw error;
        }
        throw new Error(`Failed to read IDE database: ${error.message}`);
    } finally {
        // Always close database connection
        if (db) {
            db.close();
        }
    }
}

/**
 * Check if database exists and is accessible
 * Tries Antigravity DB first, then Windsurf/Cloud Code IDE DB
 * @param {string} [dbPath] - Optional custom database path
 * @returns {boolean} True if database exists and can be opened
 */
export function isDatabaseAccessible(dbPath) {
    if (dbPath) {
        return checkDbAccessible(dbPath);
    }
    // Try Antigravity first, then Windsurf
    return checkDbAccessible(ANTIGRAVITY_DB_PATH) || checkDbAccessible(CLOUDCODE_DB_PATH);
}

/**
 * Check if a specific database path is accessible
 * @param {string} dbPath - Path to the database
 * @returns {boolean} True if database exists and can be opened
 */
function checkDbAccessible(dbPath) {
    let db;
    try {
        const Db = loadDatabaseModule();
        db = new Db(dbPath, {
            readonly: true,
            fileMustExist: true
        });
        return true;
    } catch {
        return false;
    } finally {
        if (db) {
            db.close();
        }
    }
}

export default {
    getAuthStatus,
    isDatabaseAccessible
};
