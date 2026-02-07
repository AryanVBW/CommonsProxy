/**
 * Provider System for CommonsProxy
 * 
 * Multi-provider support inspired by opencode's provider architecture.
 * Allows CommonsProxy to work with multiple AI backends:
 * - Google Cloud Code (OAuth, default)
 * - Anthropic (API key)
 * - OpenAI (API key)
 * - GitHub Models (PAT)
 * - GitHub Copilot
 * - OpenAI-compatible endpoints
 * - Custom providers
 */

import { logger } from '../utils/logger.js';
import GoogleProvider from './google-provider.js';
import AnthropicProvider from './anthropic-provider.js';
import OpenAIProvider from './openai-provider.js';
import GitHubProvider from './github-provider.js';
import CopilotProvider from './copilot.js';
import OpenRouterProvider from './openrouter-provider.js';
import CodexProvider from './codex-provider.js';

// Provider registry (legacy system for message routing providers)
const messagingProviders = new Map();

// Authentication provider registry (new system)
const authProviders = new Map();

// Initialize authentication providers
authProviders.set('google', new GoogleProvider());
authProviders.set('anthropic', new AnthropicProvider());
authProviders.set('openai', new OpenAIProvider());
authProviders.set('github', new GitHubProvider());
authProviders.set('copilot', new CopilotProvider());
authProviders.set('openrouter', new OpenRouterProvider());
authProviders.set('codex', new CodexProvider());

/**
 * Provider interface definition
 * Each provider must implement these methods
 */
export const ProviderInterface = {
    id: 'string',           // Unique provider ID
    name: 'string',         // Display name
    type: 'string',         // Provider type: 'cloudcode', 'copilot', 'openai', 'custom'
    
    // Required methods
    // authenticate: async (credentials) => { accessToken, refreshToken, expiresAt }
    // sendMessage: async (request, options) => response
    // sendMessageStream: async function* (request, options) => yields events
    // listModels: async () => [{ id, name, capabilities }]
};

/**
 * Register a legacy messaging provider
 * @param {Object} provider - Provider implementation
 */
export function registerProvider(provider) {
    if (!provider.id || !provider.name) {
        throw new Error('Provider must have id and name');
    }
    messagingProviders.set(provider.id, provider);
    logger.info(`[Providers] Registered messaging provider: ${provider.name} (${provider.id})`);
}

/**
 * Get a legacy messaging provider by ID
 * @param {string} id - Provider ID
 * @returns {Object|null} Provider or null
 */
export function getProvider(id) {
    return messagingProviders.get(id) || null;
}

/**
 * Get authentication provider by ID
 * @param {string} providerId - Provider identifier ('google', 'anthropic', 'openai', 'github')
 * @returns {BaseProvider} Provider instance
 */
export function getAuthProvider(providerId) {
    const provider = authProviders.get(providerId);
    if (!provider) {
        throw new Error(`Unknown auth provider: ${providerId}`);
    }
    return provider;
}

/**
 * Get authentication provider for an account
 * @param {Object} account - Account object with provider field
 * @returns {BaseProvider} Provider instance
 */
export function getProviderForAccount(account) {
    // Determine provider from account source or explicit provider field
    const providerId = account.provider || detectProviderFromSource(account.source);
    return getAuthProvider(providerId);
}

/**
 * Detect provider from legacy source field
 * @param {string} source - Account source ('oauth', 'manual', 'database')
 * @returns {string} Provider ID
 */
function detectProviderFromSource(source) {
    // Legacy accounts use 'oauth' or 'database' for Google OAuth
    if (source === 'oauth' || source === 'database') {
        return 'google';
    }
    // Manual accounts default to Google (legacy behavior)
    if (source === 'manual') {
        return 'google';
    }
    // Default to Google
    return 'google';
}

/**
 * Register a custom authentication provider
 * @param {string} id - Provider ID
 * @param {BaseProvider} provider - Provider instance
 */
export function registerAuthProvider(id, provider) {
    authProviders.set(id, provider);
    logger.info(`[Providers] Registered auth provider: ${provider.name} (${id})`);
}

/**
 * Get list of all available authentication providers
 * @returns {Array<{id: string, name: string, authType: string}>} Provider list
 */
export function getAllAuthProviders() {
    const deviceAuthProviders = new Set(['copilot', 'codex']);
    return Array.from(authProviders.entries()).map(([id, provider]) => ({
        id,
        name: provider.name,
        authType: id === 'google' ? 'oauth' : (deviceAuthProviders.has(id) ? 'device-auth' : 'api-key')
    }));
}

/**
 * List all registered legacy messaging providers
 * @returns {Array} Array of provider info
 */
export function listProviders() {
    return Array.from(messagingProviders.values()).map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        enabled: p.enabled !== false
    }));
}

/**
 * Get the default provider
 * @returns {Object} Default provider (cloudcode)
 */
export function getDefaultProvider() {
    return messagingProviders.get('cloudcode') || messagingProviders.values().next().value;
}

/**
 * Check if an authentication provider is registered
 * @param {string} providerId - Provider ID to check
 * @returns {boolean} True if provider exists
 */
export function hasAuthProvider(providerId) {
    return authProviders.has(providerId);
}

/**
 * Provider types enum
 */
export const ProviderType = {
    CLOUDCODE: 'cloudcode',
    COPILOT: 'copilot',
    OPENROUTER: 'openrouter',
    ANTHROPIC: 'anthropic',
    GITHUB: 'github',
    CUSTOM: 'custom'
};

// Export provider classes for direct instantiation if needed
export {
    GoogleProvider,
    AnthropicProvider,
    OpenAIProvider,
    GitHubProvider,
    CopilotProvider,
    OpenRouterProvider,
    CodexProvider
};

export default {
    // Legacy messaging provider functions
    registerProvider,
    getProvider,
    listProviders,
    getDefaultProvider,
    // New authentication provider functions
    getAuthProvider,
    getProviderForAccount,
    registerAuthProvider,
    getAllAuthProviders,
    hasAuthProvider,
    // Provider classes
    GoogleProvider,
    AnthropicProvider,
    OpenAIProvider,
    GitHubProvider,
    CopilotProvider,
    OpenRouterProvider,
    CodexProvider,
    // Enums
    ProviderType
};
