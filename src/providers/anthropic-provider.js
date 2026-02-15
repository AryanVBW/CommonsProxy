/**
 * Anthropic API Provider
 *
 * Implements authentication via Anthropic API keys.
 * Supports Claude models via direct Anthropic API.
 */

import BaseProvider from './base-provider.js';
import crypto from 'crypto';

export class AnthropicProvider extends BaseProvider {
    constructor(config = {}) {
        super('anthropic', 'Anthropic', {
            apiEndpoint: config.apiEndpoint || 'https://api.anthropic.com',
            apiVersion: config.apiVersion || '2023-06-01',
            ...config
        });
    }

    /**
     * Validate Anthropic API key
     *
     * @param {Object} account - Account with apiKey
     * @returns {Promise<{valid: boolean, error?: string, email?: string}>}
     */
    async validateCredentials(account) {
        if (!account.apiKey) {
            return { valid: false, error: 'Missing API key' };
        }

        try {
            // Test API key by fetching model list
            const endpoint = account.customApiEndpoint || this.config.apiEndpoint;
            const response = await fetch(`${endpoint}/v1/models`, {
                method: 'GET',
                headers: {
                    'x-api-key': account.apiKey,
                    'anthropic-version': this.config.apiVersion
                }
            });

            if (!response.ok) {
                const error = await response.text();
                return { valid: false, error: `API key validation failed: ${error}` };
            }

            // Anthropic doesn't provide email in API, use a hash-based identifier
            const keyHash = crypto.createHash('sha256').update(account.apiKey).digest('hex').slice(0, 8);
            const email = account.email || `anthropic-${keyHash}`;

            return { valid: true, email };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get API key (for Anthropic, API key IS the access token)
     *
     * @param {Object} account - Account with apiKey
     * @returns {Promise<string>} API key
     */
    async getAccessToken(account) {
        if (!account.apiKey) {
            throw new Error('Account missing API key');
        }
        return account.apiKey;
    }

    /**
     * Fetch usage/quota information from Anthropic API
     * Note: Anthropic doesn't expose quota via API, so we track usage client-side
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<Object>} Quota data (estimated based on usage tracking)
     */
    async getQuotas(account, token) {
        try {
            const endpoint = account.customApiEndpoint || this.config.apiEndpoint;

            // Anthropic doesn't have a direct quota API yet
            // We'll attempt to fetch models to check if key is active
            const response = await fetch(`${endpoint}/v1/models`, {
                method: 'GET',
                headers: {
                    'x-api-key': token,
                    'anthropic-version': this.config.apiVersion
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            const models = {};

            // Create default quota entries for available models
            if (data.data && Array.isArray(data.data)) {
                data.data.forEach(model => {
                    models[model.id] = {
                        remainingFraction: 1.0, // Default: full quota (no API to check actual)
                        resetTime: null // Unknown
                    };
                });
            } else {
                // Fallback: Common Claude models
                const commonModels = [
                    'claude-3-opus-20240229',
                    'claude-3-sonnet-20240229',
                    'claude-3-haiku-20240307',
                    'claude-opus-4-5-thinking',
                    'claude-sonnet-4-5-thinking'
                ];
                commonModels.forEach(modelId => {
                    models[modelId] = {
                        remainingFraction: 1.0,
                        resetTime: null
                    };
                });
            }

            return { models };
        } catch (error) {
            this.error('Failed to fetch quotas', error);
            // Return default quota on error
            return {
                models: {
                    'claude-opus-4-5-thinking': { remainingFraction: 1.0, resetTime: null },
                    'claude-sonnet-4-5-thinking': { remainingFraction: 1.0, resetTime: null }
                }
            };
        }
    }

    /**
     * Get subscription tier (Anthropic uses usage-based pricing)
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<{tier: string, projectId: null}>}
     */
    async getSubscriptionTier(account, token) {
        // Anthropic uses usage-based pricing, no fixed tiers
        // We can check the organization if the API supports it in the future
        return { tier: 'usage-based', projectId: null };
    }

    /**
     * Get available Claude models
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<Array>} List of available models
     */
    async getAvailableModels(account, token) {
        try {
            const endpoint = account.customApiEndpoint || this.config.apiEndpoint;
            const response = await fetch(`${endpoint}/v1/models`, {
                method: 'GET',
                headers: {
                    'x-api-key': token,
                    'anthropic-version': this.config.apiVersion
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                return data.data.map(model => ({
                    id: model.id,
                    name: model.display_name || model.id,
                    family: 'claude'
                }));
            }

            return [];
        } catch (error) {
            this.error('Failed to fetch available models', error);
            return [];
        }
    }

    /**
     * Parse Anthropic rate limit headers
     *
     * @param {Response} response - Fetch response
     * @param {Object} errorData - Error data from response body
     * @returns {Object|null} Rate limit info
     */
    parseRateLimitInfo(response, errorData = null) {
        // Anthropic uses these headers:
        // - anthropic-ratelimit-requests-limit
        // - anthropic-ratelimit-requests-remaining
        // - anthropic-ratelimit-requests-reset
        // - anthropic-ratelimit-tokens-limit
        // - anthropic-ratelimit-tokens-remaining
        // - anthropic-ratelimit-tokens-reset
        // - retry-after

        const retryAfter = response.headers.get('retry-after');
        const requestsReset = response.headers.get('anthropic-ratelimit-requests-reset');
        const tokensReset = response.headers.get('anthropic-ratelimit-tokens-reset');

        if (retryAfter) {
            const retrySeconds = parseInt(retryAfter, 10);
            return {
                resetTime: new Date(Date.now() + retrySeconds * 1000),
                retryAfter: retrySeconds
            };
        }

        // Use the later of requests or tokens reset time
        const resets = [requestsReset, tokensReset].filter(Boolean);
        if (resets.length > 0) {
            const resetDates = resets.map(r => new Date(r));
            const latestReset = new Date(Math.max(...resetDates));
            return {
                resetTime: latestReset,
                retryAfter: Math.max(0, Math.floor((latestReset - Date.now()) / 1000))
            };
        }

        // Check error response for rate limit info
        if (errorData?.error?.type === 'rate_limit_error') {
            // Anthropic may include reset time in error message
            return {
                resetTime: new Date(Date.now() + 60000), // Default: 1 minute
                retryAfter: 60
            };
        }

        return null;
    }

    /**
     * Check if error indicates invalid API key
     *
     * @param {Error} error - Error object
     * @returns {boolean}
     */
    shouldInvalidateCredentials(error) {
        if (error.message && (
            error.message.includes('invalid_api_key') ||
            error.message.includes('authentication_error') ||
            error.message.includes('Invalid API Key')
        )) {
            return true;
        }

        return super.shouldInvalidateCredentials(error);
    }
}

export default AnthropicProvider;
