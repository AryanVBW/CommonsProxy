/**
 * GitHub Models Provider
 *
 * Implements authentication via GitHub Personal Access Token (PAT).
 * Supports models from GitHub Models marketplace.
 */

import BaseProvider from './base-provider.js';

export class GitHubProvider extends BaseProvider {
    constructor(config = {}) {
        super('github', 'GitHub Models', {
            apiEndpoint: config.apiEndpoint || 'https://models.inference.ai.azure.com',
            modelsEndpoint: config.modelsEndpoint || 'https://api.github.com/models',
            ...config
        });
    }

    /**
     * Validate GitHub PAT
     *
     * @param {Object} account - Account with apiKey (PAT)
     * @returns {Promise<{valid: boolean, error?: string, email?: string}>}
     */
    async validateCredentials(account) {
        if (!account.apiKey) {
            return { valid: false, error: 'Missing Personal Access Token' };
        }

        try {
            // Verify PAT by fetching user info
            const response = await fetch('https://api.github.com/user', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${account.apiKey}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            if (!response.ok) {
                const error = await response.text();
                return { valid: false, error: `PAT validation failed: ${error}` };
            }

            const userData = await response.json();
            const email = userData.email || `${userData.login}@github`;

            return { valid: true, email };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get PAT (for GitHub, PAT IS the access token)
     *
     * @param {Object} account - Account with apiKey (PAT)
     * @returns {Promise<string>} PAT
     */
    async getAccessToken(account) {
        if (!account.apiKey) {
            throw new Error('Account missing Personal Access Token');
        }
        return account.apiKey;
    }

    /**
     * Fetch usage/quota information from GitHub Models API
     *
     * @param {Object} account - Account object
     * @param {string} token - PAT
     * @returns {Promise<Object>} Quota data
     */
    async getQuotas(account, token) {
        try {
            // Fetch available models from GitHub
            const response = await fetch(this.config.modelsEndpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const models = await response.json();
            const quotaData = {};

            // GitHub Models has rate limits per model
            // Default quota assumption since GitHub doesn't expose usage API
            if (Array.isArray(models)) {
                models.forEach(model => {
                    quotaData[model.name] = {
                        remainingFraction: 1.0, // Unknown - assume available
                        resetTime: null
                    };
                });
            }

            // Add common models if list is empty
            if (Object.keys(quotaData).length === 0) {
                const commonModels = [
                    'gpt-4o',
                    'gpt-4o-mini',
                    'claude-3-5-sonnet',
                    'gemini-1.5-pro',
                    'gemini-1.5-flash',
                    'llama-3.1-405b-instruct',
                    'mistral-large'
                ];
                commonModels.forEach(modelId => {
                    quotaData[modelId] = {
                        remainingFraction: 1.0,
                        resetTime: null
                    };
                });
            }

            return { models: quotaData };
        } catch (error) {
            this.error('Failed to fetch quotas', error);
            // Return default quota on error
            return {
                models: {
                    'gpt-4o': { remainingFraction: 1.0, resetTime: null },
                    'claude-3-5-sonnet': { remainingFraction: 1.0, resetTime: null }
                }
            };
        }
    }

    /**
     * Get subscription tier (GitHub Models is free for developers)
     *
     * @param {Object} account - Account object
     * @param {string} token - PAT
     * @returns {Promise<{tier: string, projectId: null}>}
     */
    async getSubscriptionTier(account, token) {
        try {
            // Check GitHub user/org details
            const response = await fetch('https://api.github.com/user', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            if (!response.ok) {
                return { tier: 'unknown', projectId: null };
            }

            const userData = await response.json();

            // GitHub Copilot subscribers likely have higher rate limits
            // But we can't directly check subscription status via API
            // Default to "developer" tier
            return {
                tier: userData.plan?.name || 'developer',
                projectId: userData.login
            };
        } catch (error) {
            this.error('Failed to fetch subscription tier', error);
            return { tier: 'developer', projectId: null };
        }
    }

    /**
     * Get available models from GitHub Models
     *
     * @param {Object} account - Account object
     * @param {string} token - PAT
     * @returns {Promise<Array>} List of available models
     */
    async getAvailableModels(account, token) {
        try {
            const response = await fetch(this.config.modelsEndpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const models = await response.json();
            if (Array.isArray(models)) {
                return models.map(model => {
                    // Determine family from model name
                    let family = 'unknown';
                    if (model.name.includes('gpt')) family = 'gpt';
                    else if (model.name.includes('claude')) family = 'claude';
                    else if (model.name.includes('gemini')) family = 'gemini';
                    else if (model.name.includes('llama')) family = 'llama';
                    else if (model.name.includes('mistral')) family = 'mistral';

                    return {
                        id: model.name,
                        name: model.summary || model.name,
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
     * Parse GitHub API rate limit headers
     *
     * @param {Response} response - Fetch response
     * @param {Object} errorData - Error data from response body
     * @returns {Object|null} Rate limit info
     */
    parseRateLimitInfo(response, errorData = null) {
        // GitHub uses these headers:
        // - x-ratelimit-limit
        // - x-ratelimit-remaining
        // - x-ratelimit-reset (Unix timestamp)
        // - x-ratelimit-resource

        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        const retryAfter = response.headers.get('retry-after');

        if (rateLimitReset) {
            const resetTimestamp = parseInt(rateLimitReset, 10);
            return {
                resetTime: new Date(resetTimestamp * 1000),
                retryAfter: Math.max(0, Math.floor((resetTimestamp * 1000 - Date.now()) / 1000))
            };
        }

        if (retryAfter) {
            const retrySeconds = parseInt(retryAfter, 10);
            return {
                resetTime: new Date(Date.now() + retrySeconds * 1000),
                retryAfter: retrySeconds
            };
        }

        // Check error response
        if (errorData?.message && errorData.message.includes('rate limit')) {
            return {
                resetTime: new Date(Date.now() + 3600000), // Default: 1 hour
                retryAfter: 3600
            };
        }

        return null;
    }

    /**
     * Check if error indicates invalid PAT
     *
     * @param {Error} error - Error object
     * @returns {boolean}
     */
    shouldInvalidateCredentials(error) {
        if (error.message && (
            error.message.includes('Bad credentials') ||
            error.message.includes('Requires authentication') ||
            error.message.includes('Invalid token')
        )) {
            return true;
        }

        return super.shouldInvalidateCredentials(error);
    }
}

export default GitHubProvider;
