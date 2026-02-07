/**
 * Provider Setup
 * 
 * Initializes and registers all available providers.
 * Called during server startup.
 */

import { registerProvider, listProviders, getAllAuthProviders } from './index.js';
import { CloudCodeProvider } from './cloudcode.js';
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Initialize all providers
 * Registers built-in messaging providers and any custom providers from config.
 * Note: Authentication providers (Google, Anthropic, OpenAI, GitHub, Copilot)
 * are registered automatically in providers/index.js
 */
export function initializeProviders() {
    logger.info('[Providers] Initializing provider system...');
    
    // Register built-in messaging providers (for request routing)
    registerProvider(CloudCodeProvider);
    
    // Register custom OpenAI-compatible providers from config
    const customProviders = config?.providers?.custom || [];
    for (const providerConfig of customProviders) {
        if (providerConfig.enabled !== false) {
            try {
                const provider = createOpenAICompatibleProvider(providerConfig);
                registerProvider(provider);
            } catch (error) {
                logger.error(`[Providers] Failed to register custom provider ${providerConfig.id}: ${error.message}`);
            }
        }
    }
    
    // Log registered providers
    const messagingProviders = listProviders();
    const authProviders = getAllAuthProviders();
    logger.success(`[Providers] Initialized ${messagingProviders.length} messaging provider(s): ${messagingProviders.map(p => p.id).join(', ')}`);
    logger.success(`[Providers] ${authProviders.length} auth provider(s) available: ${authProviders.map(p => p.id).join(', ')}`);
    
    return messagingProviders;
}

/**
 * Get provider configuration schema
 * Used for WebUI settings
 */
export function getProviderConfigSchema() {
    return {
        cloudcode: {
            name: 'Google Cloud Code',
            description: 'Default provider using Google Cloud Code API',
            configurable: false // Always enabled
        },
        copilot: {
            name: 'GitHub Copilot',
            description: 'Use GitHub Copilot API for model access',
            fields: [
                { key: 'enabled', type: 'boolean', label: 'Enable GitHub Copilot', default: false }
            ]
        },
        custom: {
            name: 'Custom OpenAI-Compatible',
            description: 'Add custom OpenAI-compatible API endpoints',
            fields: [
                { key: 'id', type: 'string', label: 'Provider ID', required: true },
                { key: 'name', type: 'string', label: 'Display Name', required: true },
                { key: 'baseUrl', type: 'string', label: 'API Base URL', required: true },
                { key: 'apiKey', type: 'password', label: 'API Key', required: false },
                { key: 'enabled', type: 'boolean', label: 'Enabled', default: true }
            ]
        }
    };
}

export default {
    initializeProviders,
    getProviderConfigSchema
};
