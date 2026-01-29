/**
 * Provider System for CommonsProxy
 * 
 * Multi-provider support inspired by opencode's provider architecture.
 * Allows CommonsProxy to work with multiple AI backends:
 * - Google Cloud Code (default)
 * - GitHub Copilot
 * - OpenAI-compatible endpoints
 * - Custom providers
 */

import { logger } from '../utils/logger.js';

// Provider registry
const providers = new Map();

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
 * Register a provider
 * @param {Object} provider - Provider implementation
 */
export function registerProvider(provider) {
    if (!provider.id || !provider.name) {
        throw new Error('Provider must have id and name');
    }
    providers.set(provider.id, provider);
    logger.info(`[Providers] Registered provider: ${provider.name} (${provider.id})`);
}

/**
 * Get a provider by ID
 * @param {string} id - Provider ID
 * @returns {Object|null} Provider or null
 */
export function getProvider(id) {
    return providers.get(id) || null;
}

/**
 * List all registered providers
 * @returns {Array} Array of provider info
 */
export function listProviders() {
    return Array.from(providers.values()).map(p => ({
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
    return providers.get('cloudcode') || providers.values().next().value;
}

/**
 * Provider types enum
 */
export const ProviderType = {
    CLOUDCODE: 'cloudcode',
    COPILOT: 'copilot',
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    CUSTOM: 'custom'
};

export default {
    registerProvider,
    getProvider,
    listProviders,
    getDefaultProvider,
    ProviderType
};
