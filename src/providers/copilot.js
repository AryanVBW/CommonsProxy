/**
 * GitHub Copilot Provider
 *
 * Enables CommonsProxy to work with GitHub Copilot's API.
 * Uses GitHub Device Authorization flow for authentication,
 * then exchanges the GitHub token for a Copilot API token.
 *
 * Inspired by opencode's copilot plugin implementation.
 */

import BaseProvider from './base-provider.js';

// GitHub Copilot OAuth configuration
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const COPILOT_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const COPILOT_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_API_URL = 'https://api.githubcopilot.com';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

// In-memory cache for short-lived Copilot API tokens
// Maps GitHub access token -> { token, expiresAt }
const copilotTokenCache = new Map();

export class CopilotProvider extends BaseProvider {
    constructor(config = {}) {
        super('copilot', 'GitHub Copilot', {
            clientId: COPILOT_CLIENT_ID,
            deviceCodeUrl: COPILOT_DEVICE_CODE_URL,
            accessTokenUrl: COPILOT_ACCESS_TOKEN_URL,
            apiUrl: config.apiUrl || COPILOT_API_URL,
            tokenUrl: config.tokenUrl || COPILOT_TOKEN_URL,
            ...config
        });
    }

    /**
     * Validate Copilot credentials by attempting to get a Copilot API token
     *
     * @param {Object} account - Account with apiKey (GitHub access token)
     * @returns {Promise<{valid: boolean, error?: string, email?: string}>}
     */
    async validateCredentials(account) {
        if (!account.apiKey) {
            return { valid: false, error: 'Missing GitHub access token' };
        }

        try {
            // Verify by fetching user info
            const userResponse = await fetch('https://api.github.com/user', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${account.apiKey}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'commons-proxy/2.0.0',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            if (!userResponse.ok) {
                const error = await userResponse.text();
                return { valid: false, error: `GitHub token validation failed: ${error}` };
            }

            const userData = await userResponse.json();

            // Try to get a Copilot token to verify Copilot access
            try {
                await this._getCopilotToken(account.apiKey);
            } catch (copilotError) {
                return {
                    valid: false,
                    error: `GitHub token valid but Copilot access denied: ${copilotError.message}. Ensure you have an active GitHub Copilot subscription.`
                };
            }

            const email = userData.email || `${userData.login}@github`;
            return { valid: true, email };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get Copilot API token from the stored GitHub access token.
     * Copilot tokens are short-lived (~30 min), so we cache and refresh.
     *
     * @param {Object} account - Account with apiKey (GitHub access token)
     * @returns {Promise<string>} Copilot API token
     */
    async getAccessToken(account) {
        if (!account.apiKey) {
            throw new Error('Account missing GitHub access token');
        }

        const copilotToken = await this._getCopilotToken(account.apiKey);
        return copilotToken;
    }

    /**
     * Internal: Get or refresh Copilot API token
     *
     * @param {string} githubToken - GitHub OAuth access token
     * @returns {Promise<string>} Copilot API token
     */
    async _getCopilotToken(githubToken) {
        // Check cache
        const cached = copilotTokenCache.get(githubToken);
        if (cached && cached.expiresAt > Date.now() + 60000) {
            // Return cached token if it has > 1 minute left
            return cached.token;
        }

        const response = await fetch(this.config.tokenUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'User-Agent': 'commons-proxy/2.0.0',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to get Copilot token: ${response.status} ${text}`);
        }

        const data = await response.json();
        const expiresAt = data.expires_at
            ? new Date(data.expires_at * 1000).getTime()
            : Date.now() + 30 * 60 * 1000; // Default 30 min

        copilotTokenCache.set(githubToken, {
            token: data.token,
            expiresAt
        });

        return data.token;
    }

    /**
     * Fetch quota information (Copilot doesn't expose usage API)
     *
     * @param {Object} account - Account object
     * @param {string} token - Copilot API token
     * @returns {Promise<Object>} Quota data
     */
    async getQuotas(account, token) {
        // Copilot doesn't expose quota/usage API
        // Return default models with full availability
        const defaultModels = [
            'gpt-4o', 'gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo',
            'claude-3.5-sonnet', 'o1-preview', 'o1-mini'
        ];

        const models = {};
        defaultModels.forEach(modelId => {
            models[modelId] = {
                remainingFraction: 1.0,
                resetTime: null
            };
        });

        return { models };
    }

    /**
     * Get subscription tier
     *
     * @param {Object} account - Account object
     * @param {string} token - Copilot API token
     * @returns {Promise<{tier: string, projectId: string|null}>}
     */
    async getSubscriptionTier(account, token) {
        try {
            // Use the stored GitHub token (apiKey), not the Copilot token
            const response = await fetch('https://api.github.com/user', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${account.apiKey}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'commons-proxy/2.0.0',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            if (!response.ok) {
                return { tier: 'copilot', projectId: null };
            }

            const userData = await response.json();
            return {
                tier: 'copilot',
                projectId: userData.login
            };
        } catch (error) {
            this.error('Failed to fetch subscription tier', error);
            return { tier: 'copilot', projectId: null };
        }
    }

    /**
     * Get available models from Copilot
     *
     * @param {Object} account - Account object
     * @param {string} token - Copilot API token
     * @returns {Promise<Array>} List of available models
     */
    async getAvailableModels(account, token) {
        return [
            { id: 'gpt-4o', name: 'GPT-4o', family: 'gpt' },
            { id: 'gpt-4', name: 'GPT-4', family: 'gpt' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', family: 'gpt' },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', family: 'gpt' },
            { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', family: 'claude' },
            { id: 'o1-preview', name: 'o1 Preview', family: 'o1' },
            { id: 'o1-mini', name: 'o1 Mini', family: 'o1' }
        ];
    }

    /**
     * Parse rate limit headers from Copilot API
     *
     * @param {Response} response - Fetch response
     * @param {Object} errorData - Error data from response body
     * @returns {Object|null} Rate limit info
     */
    parseRateLimitInfo(response, errorData = null) {
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

        return null;
    }

    /**
     * Check if error indicates invalid credentials
     *
     * @param {Error} error - Error object
     * @returns {boolean}
     */
    shouldInvalidateCredentials(error) {
        if (error.message && (
            error.message.includes('Bad credentials') ||
            error.message.includes('Requires authentication') ||
            error.message.includes('Invalid token') ||
            error.message.includes('Copilot access denied')
        )) {
            return true;
        }

        return super.shouldInvalidateCredentials(error);
    }

    // ============================================================================
    // Static Device Auth Flow Methods (used by WebUI and CLI)
    // ============================================================================

    /**
     * Initiate device authorization flow
     * @returns {Promise<Object>} Device code response with verification_uri and user_code
     */
    static async initiateDeviceAuth() {
        const response = await fetch(COPILOT_DEVICE_CODE_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'commons-proxy/2.0.0'
            },
            body: JSON.stringify({
                client_id: COPILOT_CLIENT_ID,
                scope: 'read:user'
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to initiate device authorization: ${response.status} ${text}`);
        }

        return response.json();
    }

    /**
     * Poll for access token after user completes device auth
     * @param {string} deviceCode - Device code from initiateDeviceAuth
     * @param {number} interval - Polling interval in seconds
     * @param {AbortSignal} [signal] - Optional abort signal
     * @returns {Promise<Object>} { accessToken, tokenType }
     */
    static async pollForToken(deviceCode, interval = 5, signal = null) {
        const maxAttempts = 60; // 5 minutes max

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (signal?.aborted) {
                throw new Error('Device auth polling aborted');
            }

            await new Promise(resolve => setTimeout(resolve, interval * 1000));

            const response = await fetch(COPILOT_ACCESS_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'commons-proxy/2.0.0'
                },
                body: JSON.stringify({
                    client_id: COPILOT_CLIENT_ID,
                    device_code: deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                })
            });

            if (!response.ok) {
                continue;
            }

            const data = await response.json();

            if (data.access_token) {
                return {
                    accessToken: data.access_token,
                    tokenType: data.token_type || 'bearer'
                };
            }

            if (data.error === 'authorization_pending') {
                continue;
            }

            if (data.error === 'slow_down') {
                interval += 5;
                continue;
            }

            if (data.error) {
                throw new Error(`OAuth error: ${data.error_description || data.error}`);
            }
        }

        throw new Error('Authorization timed out after 5 minutes');
    }

    /**
     * Get GitHub user info from access token
     * @param {string} accessToken - GitHub access token
     * @returns {Promise<Object>} User info { login, email, name }
     */
    static async getUserInfo(accessToken) {
        const response = await fetch('https://api.github.com/user', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'commons-proxy/2.0.0',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get user info: ${response.status}`);
        }

        const data = await response.json();
        return {
            login: data.login,
            email: data.email || `${data.login}@github`,
            name: data.name || data.login
        };
    }
}

// Export config constants for use by other modules
export const COPILOT_CONFIG = {
    clientId: COPILOT_CLIENT_ID,
    deviceCodeUrl: COPILOT_DEVICE_CODE_URL,
    accessTokenUrl: COPILOT_ACCESS_TOKEN_URL,
    apiUrl: COPILOT_API_URL,
    tokenUrl: COPILOT_TOKEN_URL
};

export default CopilotProvider;
