/**
 * Base Provider Interface
 *
 * Abstract base class for authentication providers.
 * Each provider implements:
 * - Authentication (OAuth, API keys, PAT, etc.)
 * - Token/credential validation
 * - Quota/rate limit fetching
 * - Account information retrieval
 */

import { logger } from '../utils/logger.js';

export class BaseProvider {
    /**
     * @param {string} id - Unique provider identifier ('google', 'anthropic', 'openai', 'github')
     * @param {string} name - Display name for UI
     * @param {Object} config - Provider-specific configuration
     */
    constructor(id, name, config = {}) {
        if (new.target === BaseProvider) {
            throw new Error('BaseProvider is abstract and cannot be instantiated directly');
        }
        this.id = id;
        this.name = name;
        this.config = config;
    }

    /**
     * Validate account credentials (API key, token, etc.)
     *
     * @param {Object} account - Account object with credentials
     * @returns {Promise<{valid: boolean, error?: string, email?: string}>}
     */
    async validateCredentials(account) {
        throw new Error('validateCredentials() must be implemented by subclass');
    }

    /**
     * Get access token for making API requests
     *
     * @param {Object} account - Account object
     * @returns {Promise<string>} Access token or API key
     */
    async getAccessToken(account) {
        throw new Error('getAccessToken() must be implemented by subclass');
    }

    /**
     * Fetch account quota/usage information
     *
     * @param {Object} account - Account object
     * @param {string} token - Access token
     * @returns {Promise<Object>} Quota data: { models: { [modelId]: { remainingFraction, resetTime } } }
     */
    async getQuotas(account, token) {
        throw new Error('getQuotas() must be implemented by subclass');
    }

    /**
     * Fetch subscription/account tier information
     *
     * @param {Object} account - Account object
     * @param {string} token - Access token
     * @returns {Promise<{tier: string, projectId?: string}>} Subscription info
     */
    async getSubscriptionTier(account, token) {
        // Default implementation - can be overridden
        return { tier: 'unknown', projectId: null };
    }

    /**
     * Refresh expired credentials (if applicable)
     *
     * @param {Object} account - Account object
     * @returns {Promise<Object>} Updated account object with refreshed credentials
     */
    async refreshCredentials(account) {
        // Default: no-op for API key based providers
        return account;
    }

    /**
     * Get available models for this provider
     *
     * @param {Object} account - Account object
     * @param {string} token - Access token
     * @returns {Promise<Array<{id: string, name: string, family: string}>>} Available models
     */
    async getAvailableModels(account, token) {
        // Default: return empty array - can be overridden
        return [];
    }

    /**
     * Parse rate limit information from API response
     *
     * @param {Response} response - Fetch API response object
     * @param {Object} [errorData] - Optional parsed error data
     * @returns {Object|null} Rate limit info: { resetTime: Date, retryAfter: number }
     */
    parseRateLimitInfo(response, errorData = null) {
        // Default implementation - can be overridden
        return null;
    }

    /**
     * Handle authentication error and determine if credentials need refresh
     *
     * @param {Error} error - Authentication error
     * @returns {boolean} True if credentials should be marked invalid
     */
    shouldInvalidateCredentials(error) {
        // Default: invalidate on 401/403 errors
        if (error.status === 401 || error.status === 403) {
            return true;
        }
        if (error.message && error.message.toLowerCase().includes('invalid') &&
            error.message.toLowerCase().includes('api')) {
            return true;
        }
        return false;
    }

    /**
     * Log provider-specific debug information
     *
     * @param {string} message - Debug message
     * @param {*} data - Optional data to log
     */
    debug(message, data = null) {
        if (logger.isDebugEnabled) {
            logger.debug(`[Provider:${this.name}] ${message}`, data || '');
        }
    }

    /**
     * Log provider info
     *
     * @param {string} message - Info message
     */
    info(message) {
        logger.info(`[Provider:${this.name}] ${message}`);
    }

    /**
     * Log provider error
     *
     * @param {string} message - Error message
     * @param {Error} [error] - Optional error object
     */
    error(message, error = null) {
        logger.error(`[Provider:${this.name}] ${message}`, error ? error.message : '');
    }
}

export default BaseProvider;
