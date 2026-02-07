/**
 * OpenAI Codex Provider (ChatGPT Plus/Pro)
 *
 * Authentication provider for ChatGPT Plus/Pro users via OAuth.
 * Uses the codex-auth.js module for actual auth flows.
 *
 * Credits: Authentication flow based on opencode (https://github.com/nichochar/opencode)
 */

import BaseProvider from './base-provider.js';
import { refreshCodexAccessToken, extractAccountId, parseJwtClaims } from './codex-auth.js';

export class CodexProvider extends BaseProvider {
    constructor(config = {}) {
        super('codex', 'ChatGPT Plus/Pro (Codex)', {
            issuer: 'https://auth.openai.com',
            apiEndpoint: 'https://chatgpt.com/backend-api/codex/responses',
            ...config
        });
    }

    /**
     * Validate Codex credentials by checking the access token
     *
     * @param {Object} account - Account with apiKey (access token) or refreshToken
     * @returns {Promise<{valid: boolean, error?: string, email?: string}>}
     */
    async validateCredentials(account) {
        const token = account.apiKey;
        if (!token && !account.refreshToken) {
            return { valid: false, error: 'Missing access token or refresh token' };
        }

        try {
            // Try to parse JWT to extract account info
            if (token) {
                const claims = parseJwtClaims(token);
                if (claims) {
                    const email = claims.email || `codex-${claims.sub || 'user'}@chatgpt`;
                    return { valid: true, email };
                }
            }

            // If we have a refresh token, try refreshing to validate
            if (account.refreshToken) {
                const tokens = await refreshCodexAccessToken(account.refreshToken);
                if (tokens.access_token) {
                    const accountId = extractAccountId(tokens);
                    const email = `codex-${accountId || 'user'}@chatgpt`;
                    return { valid: true, email };
                }
            }

            // Fallback: assume valid if we have a token
            return { valid: true, email: account.email || 'codex-user@chatgpt' };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get access token for Codex API requests
     *
     * @param {Object} account - Account with apiKey or refreshToken
     * @returns {Promise<string>} Access token
     */
    async getAccessToken(account) {
        if (account.apiKey) {
            return account.apiKey;
        }

        if (account.refreshToken) {
            const tokens = await refreshCodexAccessToken(account.refreshToken);
            return tokens.access_token;
        }

        throw new Error('Account missing access token and refresh token');
    }

    /**
     * Fetch quota information (Codex doesn't expose usage API)
     *
     * @param {Object} account - Account object
     * @param {string} token - Access token
     * @returns {Promise<Object>} Quota data
     */
    async getQuotas(account, token) {
        // Codex/ChatGPT doesn't expose quota API
        // Return default availability
        return { models: {} };
    }

    /**
     * Get subscription tier
     *
     * @param {Object} account - Account object
     * @param {string} token - Access token
     * @returns {Promise<{tier: string, projectId: string|null}>}
     */
    async getSubscriptionTier(account, token) {
        return { tier: 'codex', projectId: account.accountId || null };
    }

    /**
     * Refresh expired credentials
     *
     * @param {Object} account - Account object with refreshToken
     * @returns {Promise<Object>} Updated account
     */
    async refreshCredentials(account) {
        if (!account.refreshToken) {
            return account;
        }

        try {
            const tokens = await refreshCodexAccessToken(account.refreshToken);
            return {
                ...account,
                apiKey: tokens.access_token,
                refreshToken: tokens.refresh_token || account.refreshToken
            };
        } catch (error) {
            this.error('Failed to refresh Codex credentials', error);
            throw error;
        }
    }

    /**
     * Check if error indicates invalid credentials
     *
     * @param {Error} error - Error object
     * @returns {boolean}
     */
    shouldInvalidateCredentials(error) {
        if (error.message && (
            error.message.includes('Token refresh failed') ||
            error.message.includes('invalid_grant') ||
            error.message.includes('Unauthorized')
        )) {
            return true;
        }
        return super.shouldInvalidateCredentials(error);
    }
}

export default CodexProvider;
