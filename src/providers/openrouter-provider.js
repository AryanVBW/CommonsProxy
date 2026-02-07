/**
 * OpenRouter API Provider
 *
 * Implements authentication via OpenRouter API keys.
 * OpenRouter provides a unified API for hundreds of AI models
 * through a single OpenAI-compatible endpoint.
 *
 * API Base: https://openrouter.ai/api/v1
 * Auth: Bearer token (API key)
 * Models endpoint: GET /api/v1/models
 * Chat endpoint: POST /api/v1/chat/completions
 */

import BaseProvider from './base-provider.js';

export class OpenRouterProvider extends BaseProvider {
    constructor(config = {}) {
        super('openrouter', 'OpenRouter', {
            apiEndpoint: config.apiEndpoint || 'https://openrouter.ai/api/v1',
            ...config
        });
    }

    /**
     * Validate OpenRouter API key by fetching the auth/key endpoint
     *
     * @param {Object} account - Account with apiKey
     * @returns {Promise<{valid: boolean, error?: string, email?: string}>}
     */
    async validateCredentials(account) {
        if (!account.apiKey) {
            return { valid: false, error: 'Missing API key' };
        }

        try {
            // OpenRouter provides an auth/key endpoint to validate keys
            const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${account.apiKey}`,
                    'HTTP-Referer': 'https://github.com/AryanVBW/CommonsProxy',
                    'X-Title': 'CommonsProxy'
                }
            });

            if (!response.ok) {
                const error = await response.text();
                return { valid: false, error: `API key validation failed (${response.status}): ${error}` };
            }

            const data = await response.json();

            // Use the label from the key data, or generate an identifier
            const email = account.email || data.data?.label || `openrouter-${account.apiKey.slice(-8)}`;

            return { valid: true, email };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get API key (for OpenRouter, API key IS the access token)
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
     * Fetch usage/quota information from OpenRouter
     * OpenRouter provides credit-based usage info via /api/v1/auth/key
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<Object>} Quota data
     */
    async getQuotas(account, token) {
        try {
            // Fetch key info for credit/usage data
            const keyResponse = await fetch('https://openrouter.ai/api/v1/auth/key', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'HTTP-Referer': 'https://github.com/AryanVBW/CommonsProxy',
                    'X-Title': 'CommonsProxy'
                }
            });

            let creditFraction = 1.0;
            if (keyResponse.ok) {
                const keyData = await keyResponse.json();
                // keyData.data has: { label, usage, limit, is_free_tier, rate_limit }
                const usage = keyData.data?.usage || 0;
                const limit = keyData.data?.limit || null;
                if (limit && limit > 0) {
                    creditFraction = Math.max(0, (limit - usage) / limit);
                }
            }

            // Fetch available models
            const modelsResponse = await fetch('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'HTTP-Referer': 'https://github.com/AryanVBW/CommonsProxy',
                    'X-Title': 'CommonsProxy'
                }
            });

            const models = {};

            if (modelsResponse.ok) {
                const modelsData = await modelsResponse.json();
                if (modelsData.data && Array.isArray(modelsData.data)) {
                    // Include popular Claude, GPT, and other models
                    const relevantModels = modelsData.data.filter(model => {
                        const id = model.id.toLowerCase();
                        return id.includes('claude') ||
                               id.includes('gpt') ||
                               id.includes('gemini') ||
                               id.includes('llama') ||
                               id.includes('mistral') ||
                               id.includes('deepseek') ||
                               id.includes('qwen');
                    });

                    // Limit to top 50 most relevant models to avoid overwhelming the UI
                    relevantModels.slice(0, 50).forEach(model => {
                        models[model.id] = {
                            remainingFraction: creditFraction,
                            resetTime: null
                        };
                    });
                }
            }

            // If no models found, add common defaults
            if (Object.keys(models).length === 0) {
                const defaultModels = [
                    'anthropic/claude-sonnet-4',
                    'anthropic/claude-3.5-sonnet',
                    'openai/gpt-4o',
                    'openai/gpt-4o-mini',
                    'google/gemini-2.5-pro-preview',
                    'meta-llama/llama-3.1-405b-instruct',
                    'deepseek/deepseek-r1'
                ];
                defaultModels.forEach(modelId => {
                    models[modelId] = {
                        remainingFraction: creditFraction,
                        resetTime: null
                    };
                });
            }

            return { models };
        } catch (error) {
            this.error('Failed to fetch quotas', error);
            return {
                models: {
                    'anthropic/claude-sonnet-4': { remainingFraction: 1.0, resetTime: null },
                    'openai/gpt-4o': { remainingFraction: 1.0, resetTime: null }
                }
            };
        }
    }

    /**
     * Get subscription tier from OpenRouter key info
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<{tier: string, projectId: null}>}
     */
    async getSubscriptionTier(account, token) {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'HTTP-Referer': 'https://github.com/AryanVBW/CommonsProxy',
                    'X-Title': 'CommonsProxy'
                }
            });

            if (response.ok) {
                const data = await response.json();
                const isFreeTier = data.data?.is_free_tier || false;
                return {
                    tier: isFreeTier ? 'free' : 'paid',
                    projectId: null
                };
            }
        } catch (error) {
            this.debug('Failed to fetch subscription tier', error.message);
        }

        return { tier: 'unknown', projectId: null };
    }

    /**
     * Get available models from OpenRouter
     *
     * @param {Object} account - Account object
     * @param {string} token - API key
     * @returns {Promise<Array>} List of available models
     */
    async getAvailableModels(account, token) {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'HTTP-Referer': 'https://github.com/AryanVBW/CommonsProxy',
                    'X-Title': 'CommonsProxy'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                return data.data.map(model => {
                    const id = model.id.toLowerCase();
                    let family = 'other';
                    if (id.includes('claude')) family = 'claude';
                    else if (id.includes('gpt')) family = 'gpt';
                    else if (id.includes('gemini')) family = 'gemini';
                    else if (id.startsWith('o1') || id.startsWith('o3')) family = 'o1';
                    else if (id.includes('llama')) family = 'llama';
                    else if (id.includes('mistral')) family = 'mistral';
                    else if (id.includes('deepseek')) family = 'deepseek';

                    return {
                        id: model.id,
                        name: model.name || model.id,
                        family
                    };
                });
            }

            return [];
        } catch (error) {
            this.error('Failed to fetch available models', error);
            return [];
        }
    }

    /**
     * Parse OpenRouter rate limit headers
     * OpenRouter uses standard rate limit headers
     *
     * @param {Response} response - Fetch response
     * @param {Object} errorData - Error data from response body
     * @returns {Object|null} Rate limit info
     */
    parseRateLimitInfo(response, errorData = null) {
        // OpenRouter uses these headers:
        // x-ratelimit-limit-requests
        // x-ratelimit-remaining-requests
        // x-ratelimit-reset-requests
        const resetRequests = response.headers.get('x-ratelimit-reset-requests');
        const retryAfter = response.headers.get('retry-after');

        if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
                return {
                    resetTime: new Date(Date.now() + seconds * 1000),
                    retryAfter: seconds
                };
            }
        }

        if (resetRequests) {
            const resetDate = new Date(resetRequests);
            if (!isNaN(resetDate.getTime())) {
                return {
                    resetTime: resetDate,
                    retryAfter: Math.max(0, Math.floor((resetDate - Date.now()) / 1000))
                };
            }
        }

        // Check error response for rate limit info
        if (errorData?.error?.code === 429 || errorData?.error?.message?.includes('rate limit')) {
            return {
                resetTime: new Date(Date.now() + 60000),
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
            error.message.includes('Invalid API key') ||
            error.message.includes('No auth credentials found') ||
            error.message.includes('authentication')
        )) {
            return true;
        }

        return super.shouldInvalidateCredentials(error);
    }
}

export default OpenRouterProvider;
