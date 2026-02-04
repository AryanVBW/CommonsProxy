/**
 * OpenAI API Provider
 *
 * Implements authentication via OpenAI API keys.
 * Supports GPT models via direct OpenAI API.
 */

import BaseProvider from './base-provider.js';

export class OpenAIProvider extends BaseProvider {
    constructor(config = {}) {
        super('openai', 'OpenAI', {
            apiEndpoint: config.apiEndpoint || 'https://api.openai.com',
            ...config
        });
    }

    /**
     * Validate OpenAI API key
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
                    'Authorization': `Bearer ${account.apiKey}`
                }
            });

            if (!response.ok) {
                const error = await response.text();
                return { valid: false, error: `API key validation failed: ${error}` };
            }

            // OpenAI doesn't provide email in API, use a placeholder
            const email = account.email || `openai-${account.apiKey.slice(0, 8)}`;

            return { valid: true, email };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get API key (for OpenAI, API key IS the access token)
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
     * Fetch usage/quota information from OpenAI API
     * Note: OpenAI usage API requires organization key
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<Object>} Quota data
     */
    async getQuotas(account, token) {
        try {
            const endpoint = account.customApiEndpoint || this.config.apiEndpoint;

            // Fetch available models
            const response = await fetch(`${endpoint}/v1/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            const models = {};

            // Create default quota entries for GPT models
            if (data.data && Array.isArray(data.data)) {
                data.data
                    .filter(model => model.id.includes('gpt'))
                    .forEach(model => {
                        models[model.id] = {
                            remainingFraction: 1.0, // Default: full quota (no easy API to check actual)
                            resetTime: null // Unknown
                        };
                    });
            }

            // If no models found, add common GPT models
            if (Object.keys(models).length === 0) {
                const commonModels = [
                    'gpt-4-turbo-preview',
                    'gpt-4',
                    'gpt-4-32k',
                    'gpt-3.5-turbo',
                    'gpt-4o',
                    'gpt-4o-mini'
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
                    'gpt-4': { remainingFraction: 1.0, resetTime: null },
                    'gpt-4-turbo-preview': { remainingFraction: 1.0, resetTime: null },
                    'gpt-3.5-turbo': { remainingFraction: 1.0, resetTime: null }
                }
            };
        }
    }

    /**
     * Get subscription tier (OpenAI uses usage-based pricing)
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<{tier: string, projectId: null}>}
     */
    async getSubscriptionTier(account, token) {
        // OpenAI uses usage-based pricing with different tier limits based on usage history
        // We could potentially check the organization endpoint if available
        return { tier: 'usage-based', projectId: null };
    }

    /**
     * Get available GPT models
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
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                return data.data
                    .filter(model => model.id.includes('gpt'))
                    .map(model => ({
                        id: model.id,
                        name: model.id,
                        family: 'gpt'
                    }));
            }

            return [];
        } catch (error) {
            this.error('Failed to fetch available models', error);
            return [];
        }
    }

    /**
     * Parse OpenAI rate limit headers
     *
     * @param {Response} response - Fetch response
     * @param {Object} errorData - Error data from response body
     * @returns {Object|null} Rate limit info
     */
    parseRateLimitInfo(response, errorData = null) {
        // OpenAI uses these headers:
        // - x-ratelimit-limit-requests
        // - x-ratelimit-remaining-requests
        // - x-ratelimit-reset-requests
        // - x-ratelimit-limit-tokens
        // - x-ratelimit-remaining-tokens
        // - x-ratelimit-reset-tokens

        const requestsReset = response.headers.get('x-ratelimit-reset-requests');
        const tokensReset = response.headers.get('x-ratelimit-reset-tokens');

        // Reset headers are in format like "1s", "10ms", etc.
        const parseResetDuration = (resetStr) => {
            if (!resetStr) return null;
            const match = resetStr.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);
            if (!match) return null;

            const [, value, unit] = match;
            const num = parseFloat(value);

            const multipliers = {
                'ms': 1,
                's': 1000,
                'm': 60000,
                'h': 3600000
            };

            const ms = num * (multipliers[unit] || 1000);
            return new Date(Date.now() + ms);
        };

        const resets = [requestsReset, tokensReset]
            .map(parseResetDuration)
            .filter(Boolean);

        if (resets.length > 0) {
            const latestReset = new Date(Math.max(...resets));
            return {
                resetTime: latestReset,
                retryAfter: Math.max(0, Math.floor((latestReset - Date.now()) / 1000))
            };
        }

        // Check error response for rate limit info
        if (errorData?.error?.type === 'rate_limit_exceeded') {
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
            error.message.includes('Incorrect API key') ||
            error.message.includes('authentication')
        )) {
            return true;
        }

        return super.shouldInvalidateCredentials(error);
    }
}

export default OpenAIProvider;
