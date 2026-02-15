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
// Client ID from opencode's copilot plugin (newer OAuth app)
const COPILOT_CLIENT_ID = 'Ov23li8tweQw6odWQebz';
const COPILOT_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const COPILOT_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_API_URL = 'https://api.githubcopilot.com';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

// Polling safety margin to avoid hitting the server too early (from opencode)
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;


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

            const email = userData.email || `${userData.login}@github`;
            return { valid: true, email };
        } catch (error) {
            this.error('Credential validation failed', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get access token for Copilot API requests.
     * Following opencode's approach: use the GitHub OAuth token directly
     * as Bearer auth with proper Copilot headers.
     *
     * @param {Object} account - Account with apiKey (GitHub access token)
     * @returns {Promise<string>} GitHub access token (used directly as Bearer)
     */
    async getAccessToken(account) {
        if (!account.apiKey) {
            throw new Error('Account missing GitHub access token');
        }

        // opencode uses the GitHub token directly as Bearer auth
        // with Copilot-specific headers, no separate token exchange needed
        return account.apiKey;
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
        // Return current Copilot models with full availability
        // Updated 2026-02-15 from models.dev/api.json
        const defaultModels = [
            'claude-sonnet-4', 'claude-sonnet-4.5', 'claude-haiku-4.5',
            'claude-opus-41', 'claude-opus-4.5', 'claude-opus-4.6',
            'gpt-4o', 'gpt-4.1',
            'gpt-5', 'gpt-5-mini', 'gpt-5.1',
            'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5.1-codex-max',
            'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.3-codex',
            'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview',
            'grok-code-fast-1'
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
     * Updated model list to match current Copilot offerings (aligned with opencode)
     *
     * @param {Object} account - Account object
     * @param {string} token - Copilot API token
     * @returns {Promise<Array>} List of available models
     */
    async getAvailableModels(account, token) {
        // Updated 2026-02-15 from models.dev/api.json → "github-copilot" → "models"
        return [
            // Claude (Anthropic)
            { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', family: 'claude-sonnet' },
            { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', family: 'claude-sonnet' },
            { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', family: 'claude-haiku' },
            { id: 'claude-opus-41', name: 'Claude Opus 4.1', family: 'claude-opus' },
            { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', family: 'claude-opus' },
            { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', family: 'claude-opus' },
            // GPT (OpenAI)
            { id: 'gpt-4o', name: 'GPT-4o', family: 'gpt' },
            { id: 'gpt-4.1', name: 'GPT-4.1', family: 'gpt' },
            { id: 'gpt-5', name: 'GPT-5', family: 'gpt' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini', family: 'gpt-mini' },
            { id: 'gpt-5.1', name: 'GPT-5.1', family: 'gpt' },
            { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', family: 'gpt-codex' },
            { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', family: 'gpt-codex' },
            { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', family: 'gpt-codex' },
            { id: 'gpt-5.2', name: 'GPT-5.2', family: 'gpt' },
            { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', family: 'gpt-codex' },
            { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', family: 'gpt-codex' },
            // Gemini (Google)
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', family: 'gemini-pro' },
            { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', family: 'gemini-flash' },
            { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', family: 'gemini-pro' },
            // Grok (xAI)
            { id: 'grok-code-fast-1', name: 'Grok Code Fast 1', family: 'grok' }
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
     * Refresh Copilot credentials by re-validating the GitHub token.
     * GitHub OAuth tokens from device auth don't have a refresh token mechanism,
     * but we can verify the token is still valid and attempt to get a fresh
     * Copilot session token from the internal token endpoint.
     *
     * @param {Object} account - Account with apiKey (GitHub access token)
     * @returns {Promise<Object>} Updated account object
     */
    async refreshCredentials(account) {
        if (!account.apiKey) {
            return account;
        }

        try {
            // Step 1: Verify the GitHub token is still valid
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
                const errorText = await userResponse.text();
                throw new Error(`GitHub token expired or revoked (${userResponse.status}): ${errorText}`);
            }

            // Step 2: Exchange for a fresh Copilot session token to verify Copilot access
            const tokenUrl = this.config.tokenUrl || COPILOT_TOKEN_URL;
            const tokenResponse = await fetch(tokenUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `token ${account.apiKey}`,
                    'Accept': 'application/json',
                    'User-Agent': 'commons-proxy/2.0.0'
                }
            });

            if (!tokenResponse.ok) {
                this.debug(`Copilot token exchange returned ${tokenResponse.status} — GitHub token may lack Copilot access`);
                // Token is valid for GitHub but may not have Copilot access
                // Don't throw — the account can still be used with direct Bearer auth
            }

            this.debug('Credentials refreshed successfully');
            return account;
        } catch (error) {
            this.error('Failed to refresh Copilot credentials', error);
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
     * Uses the same flow as opencode's copilot plugin
     * @param {string} [domain='github.com'] - GitHub domain (for Enterprise support)
     * @returns {Promise<Object>} Device code response with verification_uri and user_code
     */
    static async initiateDeviceAuth(domain = 'github.com') {
        const deviceCodeUrl = `https://${domain}/login/device/code`;
        const response = await fetch(deviceCodeUrl, {
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
     * Matches opencode's polling logic with proper slow_down handling per RFC 8628
     * @param {string} deviceCode - Device code from initiateDeviceAuth
     * @param {number} interval - Polling interval in seconds
     * @param {AbortSignal} [signal] - Optional abort signal
     * @param {string} [domain='github.com'] - GitHub domain (for Enterprise support)
     * @returns {Promise<Object>} { accessToken, tokenType }
     */
    static async pollForToken(deviceCode, interval = 5, signal = null, domain = 'github.com') {
        const accessTokenUrl = `https://${domain}/login/oauth/access_token`;

        while (true) {
            if (signal?.aborted) {
                throw new Error('Device auth polling aborted');
            }

            await new Promise(resolve => setTimeout(resolve, interval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS));

            const response = await fetch(accessTokenUrl, {
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
                return { accessToken: null, error: 'failed' };
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
                // Per RFC 8628 section 3.5: add 5 seconds to current polling interval
                interval += 5;
                // Use server-provided interval if available
                if (data.interval && typeof data.interval === 'number' && data.interval > 0) {
                    interval = data.interval;
                }
                continue;
            }

            if (data.error === 'expired_token') {
                throw new Error('Device code expired. Please try again.');
            }

            if (data.error) {
                throw new Error(`OAuth error: ${data.error_description || data.error}`);
            }
        }
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

    /**
     * Build request headers for Copilot API calls.
     * Matches opencode's copilot plugin header format.
     *
     * @param {string} githubToken - GitHub OAuth access token
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.isAgent=false] - Whether this is an agent-initiated request
     * @param {boolean} [options.isVision=false] - Whether this request contains vision content
     * @returns {Object} Headers object
     */
    static buildCopilotHeaders(githubToken, options = {}) {
        const headers = {
            'Authorization': `Bearer ${githubToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'commons-proxy/2.0.0',
            'Openai-Intent': 'conversation-edits',
            'x-initiator': options.isAgent ? 'agent' : 'user'
        };

        if (options.isVision) {
            headers['Copilot-Vision-Request'] = 'true';
        }

        return headers;
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
