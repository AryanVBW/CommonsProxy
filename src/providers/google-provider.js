/**
 * Google Cloud Code Provider
 *
 * Implements authentication via Google OAuth with PKCE.
 * Wraps existing OAuth and Cloud Code API logic.
 */

import BaseProvider from './base-provider.js';
import {
    refreshAccessToken,
    getUserEmail,
    discoverProjectId
} from '../auth/oauth.js';
import { getModelQuotas, getSubscriptionTier } from '../cloudcode/model-api.js';
import { logger } from '../utils/logger.js';

export class GoogleProvider extends BaseProvider {
    constructor(config = {}) {
        super('google', 'Google Cloud Code', config);
    }

    /**
     * Validate OAuth refresh token by attempting to refresh
     *
     * @param {Object} account - Account with refreshToken
     * @returns {Promise<{valid: boolean, error?: string, email?: string}>}
     */
    async validateCredentials(account) {
        if (!account.refreshToken) {
            return { valid: false, error: 'Missing refresh token' };
        }

        try {
            // Try to refresh the access token
            const { accessToken } = await refreshAccessToken(account.refreshToken);

            // Get email to confirm account identity
            const email = await getUserEmail(accessToken);

            return { valid: true, email };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get access token from OAuth refresh token
     *
     * @param {Object} account - Account with refreshToken
     * @returns {Promise<string>} Access token
     */
    async getAccessToken(account) {
        if (!account.refreshToken) {
            throw new Error('Account missing refresh token');
        }

        try {
            const { accessToken } = await refreshAccessToken(account.refreshToken);
            return accessToken;
        } catch (error) {
            this.error('Failed to get access token', error);
            throw error;
        }
    }

    /**
     * Fetch model quotas from Cloud Code API
     *
     * @param {Object} account - Account object
     * @param {string} token - Access token
     * @returns {Promise<Object>} Quota data
     */
    async getQuotas(account, token) {
        try {
            const projectId = account.projectId || account.subscription?.projectId;
            if (!projectId) {
                this.debug('No project ID available, attempting discovery...');
                const discoveredProject = await discoverProjectId(token);
                if (!discoveredProject) {
                    throw new Error('Could not discover project ID');
                }
                return await getModelQuotas(token, discoveredProject);
            }

            return await getModelQuotas(token, projectId);
        } catch (error) {
            this.error('Failed to fetch quotas', error);
            throw error;
        }
    }

    /**
     * Fetch subscription tier from loadCodeAssist API
     *
     * @param {Object} account - Account object
     * @param {string} token - Access token
     * @returns {Promise<{tier: string, projectId: string}>}
     */
    async getSubscriptionTier(account, token) {
        try {
            return await getSubscriptionTier(token);
        } catch (error) {
            this.error('Failed to fetch subscription tier', error);
            // Return cached value if available
            if (account.subscription?.tier) {
                this.debug('Using cached subscription tier');
                return {
                    tier: account.subscription.tier,
                    projectId: account.subscription.projectId
                };
            }
            return { tier: 'unknown', projectId: null };
        }
    }

    /**
     * Refresh OAuth credentials
     *
     * @param {Object} account - Account object
     * @returns {Promise<Object>} Updated account (no changes for OAuth - refresh happens on-demand)
     */
    async refreshCredentials(account) {
        // OAuth refresh happens on-demand via refreshAccessToken()
        // No need to update account object
        return account;
    }

    /**
     * Parse rate limit headers from Cloud Code API
     *
     * @param {Response} response - Fetch response
     * @param {Object} errorData - Error data from response body
     * @returns {Object|null} Rate limit info
     */
    parseRateLimitInfo(response, errorData = null) {
        // Check for rate limit headers (X-RateLimit-Reset, Retry-After, etc.)
        const retryAfter = response.headers.get('retry-after');
        const rateLimitReset = response.headers.get('x-ratelimit-reset');

        if (retryAfter) {
            const retrySeconds = parseInt(retryAfter, 10);
            return {
                resetTime: new Date(Date.now() + retrySeconds * 1000),
                retryAfter: retrySeconds
            };
        }

        if (rateLimitReset) {
            const resetTimestamp = parseInt(rateLimitReset, 10);
            return {
                resetTime: new Date(resetTimestamp * 1000),
                retryAfter: Math.max(0, Math.floor((resetTimestamp * 1000 - Date.now()) / 1000))
            };
        }

        // Check error data for rate limit info
        if (errorData?.error?.details) {
            const details = errorData.error.details;
            // Look for quota reset time in error details
            if (details.quotaResetTime) {
                return {
                    resetTime: new Date(details.quotaResetTime),
                    retryAfter: Math.max(0, Math.floor((new Date(details.quotaResetTime) - Date.now()) / 1000))
                };
            }
        }

        return null;
    }

    /**
     * Check if error indicates invalid OAuth credentials
     *
     * @param {Error} error - Error object
     * @returns {boolean}
     */
    shouldInvalidateCredentials(error) {
        // Check for OAuth-specific errors
        if (error.message && (
            error.message.includes('invalid_grant') ||
            error.message.includes('Token has been expired or revoked') ||
            error.message.includes('Invalid Credentials')
        )) {
            return true;
        }

        return super.shouldInvalidateCredentials(error);
    }
}

export default GoogleProvider;
