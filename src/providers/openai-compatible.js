/**
 * OpenAI-Compatible Provider
 * 
 * Generic provider for any OpenAI-compatible API endpoint.
 * Allows CommonsProxy to work with various LLM providers that
 * implement the OpenAI API format.
 */

import { ProviderType } from './index.js';
import { logger } from '../utils/logger.js';

/**
 * Create an OpenAI-compatible provider instance
 * @param {Object} config - Provider configuration
 * @param {string} config.id - Unique provider ID
 * @param {string} config.name - Display name
 * @param {string} config.baseUrl - API base URL
 * @param {string} [config.apiKey] - API key (optional)
 * @param {Object} [config.headers] - Additional headers
 * @returns {Object} Provider instance
 */
export function createOpenAICompatibleProvider(config) {
    const { id, name, baseUrl, apiKey, headers = {} } = config;
    
    return {
        id,
        name,
        type: ProviderType.OPENAI,
        enabled: true,
        
        config: {
            baseUrl,
            apiKey,
            headers
        },
        
        /**
         * Send a message
         * @param {Object} request - Anthropic-format request
         * @param {Object} credentials - { apiKey }
         * @param {Object} options - Additional options
         * @returns {Promise<Object>} Response
         */
        async sendMessage(request, credentials = {}, options = {}) {
            const key = credentials.apiKey || apiKey;
            const openaiRequest = convertAnthropicToOpenAI(request);
            
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': key ? `Bearer ${key}` : undefined,
                    'User-Agent': 'commons-proxy/1.0.0',
                    ...headers
                },
                body: JSON.stringify(openaiRequest)
            });
            
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`API error: ${response.status} ${text}`);
            }
            
            const data = await response.json();
            return convertOpenAIToAnthropic(data, request.model);
        },
        
        /**
         * Send a streaming message
         * @param {Object} request - Anthropic-format request
         * @param {Object} credentials - { apiKey }
         * @param {Object} options - Additional options
         * @yields {Object} Anthropic-format SSE events
         */
        async *sendMessageStream(request, credentials = {}, options = {}) {
            const key = credentials.apiKey || apiKey;
            const openaiRequest = convertAnthropicToOpenAI(request);
            openaiRequest.stream = true;
            
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': key ? `Bearer ${key}` : undefined,
                    'User-Agent': 'commons-proxy/1.0.0',
                    ...headers
                },
                body: JSON.stringify(openaiRequest)
            });
            
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`API error: ${response.status} ${text}`);
            }
            
            // Parse SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let messageId = `msg_${Date.now()}`;
            let contentIndex = 0;
            let started = false;
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    
                    try {
                        const chunk = JSON.parse(data);
                        const delta = chunk.choices?.[0]?.delta;
                        
                        if (!started) {
                            started = true;
                            yield {
                                type: 'message_start',
                                message: {
                                    id: messageId,
                                    type: 'message',
                                    role: 'assistant',
                                    content: [],
                                    model: request.model,
                                    stop_reason: null,
                                    usage: { input_tokens: 0, output_tokens: 0 }
                                }
                            };
                            yield {
                                type: 'content_block_start',
                                index: 0,
                                content_block: { type: 'text', text: '' }
                            };
                        }
                        
                        if (delta?.content) {
                            yield {
                                type: 'content_block_delta',
                                index: 0,
                                delta: { type: 'text_delta', text: delta.content }
                            };
                        }
                        
                        if (chunk.choices?.[0]?.finish_reason) {
                            yield { type: 'content_block_stop', index: 0 };
                            yield {
                                type: 'message_delta',
                                delta: { stop_reason: 'end_turn' },
                                usage: { output_tokens: chunk.usage?.completion_tokens || 0 }
                            };
                            yield { type: 'message_stop' };
                        }
                    } catch (e) {
                        logger.debug(`[OpenAI] Failed to parse chunk: ${e.message}`);
                    }
                }
            }
        },
        
        /**
         * List available models
         * @param {Object} credentials - { apiKey }
         * @returns {Promise<Array>} Array of model info
         */
        async listModels(credentials = {}) {
            const key = credentials.apiKey || apiKey;
            
            try {
                const response = await fetch(`${baseUrl}/models`, {
                    headers: {
                        'Authorization': key ? `Bearer ${key}` : undefined,
                        'User-Agent': 'commons-proxy/1.0.0',
                        ...headers
                    }
                });
                
                if (!response.ok) {
                    return [];
                }
                
                const data = await response.json();
                return (data.data || []).map(m => ({
                    id: m.id,
                    name: m.id,
                    family: 'openai'
                }));
            } catch (error) {
                logger.warn(`[OpenAI] Failed to list models: ${error.message}`);
                return [];
            }
        },
        
        getModelFamilies() {
            return ['openai'];
        },
        
        supportsModel(modelId) {
            return true; // Accept any model
        }
    };
}

/**
 * Convert Anthropic request to OpenAI format
 */
function convertAnthropicToOpenAI(request) {
    const messages = [];
    
    // Add system message
    if (request.system) {
        messages.push({ role: 'system', content: request.system });
    }
    
    // Convert messages
    for (const msg of request.messages) {
        if (typeof msg.content === 'string') {
            messages.push({ role: msg.role, content: msg.content });
        } else {
            // Handle content blocks
            const textContent = msg.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n');
            messages.push({ role: msg.role, content: textContent });
        }
    }
    
    return {
        model: request.model,
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        stream: false
    };
}

/**
 * Convert OpenAI response to Anthropic format
 */
function convertOpenAIToAnthropic(response, model) {
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
}

export default createOpenAICompatibleProvider;
