/**
 * Google Cloud Code Provider
 * 
 * Default provider for CommonsProxy - uses Google's Cloud Code API
 * to access Claude and Gemini models.
 */

import { ProviderType } from './index.js';
import {
    CLOUDCODE_ENDPOINT_FALLBACKS,
    CLOUDCODE_HEADERS,
    OAUTH_CONFIG
} from '../constants.js';
import { sendMessage } from '../cloudcode/message-handler.js';
import { sendMessageStream } from '../cloudcode/streaming-handler.js';
import { fetchAvailableModels } from '../cloudcode/model-api.js';
import { logger } from '../utils/logger.js';

/**
 * Google Cloud Code Provider
 */
export const CloudCodeProvider = {
    id: 'cloudcode',
    name: 'Google Cloud Code',
    type: ProviderType.CLOUDCODE,
    enabled: true,
    
    /**
     * Provider configuration
     */
    config: {
        endpoints: CLOUDCODE_ENDPOINT_FALLBACKS,
        headers: CLOUDCODE_HEADERS,
        oauth: OAUTH_CONFIG
    },
    
    /**
     * Send a non-streaming message
     * @param {Object} request - Anthropic-format request
     * @param {Object} accountManager - Account manager instance
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Anthropic-format response
     */
    async sendMessage(request, accountManager, options = {}) {
        const fallbackEnabled = options.fallback !== false;
        return sendMessage(request, accountManager, fallbackEnabled);
    },
    
    /**
     * Send a streaming message
     * @param {Object} request - Anthropic-format request
     * @param {Object} accountManager - Account manager instance
     * @param {Object} options - Additional options
     * @yields {Object} Anthropic-format SSE events
     */
    async *sendMessageStream(request, accountManager, options = {}) {
        const fallbackEnabled = options.fallback !== false;
        yield* sendMessageStream(request, accountManager, fallbackEnabled);
    },
    
    /**
     * List available models
     * @param {string} token - OAuth access token
     * @param {string} projectId - Project ID
     * @returns {Promise<Array>} Array of model info
     */
    async listModels(token, projectId) {
        try {
            return await fetchAvailableModels(token, projectId);
        } catch (error) {
            logger.warn(`[CloudCode] Failed to fetch models: ${error.message}`);
            return [];
        }
    },
    
    /**
     * Get supported model families
     */
    getModelFamilies() {
        return ['claude', 'gemini'];
    },
    
    /**
     * Check if a model is supported
     * @param {string} modelId - Model ID to check
     * @returns {boolean}
     */
    supportsModel(modelId) {
        const lower = modelId.toLowerCase();
        return lower.includes('claude') || lower.includes('gemini');
    }
};

export default CloudCodeProvider;
