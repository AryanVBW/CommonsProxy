/**
 * GitHub Copilot Provider
 * 
 * Enables CommonsProxy to work with GitHub Copilot's API,
 * inspired by opencode's copilot plugin implementation.
 */

import { ProviderType } from './index.js';
import { logger } from '../utils/logger.js';

// GitHub Copilot OAuth configuration
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const COPILOT_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const COPILOT_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_API_URL = 'https://api.githubcopilot.com';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

/**
 * GitHub Copilot Provider
 */
export const CopilotProvider = {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    type: ProviderType.COPILOT,
    enabled: false, // Disabled by default, enable via config
    
    /**
     * Provider configuration
     */
    config: {
        clientId: COPILOT_CLIENT_ID,
        deviceCodeUrl: COPILOT_DEVICE_CODE_URL,
        accessTokenUrl: COPILOT_ACCESS_TOKEN_URL,
        apiUrl: COPILOT_API_URL,
        tokenUrl: COPILOT_TOKEN_URL
    },
    
    /**
     * Initiate device authorization flow
     * @returns {Promise<Object>} Device code response with verification_uri and user_code
     */
    async initiateDeviceAuth() {
        const response = await fetch(COPILOT_DEVICE_CODE_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'commons-proxy/1.0.0'
            },
            body: JSON.stringify({
                client_id: COPILOT_CLIENT_ID,
                scope: 'read:user'
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to initiate device authorization');
        }
        
        return response.json();
    },
    
    /**
     * Poll for access token after user completes device auth
     * @param {string} deviceCode - Device code from initiateDeviceAuth
     * @param {number} interval - Polling interval in seconds
     * @returns {Promise<Object>} Access token response
     */
    async pollForToken(deviceCode, interval = 5) {
        const maxAttempts = 60; // 5 minutes max
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval * 1000));
            
            const response = await fetch(COPILOT_ACCESS_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'commons-proxy/1.0.0'
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
                throw new Error(`OAuth error: ${data.error}`);
            }
        }
        
        throw new Error('Authorization timed out');
    },
    
    /**
     * Get Copilot API token from GitHub access token
     * @param {string} accessToken - GitHub access token
     * @returns {Promise<Object>} Copilot token with expiry
     */
    async getCopilotToken(accessToken) {
        const response = await fetch(COPILOT_TOKEN_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'commons-proxy/1.0.0',
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to get Copilot token: ${response.status} ${text}`);
        }
        
        const data = await response.json();
        return {
            token: data.token,
            expiresAt: data.expires_at
        };
    },
    
    /**
     * Send a message to Copilot API
     * @param {Object} request - Anthropic-format request
     * @param {Object} credentials - { accessToken, copilotToken }
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Response
     */
    async sendMessage(request, credentials, options = {}) {
        const { copilotToken } = credentials;
        
        // Convert Anthropic format to Copilot/OpenAI format
        const copilotRequest = this.convertRequest(request);
        
        const response = await fetch(`${COPILOT_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${copilotToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'commons-proxy/1.0.0',
                'Openai-Intent': 'conversation-edits',
                'X-Request-Id': crypto.randomUUID()
            },
            body: JSON.stringify(copilotRequest)
        });
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Copilot API error: ${response.status} ${text}`);
        }
        
        const data = await response.json();
        return this.convertResponse(data, request.model);
    },
    
    /**
     * Convert Anthropic request to Copilot/OpenAI format
     * @param {Object} request - Anthropic-format request
     * @returns {Object} OpenAI-format request
     */
    convertRequest(request) {
        const messages = request.messages.map(msg => {
            if (typeof msg.content === 'string') {
                return { role: msg.role, content: msg.content };
            }
            // Handle content blocks
            const textContent = msg.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n');
            return { role: msg.role, content: textContent };
        });
        
        // Add system message if present
        if (request.system) {
            messages.unshift({ role: 'system', content: request.system });
        }
        
        return {
            model: this.mapModel(request.model),
            messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false
        };
    },
    
    /**
     * Convert Copilot response to Anthropic format
     * @param {Object} response - OpenAI-format response
     * @param {string} model - Original model name
     * @returns {Object} Anthropic-format response
     */
    convertResponse(response, model) {
        const choice = response.choices?.[0];
        return {
            id: response.id || `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{
                type: 'text',
                text: choice?.message?.content || ''
            }],
            model: model,
            stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : choice?.finish_reason,
            usage: {
                input_tokens: response.usage?.prompt_tokens || 0,
                output_tokens: response.usage?.completion_tokens || 0
            }
        };
    },
    
    /**
     * Map model names to Copilot equivalents
     * @param {string} model - Anthropic model name
     * @returns {string} Copilot model name
     */
    mapModel(model) {
        const lower = model.toLowerCase();
        
        // Map Claude models to GPT equivalents
        if (lower.includes('opus') || lower.includes('claude-3-opus')) {
            return 'gpt-4';
        }
        if (lower.includes('sonnet')) {
            return 'gpt-4';
        }
        if (lower.includes('haiku')) {
            return 'gpt-3.5-turbo';
        }
        
        // Pass through if already a GPT model
        if (lower.includes('gpt')) {
            return model;
        }
        
        // Default to GPT-4
        return 'gpt-4';
    },
    
    /**
     * List available models
     * @returns {Promise<Array>} Array of model info
     */
    async listModels() {
        return [
            { id: 'gpt-4', name: 'GPT-4', family: 'openai' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', family: 'openai' },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', family: 'openai' },
            { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', family: 'claude' }
        ];
    },
    
    /**
     * Get supported model families
     */
    getModelFamilies() {
        return ['openai', 'claude'];
    },
    
    /**
     * Check if a model is supported
     * @param {string} modelId - Model ID to check
     * @returns {boolean}
     */
    supportsModel(modelId) {
        const lower = modelId.toLowerCase();
        return lower.includes('gpt') || lower.includes('claude');
    }
};

export default CopilotProvider;
